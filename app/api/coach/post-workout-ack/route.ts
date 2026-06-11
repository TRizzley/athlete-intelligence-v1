// ----------------------------------------------------------------------------
// POST /api/coach/post-workout-ack
//
// Sends a SHORT coach acknowledgment right after the athlete logs their
// post-workout check-in. This does NOT touch the frozen morning decision — it's
// a brief, encouraging note that lands in the coach chat (coach_messages) with
// one concrete recover/refuel cue for the rest of today.
//
// Idempotent: it sends at most once per day's logged session, tracked by
// daily_checkins.post_workout_ack_at. Safe to ping on every dashboard load.
//
// Auth: the caller is authenticated via their session; data access + the coach
// message write use the service-role client (RLS forbids athletes from inserting
// 'coach' rows), always scoped to the caller's own user_id.
// ----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generatePostWorkoutAck,
  type ChatTurn,
} from "@/lib/coach-ai";
import { buildCoachContext } from "@/lib/context";
import { todayISO } from "@/lib/format";

export const maxDuration = 60;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
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

  // 2. The day's check-in must exist, have a logged workout, and not be acked yet.
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
    return json({ ok: true, skipped: "no workout logged to acknowledge" });
  }
  if (today.post_workout_ack_at) {
    return json({ ok: true, skipped: "already acknowledged" });
  }

  // 3. Gather context (service role — bypasses RLS). Fetch chat history and full
  //    context in parallel. latestCheckinDate ensures today's row (now carrying
  //    the post-workout fields) is the one the coach reacts to.
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

  // 4. Generate the short note.
  let note: string;
  try {
    note = await generatePostWorkoutAck({ ...ctx, recentMessages });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not generate the note.";
    return json({ ok: false, error: message }, 502);
  }

  // 5. Post it into the coach chat (service role — athletes can't insert 'coach').
  const { error: msgErr } = await admin.from("coach_messages").insert({
    user_id: userId,
    role: "coach",
    body: note,
    ai_generated: true,
  });
  if (msgErr) {
    return json({ ok: false, error: msgErr.message }, 500);
  }

  // 6. Mark this day acknowledged so we never double-send.
  await admin
    .from("daily_checkins")
    .update({ post_workout_ack_at: new Date().toISOString() })
    .eq("id", today.id);

  return json({ ok: true, sent: true });
}
