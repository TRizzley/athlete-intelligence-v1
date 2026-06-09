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
  type CoachContext,
  type ChatTurn,
} from "@/lib/coach-ai";
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

  // 3. Gather context (service role bypasses RLS). The latest check-in is today's
  //    row, now carrying the post-workout fields the coach reacts to.
  const [
    userRes,
    profileRes,
    checkinsRes,
    shotsRes,
    responsesRes,
    predictionsRes,
    feedbackRes,
    memoryRes,
    messagesRes,
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
      .limit(8),
    admin
      .from("coach_responses")
      .select("*")
      .eq("user_id", userId)
      .order("response_date", { ascending: false })
      .limit(5),
    admin
      .from("predictions")
      .select("*, prediction_outcomes(*)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(8),
    admin
      .from("user_feedback")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(8),
    admin
      .from("athlete_memory_notes")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    admin
      .from("coach_messages")
      .select("role, body, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(40),
  ]);

  const userRec = userRes.data as { full_name: string | null; email: string | null } | null;
  const profile = (profileRes.data as AthleteProfile) ?? null;
  const checkins = (checkinsRes.data as DailyCheckin[]) ?? [];

  // The today-dated row should be newest; fall back to a direct match.
  const latestCheckin =
    checkins.find((c) => c.checkin_date === ackDate) ?? checkins[0] ?? null;

  // 3b. Recent logged workouts (per-set weight + reps) for progression context.
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
      const sid = (r as { session_id: string }).session_id;
      const arr = bySession.get(sid) ?? [];
      arr.push(r);
      bySession.set(sid, arr);
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

  const recentMessages: ChatTurn[] = (
    (messagesRes.data as { role: "athlete" | "coach"; body: string }[]) ?? []
  ).map((m) => ({ role: m.role, body: m.body }));

  const ctx: CoachContext = {
    athleteName: userRec?.full_name || profile?.full_name || userRec?.email || null,
    today: ackDate,
    profile,
    latestCheckin,
    recentCheckins: checkins,
    screenshots: (shotsRes.data as UploadedScreenshot[]) ?? [],
    memoryNotes: (memoryRes.data as AthleteMemoryNote[]) ?? [],
    previousResponses: (responsesRes.data as CoachResponse[]) ?? [],
    predictions: (predictionsRes.data as PredictionWithOutcome[]) ?? [],
    feedback: (feedbackRes.data as UserFeedback[]) ?? [],
    recentWorkouts,
    recentMessages,
  };

  // 4. Generate the short note.
  let note: string;
  try {
    note = await generatePostWorkoutAck(ctx);
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
