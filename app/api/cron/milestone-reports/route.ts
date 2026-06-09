// ----------------------------------------------------------------------------
// GET /api/cron/milestone-reports
//
// Background job: once an athlete has ~2 weeks of data, the coach sends them ONE
// analytical "Day-14 report" surfacing a non-obvious pattern about themselves.
// It lands in the coach chat (coach_messages) — no screen, nothing they trigger.
//
// Idempotent via athlete_profiles.day14_report_sent_at. Scheduled by Vercel Cron
// (see vercel.json), protected by CRON_SECRET like the reminder job.
// ----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateMilestoneReport,
  type CoachContext,
} from "@/lib/coach-ai";
import type {
  AthleteProfile,
  DailyCheckin,
  CoachResponse,
  PredictionWithOutcome,
  UserFeedback,
  AthleteMemoryNote,
} from "@/lib/types";

export const maxDuration = 60;

// Fire around day 21 (first check-in + 20 days). Require enough check-ins to
// analyze. (The DB flag is named day14_* for legacy reasons — it's just the
// "milestone report sent" idempotency stamp; the timing lives here.)
const MIN_DAYS_SINCE_FIRST = 20;
const MIN_CHECKINS = 10;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function daysBetween(a: string, b: string): number {
  return Math.floor(
    (Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000,
  );
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  // Candidates: athletes who haven't received the Day-14 report yet.
  const { data: profiles, error } = await admin
    .from("athlete_profiles")
    .select("*")
    .is("day14_report_sent_at", null);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const profile of (profiles as AthleteProfile[]) ?? []) {
    const userId = profile.user_id;

    // Full check-in history (oldest first) to judge eligibility + analyze.
    const { data: ciData } = await admin
      .from("daily_checkins")
      .select("*")
      .eq("user_id", userId)
      .order("checkin_date", { ascending: true })
      .limit(40);
    const checkinsAsc = (ciData as DailyCheckin[]) ?? [];

    if (checkinsAsc.length < MIN_CHECKINS) {
      skipped++;
      continue;
    }
    const firstDate = checkinsAsc[0].checkin_date;
    if (daysBetween(today, firstDate) < MIN_DAYS_SINCE_FIRST) {
      skipped++;
      continue;
    }

    // Newest-first window for the model.
    const checkins = [...checkinsAsc].reverse();

    // Pull the rest of the context in parallel.
    const [userRes, responsesRes, predictionsRes, feedbackRes, memoryRes, sessionRes] =
      await Promise.all([
        admin.from("users").select("full_name, email").eq("id", userId).maybeSingle(),
        admin
          .from("coach_responses")
          .select("*")
          .eq("user_id", userId)
          .order("response_date", { ascending: false })
          .limit(8),
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
          .limit(8),
        admin
          .from("athlete_memory_notes")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
        admin
          .from("workout_sessions")
          .select("id, session_date, day_name, notes")
          .eq("user_id", userId)
          .order("session_date", { ascending: false })
          .limit(14),
      ]);

    const userRec = userRes.data as { full_name: string | null; email: string | null } | null;

    // Logged workouts (per-set) for the window.
    const sessions =
      (sessionRes.data as {
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

    const ctx: CoachContext = {
      athleteName: userRec?.full_name || profile.full_name || userRec?.email || null,
      today,
      profile,
      latestCheckin: checkins[0] ?? null,
      recentCheckins: checkins,
      screenshots: [],
      memoryNotes: (memoryRes.data as AthleteMemoryNote[]) ?? [],
      previousResponses: (responsesRes.data as CoachResponse[]) ?? [],
      predictions: (predictionsRes.data as PredictionWithOutcome[]) ?? [],
      feedback: (feedbackRes.data as UserFeedback[]) ?? [],
      recentWorkouts,
    };

    try {
      const report = await generateMilestoneReport(ctx);
      const { error: msgErr } = await admin.from("coach_messages").insert({
        user_id: userId,
        role: "coach",
        body: report,
        ai_generated: true,
      });
      if (msgErr) {
        errors.push(`${userId}: ${msgErr.message}`);
        continue;
      }
      await admin
        .from("athlete_profiles")
        .update({ day14_report_sent_at: new Date().toISOString() })
        .eq("user_id", userId);
      sent++;
    } catch (err) {
      errors.push(`${userId}: ${err instanceof Error ? err.message : "report failed"}`);
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, errors });
}
