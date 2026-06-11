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
import {
  generateCoachDraft,
  scorePredictionOutcome,
  type CoachContext,
  type ChatTurn,
} from "@/lib/coach-ai";
import { buildTrustSnapshotRow, flattenOutcomes } from "@/lib/metrics";
import { todayISO } from "@/lib/format";
import type {
  AthleteProfile,
  DailyCheckin,
  UploadedScreenshot,
  CoachResponse,
  PredictionWithOutcome,
  UserFeedback,
  AthleteMemoryNote,
} from "@/lib/types";

// Drafting can take 10-20s; give it room.
export const maxDuration = 60;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

// The day after a YYYY-MM-DD date (a 'tomorrow' prediction's target date).
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
  const responseDate =
    typeof body.date === "string" && DATE_RE.test(body.date) ? body.date : todayISO();

  const userId = user.id;
  const admin = createAdminClient();

  // 2. Gather the athlete's full context (service role bypasses RLS).
  const [
    userRes,
    profileRes,
    checkinsRes,
    shotsRes,
    responsesRes,
    predictionsRes,
    feedbackRes,
    memoryRes,
  ] = await Promise.all([
    admin.from("users").select("full_name, email").eq("id", userId).maybeSingle(),
    admin.from("athlete_profiles").select("*").eq("user_id", userId).maybeSingle(),
    admin
      .from("daily_checkins")
      .select("*")
      .eq("user_id", userId)
      .order("checkin_date", { ascending: false })
      .limit(8),
    admin
      .from("uploaded_screenshots")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(12),
    admin
      .from("coach_responses")
      .select("*")
      .eq("user_id", userId)
      .order("response_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(10),
    admin
      .from("predictions")
      .select("*, prediction_outcomes(*)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(12),
    admin
      .from("user_feedback")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(12),
    admin
      .from("athlete_memory_notes")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  const userRec = userRes.data as { full_name: string | null; email: string | null } | null;
  const profile = (profileRes.data as AthleteProfile) ?? null;
  const checkins = (checkinsRes.data as DailyCheckin[]) ?? [];
  const screenshots = (shotsRes.data as UploadedScreenshot[]) ?? [];
  const previousResponses = (responsesRes.data as CoachResponse[]) ?? [];

  // 3. Guard: need something to reason from.
  if (!profile && checkins.length === 0) {
    return json({ ok: true, skipped: "no data yet" });
  }
  // "Report yesterday, plan today": the decision for TODAY is built from the most
  // recent COMPLETED-day results — normally yesterday's check-in. We don't wait
  // for a check-in dated today; we plan today from the latest results we have,
  // as long as they're recent enough (within ~2 days) to be relevant.
  const latestCheckin = checkins[0] ?? null;
  if (!latestCheckin) {
    return json({ ok: true, skipped: "no check-ins yet" });
  }
  const ageDays =
    (Date.parse(responseDate + "T00:00:00Z") -
      Date.parse(latestCheckin.checkin_date + "T00:00:00Z")) /
    86400000;
  if (!(ageDays >= 0 && ageDays <= 2)) {
    return json({ ok: true, skipped: "no recent check-in to plan from" });
  }

  // 4. Freeze the morning decision. Once today's decision has been generated, it
  //    stays put for the rest of the day — later data (most importantly the
  //    post-workout check-in) must NOT rewrite today's call. That post-workout
  //    data instead flows into TOMORROW's decision (auto-respond reads the recent
  //    check-ins) and into scoring today's prediction. So generate at most once
  //    per day: if an auto response already exists for this date, leave it alone.
  const existingAuto = previousResponses.find(
    (r) => r.response_date === responseDate && r.ai_generated,
  );
  if (existingAuto) {
    return json({ ok: true, skipped: "already generated for today", id: existingAuto.id });
  }

  // 4b. Recent logged workouts (per-set weight + reps) for progression context.
  const { data: sessionRows } = await admin
    .from("workout_sessions")
    .select("id, session_date, day_name, notes")
    .eq("user_id", userId)
    .order("session_date", { ascending: false })
    .limit(5);
  const sessions =
    (sessionRows as {
      id: string;
      session_date: string;
      day_name: string | null;
      notes: string | null;
    }[]) ?? [];

  let recentWorkouts: CoachContext["recentWorkouts"] = [];
  if (sessions.length > 0) {
    const { data: setRows } = await admin
      .from("workout_set_logs")
      .select("session_id, exercise_name, muscle_group, set_number, weight, reps")
      .in(
        "session_id",
        sessions.map((s) => s.id),
      )
      .order("position", { ascending: true });
    const bySession = new Map<string, typeof setRows>();
    (setRows ?? []).forEach((r) => {
      const arr = bySession.get((r as { session_id: string }).session_id) ?? [];
      arr.push(r);
      bySession.set((r as { session_id: string }).session_id, arr);
    });
    recentWorkouts = sessions.map((s) => ({
      session_date: s.session_date,
      day_name: s.day_name,
      notes: s.notes,
      sets: (bySession.get(s.id) ?? []).map((r) => {
        const row = r as {
          exercise_name: string;
          muscle_group: string | null;
          set_number: number;
          weight: number | null;
          reps: number | null;
        };
        return {
          exercise: row.exercise_name,
          muscle: row.muscle_group,
          set: row.set_number,
          weight: row.weight,
          reps: row.reps,
        };
      }),
    }));
  }

  // 4c. Recent chat (last ~7 days) so the decision reflects what the athlete
  //     told the coach between daily reports.
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

  // 4d. Close the prediction loop: score any past prediction whose target day
  //     now has a check-in and hasn't been graded yet. Newly scored outcomes
  //     are merged in-memory so they also inform today's decision below.
  //
  //     Broadened scoring window: the 8-check-in window above may not cover
  //     older target dates. For any unscored prediction whose target_date
  //     falls outside our in-memory map, we fetch that specific check-in
  //     directly so no prediction goes unscored due to window size.
  const predsAll = (predictionsRes.data as PredictionWithOutcome[]) ?? [];
  const checkinByDate = new Map(checkins.map((c) => [c.checkin_date, c]));

  for (const p of predsAll) {
    const po = p.prediction_outcomes;
    const alreadyScored = Array.isArray(po) ? po.length > 0 : !!po;
    if (alreadyScored || !p.target_date) continue;

    // Resolve the check-in for the target date — from in-memory map first,
    // then fall back to a targeted DB fetch for older predictions.
    let actual = checkinByDate.get(p.target_date) ?? null;
    if (!actual) {
      const { data: fetchedRow } = await admin
        .from("daily_checkins")
        .select("*")
        .eq("user_id", userId)
        .eq("checkin_date", p.target_date)
        .maybeSingle();
      actual = (fetchedRow as DailyCheckin) ?? null;
      if (actual) checkinByDate.set(p.target_date, actual); // cache for reuse
    }
    if (!actual) continue; // genuinely no check-in for this target date yet

    // Baseline = the most recent check-in strictly before the target day.
    const prior =
      checkins
        .filter((c) => c.checkin_date < p.target_date!)
        .sort((a, b) => (a.checkin_date < b.checkin_date ? 1 : -1))[0] ?? null;

    try {
      const score = await scorePredictionOutcome(
        p.prediction_text,
        p.target_date,
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
    } catch {
      /* best-effort; leave unscored so it retries on the next run */
    }
  }

  // 4e. Compute program context — where the athlete is in their journey.
  //     Uses the earliest check-in in the 8-day window as a proxy; if they've
  //     been at it longer than the window, the count and week are still useful.
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
    const firstDate = (firstCiRow as { checkin_date: string } | null)?.checkin_date ?? oldestInWindow.checkin_date;
    const dayNum = Math.floor(
      (Date.parse(responseDate + "T00:00:00Z") - Date.parse(firstDate + "T00:00:00Z")) / 86400000,
    ) + 1;
    programContext = {
      dayNumber: Math.max(1, dayNum),
      programWeek: Math.ceil(Math.max(1, dayNum) / 7),
      totalCheckins: totalCi ?? checkins.length,
      firstCheckinDate: firstDate,
    };
  }

  // 5. Build context and ask Claude for the decision.
  const ctx: CoachContext = {
    athleteName: userRec?.full_name || profile?.full_name || userRec?.email || null,
    today: responseDate,
    profile,
    latestCheckin: checkins[0] ?? null,
    recentCheckins: checkins,
    screenshots,
    memoryNotes: (memoryRes.data as AthleteMemoryNote[]) ?? [],
    previousResponses,
    predictions: predsAll,
    feedback: (feedbackRes.data as UserFeedback[]) ?? [],
    recentWorkouts,
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

  // 6. Replace any prior auto response for the day (and its tracked prediction),
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

  // 7. Log a tracked, scoreable prediction so the accuracy metric fills in.
  if (draft.prediction) {
    await admin.from("predictions").insert({
      user_id: userId,
      coach_response_id: inserted.id,
      prediction_text: draft.prediction,
      horizon: "tomorrow",
      confidence: draft.confidence,
      target_date: nextDay(responseDate),
      created_by: userId,
    });
  }

  // 8. Refresh today's trust snapshot so the table builds a daily time series
  //    automatically (idempotent upsert on user_id + snapshot_date). Best-effort.
  try {
    const { count: responsesSent } = await admin
      .from("coach_responses")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "sent");

    const snapshotRow = buildTrustSnapshotRow({
      userId,
      date: responseDate,
      feedback: (feedbackRes.data as UserFeedback[]) ?? [],
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
