// ----------------------------------------------------------------------------
// POST /api/coach/auto-respond
//
// Fully-automatic daily coaching decision for the SIGNED-IN athlete.
//
// Flow: the athlete checks in and uploads their screenshots; the dashboard and
// the upload form ping this route. It gathers everything we know about them,
// asks Claude for a decision, and SENDS it straight to the athlete (status =
// 'sent') with no human review step.
//
// It is idempotent and cheap to call repeatedly: it only (re)generates when
// there is genuinely new data since the last auto response, so calling it on
// every dashboard load is safe.
//
// Auth: the caller is authenticated via their session; the actual data access
// and write use the service-role client (RLS forbids athletes from inserting
// coach_responses), always scoped to the caller's own user_id.
// ----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateCoachDraft } from "@/lib/coach-draft";
import { scorePredictionOutcome } from "@/lib/coach-predictions";
import type { CoachContext, ChatTurn } from "@/lib/coach-types";
import { buildCoachContext } from "@/lib/context";
import { buildTrustSnapshotRow, flattenOutcomes } from "@/lib/metrics";
import { todayISO } from "@/lib/format";
import type { DailyCheckin } from "@/lib/types";

// Drafting can take 10-20s; give it room.
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
  const responseDate =
    typeof body.date === "string" && DATE_RE.test(body.date) ? body.date : todayISO();

  const userId = user.id;
  const admin = createAdminClient();

  // 2. Pre-flight idempotency check — one cheap query before the expensive context
  //    fetch. This route runs on every dashboard load; skip immediately when we've
  //    already generated for today.
  const { data: existingCheck } = await admin
    .from("coach_responses")
    .select("id")
    .eq("user_id", userId)
    .eq("response_date", responseDate)
    .eq("ai_generated", true)
    .limit(1)
    .maybeSingle();
  if (existingCheck) {
    return json({
      ok: true,
      skipped: "already generated for today",
      id: (existingCheck as { id: string }).id,
    });
  }

  // 3. Gather the athlete's full context (service role — bypasses RLS).
  const baseCtx = await buildCoachContext(userId, admin, responseDate);

  // 4. Guard: need something to reason from.
  if (!baseCtx.profile && baseCtx.recentCheckins.length === 0) {
    return json({ ok: true, skipped: "no data yet" });
  }
  const latestCheckin = baseCtx.latestCheckin;
  if (!latestCheckin) {
    return json({ ok: true, skipped: "no check-ins yet" });
  }
  // "Report yesterday, plan today": the decision for TODAY is built from the most
  // recent COMPLETED-day results — normally yesterday's check-in. We don't wait
  // for a check-in dated today; we plan today from the latest results we have,
  // as long as they're recent enough (within ~2 days) to be relevant.
  const ageDays =
    (Date.parse(responseDate + "T00:00:00Z") -
      Date.parse(latestCheckin.checkin_date + "T00:00:00Z")) /
    86400000;
  if (!(ageDays >= 0 && ageDays <= 2)) {
    return json({ ok: true, skipped: "no recent check-in to plan from" });
  }

  // 5. Recent chat (last ~7 days) so the decision reflects what the athlete
  //    told the coach between daily reports.
  const chatSince = new Date(
    Date.parse(responseDate + "T00:00:00Z") - 7 * 86400000,
  ).toISOString();
  const { data: messageRows } = await admin
    .from("coach_messages")
    .select("role, body, created_at")
    .eq("user_id", userId)
    .gte("created_at", chatSince)
    .order("created_at", { ascending: true })
    .limit(40);
  const recentMessages: ChatTurn[] = (
    (messageRows as { role: "athlete" | "coach"; body: string }[]) ?? []
  ).map((m) => ({ role: m.role, body: m.body }));

  // 6. Close the prediction loop: score any past prediction whose target day now
  //    has a check-in and hasn't been graded yet. Newly scored outcomes are merged
  //    in-memory so they also inform today's decision below.
  //
  //    All scoring runs in parallel (two phases) to avoid blocking the draft:
  //    Phase A -- fetch any missing check-ins concurrently (deduplicated by date).
  //    Phase B -- fire all scorePredictionOutcome (Claude) calls concurrently.
  const predsAll = baseCtx.predictions;
  const checkins = baseCtx.recentCheckins;
  const checkinByDate = new Map(checkins.map((c) => [c.checkin_date, c]));

  const toScore = predsAll.filter((p) => {
    const po = p.prediction_outcomes;
    const alreadyScored = Array.isArray(po) ? po.length > 0 : !!po;
    return !alreadyScored && !!p.target_date;
  });

  // Phase A: fetch missing check-ins in parallel, deduplicated by date.
  const missingDates = [
    ...new Set(toScore.filter((p) => !checkinByDate.has(p.target_date!)).map((p) => p.target_date!)),
  ];
  await Promise.allSettled(
    missingDates.map(async (date) => {
      const { data } = await admin
        .from("daily_checkins")
        .select("*")
        .eq("user_id", userId)
        .eq("checkin_date", date)
        .maybeSingle();
      if (data) checkinByDate.set(date, data as DailyCheckin);
    }),
  );

  // Phase B: score all eligible predictions concurrently.
  await Promise.allSettled(
    toScore.map(async (p) => {
      const actual = checkinByDate.get(p.target_date!) ?? null;
      if (!actual) return; // no check-in for this target date yet

      const prior =
        checkins
          .filter((c) => c.checkin_date < p.target_date!)
          .sort((a, b) => (a.checkin_date < b.checkin_date ? 1 : -1))[0] ?? null;

      try {
        const score = await scorePredictionOutcome(
          p.prediction_text,
          p.target_date!,
          actual,
          prior,
        );
        const { error: outErr } = await admin
          .from("prediction_outcomes")
          .upsert(
            {
              prediction_id: p.id,
              outcome: score.outcome,
              notes: score.notes || null,
              recorded_by: userId,
            },
            { onConflict: "prediction_id", ignoreDuplicates: true },
          );
        if (!outErr) {
          // Reflect the new outcome in the context used for today's draft.
          p.prediction_outcomes = [
            {
              id: "pending",
              prediction_id: p.id,
              outcome: score.outcome,
              notes: score.notes || null,
              recorded_by: userId,
              recorded_at: new Date().toISOString(),
            },
          ];
        }
      } catch (err) {
        console.warn("[auto-respond] prediction scoring failed for", p.id, err);
        /* best-effort; leave unscored so it retries on the next run */
      }
    }),
  );

  // 7. Compute program context — where the athlete is in their journey.
  //    Uses the earliest check-in in the 8-day window as a proxy; if they've
  //    been at it longer than the window, the count and week are still useful.
  const oldestInWindow = checkins[checkins.length - 1];
  let programContext: CoachContext["programContext"] | undefined;
  if (oldestInWindow) {
    // Fetch the very first check-in for an accurate day count.
    const { data: firstCiRow } = await admin
      .from("daily_checkins")
      .select("checkin_date")
      .eq("user_id", userId)
      .order("checkin_date", { ascending: true })
      .limit(1)
      .maybeSingle();
    const { count: totalCi } = await admin
      .from("daily_checkins")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    const firstDate =
      (firstCiRow as { checkin_date: string } | null)?.checkin_date ??
      oldestInWindow.checkin_date;
    const dayNum =
      Math.floor(
        (Date.parse(responseDate + "T00:00:00Z") -
          Date.parse(firstDate + "T00:00:00Z")) /
          86400000,
      ) + 1;
    programContext = {
      dayNumber: Math.max(1, dayNum),
      programWeek: Math.ceil(Math.max(1, dayNum) / 7),
      totalCheckins: totalCi ?? checkins.length,
      firstCheckinDate: firstDate,
    };
  }

  // 8. Assemble the final context for Claude.
  const ctx: CoachContext = {
    ...baseCtx,
    predictions: predsAll,  // includes any newly scored outcomes
    recentMessages,
    programContext,
  };

  let draft;
  try {
    draft = await generateCoachDraft(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error generating decision.";
    return json({ ok: false, error: message }, 502);
  }

  // 9. Replace any prior auto response for the day (and its tracked prediction),
  //    then SEND the fresh one.
  const { data: olds } = await admin
    .from("coach_responses")
    .select("id")
    .eq("user_id", userId)
    .eq("response_date", responseDate)
    .eq("ai_generated", true);
  const oldIds = (olds ?? []).map((r) => (r as { id: string }).id);
  if (oldIds.length > 0) {
    await admin.from("predictions").delete().in("coach_response_id", oldIds);
    await admin.from("coach_responses").delete().in("id", oldIds);
  }

  const { data: inserted, error: insertError } = await admin
    .from("coach_responses")
    .insert({
      user_id: userId,
      response_date: responseDate,
      what_noticed: draft.what_noticed || null,
      why_it_matters: draft.why_it_matters || null,
      recommendation: draft.recommendation || null,
      prediction: draft.prediction || null,
      confidence: draft.confidence,
      data_used: draft.data_used || null,
      athlete_question: draft.athlete_question || null,
      status: "sent",
      ai_generated: true,
      created_by: userId,
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return json({ ok: false, error: insertError?.message ?? "Could not save the response." }, 500);
  }

  // 10. Post the conversational morning brief into the coach chat — this is how
  //     the athlete actually reads the decision (the structured row above feeds
  //     metrics, history, and the dashboard snapshot). Falls back to composing
  //     from the structured fields if the model skipped chat_message.
  const briefBody =
    draft.chat_message ||
    [draft.what_noticed, draft.recommendation, draft.prediction, draft.athlete_question]
      .filter(Boolean)
      .join("\n\n");
  if (briefBody) {
    await admin.from("coach_messages").insert({
      user_id: userId,
      role: "coach",
      body: briefBody,
      ai_generated: true,
      kind: "morning_brief",
    });
  }

  // 11. Log a tracked, scoreable prediction so the accuracy metric fills in.
  //     The morning prediction is about how TODAY goes; the post-workout review
  //     scores it tonight against the completed day (with next-morning fallback
  //     in step 6 above if no workout gets logged).
  if (draft.prediction) {
    await admin.from("predictions").insert({
      user_id: userId,
      coach_response_id: inserted.id,
      prediction_text: draft.prediction,
      horizon: "today",
      confidence: draft.confidence,
      target_date: responseDate,
      created_by: userId,
    });
  }

  // 12. Refresh today's trust snapshot so the table builds a daily time series
  //     automatically (idempotent upsert on user_id + snapshot_date). Best-effort.
  try {
    const { count: responsesSent } = await admin
      .from("coach_responses")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "sent");

    const snapshotRow = buildTrustSnapshotRow({
      userId,
      date: responseDate,
      feedback: baseCtx.feedback,
      outcomes: flattenOutcomes(predsAll),
      predictionsTotal: predsAll.length,
      responsesSent: responsesSent ?? 0,
      createdBy: userId,
    });
    await admin
      .from("trust_metrics")
      .upsert(snapshotRow, { onConflict: "user_id,snapshot_date" });
  } catch {
    /* snapshot is best-effort; never fail the response on it */
  }

  return json({ ok: true, id: inserted.id as string, sent: true });
}
