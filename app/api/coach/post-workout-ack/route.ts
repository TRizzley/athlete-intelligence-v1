// ----------------------------------------------------------------------------
// POST /api/coach/post-workout-ack
//
// The coach's POST-WORKOUT REVIEW, posted into the coach chat right after the
// athlete logs their session. This closes the daily loop conversationally:
//
//   1. Scores this morning's prediction (horizon 'today') against the now-
//      completed day, so the review can deliver an honest verdict.
//   2. Generates the review: session reaction, prediction verdict, rest-of-day
//      recovery guidance, and a prediction for TOMORROW MORNING.
//   3. Posts it as a kind='workout_review' coach message and logs the new
//      prediction (target = tomorrow) so it's scoreable at the next check-in.
//
// Idempotent: it sends at most once per day's logged session, tracked by
// daily_checkins.post_workout_ack_at. Safe to ping on every page load.
//
// Auth: the caller is authenticated via their session; data access + writes use
// the service-role client (RLS forbids athletes from inserting 'coach' rows),
// always scoped to the caller's own user_id.
// ----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateWorkoutReview, type MorningPredictionResult } from "@/lib/coach-workout";
import { scorePredictionOutcome } from "@/lib/coach-predictions";
import { friendlyCoachError } from "@/lib/coach-errors";
import type { ChatTurn } from "@/lib/coach-types";
import { buildCoachContext } from "@/lib/context";
import { todayISO } from "@/lib/format";
import type { DailyCheckin, PredictionWithOutcome } from "@/lib/types";

export const maxDuration = 60;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

// The day after a YYYY-MM-DD date (the tomorrow-morning prediction's target).
function nextDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  // 1. Who is calling (must be signed in). We act only on their own data.
  const session = await createClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return json({ ok: false, error: "Not signed in." }, 401);

  let body: { date?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* body is optional */
  }
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const ackDate =
    typeof body.date === "string" && DATE_RE.test(body.date) ? body.date : todayISO();

  const userId = user.id;
  const admin = createAdminClient();

  // 2. The day's check-in must exist, have a logged workout, and not be reviewed yet.
  const { data: todayRow } = await admin
    .from("daily_checkins")
    .select("id, workout_completed, post_workout_ack_at")
    .eq("user_id", userId)
    .eq("checkin_date", ackDate)
    .maybeSingle();

  const today = todayRow as
    | { id: string; workout_completed: boolean | null; post_workout_ack_at: string | null }
    | null;

  if (!today) return json({ ok: true, skipped: "no check-in for the day" });
  if (today.workout_completed !== true) {
    return json({ ok: true, skipped: "no workout logged to review" });
  }
  if (today.post_workout_ack_at) {
    return json({ ok: true, skipped: "already reviewed" });
  }

  // 3. Gather context (service role — bypasses RLS). Fetch chat history and full
  //    context in parallel. latestCheckinDate ensures today's row (now carrying
  //    the post-workout fields) is the one the coach reviews.
  const [messagesRes, ctx] = await Promise.all([
    admin
      .from("coach_messages")
      .select("role, body, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(40),
    buildCoachContext(userId, admin, ackDate, {
      latestCheckinDate: ackDate,
      screenshotLimit: 8,
      responseLimit: 5,
      predictionLimit: 8,
      feedbackLimit: 8,
    }),
  ]);

  const recentMessages: ChatTurn[] = (
    (messagesRes.data as { role: "athlete" | "coach"; body: string }[]) ?? []
  ).map((m) => ({ role: m.role, body: m.body }));

  // 4. Close this morning's loop: find today's unscored prediction (made this
  //    morning, horizon 'today') and score it against the completed day, so the
  //    review can deliver an honest verdict. Best-effort — a scoring failure
  //    never blocks the review.
  let morningResult: MorningPredictionResult | null = null;
  const todaysPrediction = ctx.predictions.find((p: PredictionWithOutcome) => {
    const po = p.prediction_outcomes;
    const alreadyScored = Array.isArray(po) ? po.length > 0 : !!po;
    return !alreadyScored && p.target_date === ackDate;
  });
  if (todaysPrediction) {
    const actual = ctx.latestCheckin;
    const prior =
      ctx.recentCheckins.find((c: DailyCheckin) => c.checkin_date < ackDate) ?? null;
    if (actual) {
      try {
        const score = await scorePredictionOutcome(
          todaysPrediction.prediction_text,
          ackDate,
          actual,
          prior,
        );
        await admin.from("prediction_outcomes").upsert(
          {
            prediction_id: todaysPrediction.id,
            outcome: score.outcome,
            notes: score.notes || null,
            recorded_by: userId,
          },
          { onConflict: "prediction_id", ignoreDuplicates: true },
        );
        morningResult = {
          prediction_text: todaysPrediction.prediction_text,
          outcome: score.outcome,
          notes: score.notes || null,
        };
      } catch (err) {
        console.warn("[post-workout] prediction scoring failed:", err);
        /* leave unscored; tomorrow's auto-respond run retries */
      }
    }
  }

  // 5. Generate the review.
  let review;
  try {
    review = await generateWorkoutReview({ ...ctx, recentMessages }, morningResult);
  } catch (err) {
    const message = friendlyCoachError(err, "post-workout");
    return json({ ok: false, error: message }, 502);
  }

  // 6. Post it into the coach chat (service role — athletes can't insert 'coach').
  const { error: msgErr } = await admin.from("coach_messages").insert({
    user_id: userId,
    role: "coach",
    body: review.message,
    ai_generated: true,
    kind: "workout_review",
  });
  if (msgErr) {
    return json({ ok: false, error: msgErr.message }, 500);
  }

  // 7. Log the tomorrow-morning prediction so it's scoreable against tomorrow's
  //    morning check-in (the generic scoring pass in auto-respond picks it up).
  if (review.next_morning_prediction) {
    await admin.from("predictions").insert({
      user_id: userId,
      prediction_text: review.next_morning_prediction,
      horizon: "tomorrow_morning",
      confidence: review.confidence,
      target_date: nextDay(ackDate),
      created_by: userId,
    });
  }

  // 8. Mark this day reviewed so we never double-send.
  await admin
    .from("daily_checkins")
    .update({ post_workout_ack_at: new Date().toISOString() })
    .eq("id", today.id);

  return json({ ok: true, sent: true });
}
