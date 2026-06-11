// ----------------------------------------------------------------------------
// GET /api/cron/milestone-reports
//
// Background job: sends three tiers of milestone analytical reports to athletes
// as they accumulate data. All three land in coach_messages (chat).
//
// Tier 7  (Day 7):  "First Week" — brief, 3-4 sentences, ~day 7, ≥5 check-ins
// Tier 21 (Day 21): "Phase 1"   — deep analysis, ~day 21, ≥12 check-ins
// Tier 42 (Day 42): "Phase 2"   — longitudinal comparison, ~day 42, ≥25 check-ins
//
// Each tier is idempotent via its own sent_at column on athlete_profiles.
// Scheduled by Vercel Cron (see vercel.json), protected by CRON_SECRET.
// ----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateMilestoneReport,
  type CoachContext,
  type MilestoneTier,
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

// Eligibility thresholds for each tier.
const TIERS: {
  tier: MilestoneTier;
  minDays: number;
  minCheckins: number;
  sentAtColumn: "day7_report_sent_at" | "day14_report_sent_at" | "day42_report_sent_at";
  label: string;
}[] = [
  { tier: 7,  minDays: 6,  minCheckins: 5,  sentAtColumn: "day7_report_sent_at",  label: "Day-7"  },
  { tier: 21, minDays: 20, minCheckins: 12, sentAtColumn: "day14_report_sent_at", label: "Day-21" },
  { tier: 42, minDays: 41, minCheckins: 25, sentAtColumn: "day42_report_sent_at", label: "Day-42" },
];

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

  // Load all athletes. We'll check eligibility per-tier per-athlete below.
  const { data: profiles, error } = await admin
    .from("athlete_profiles")
    .select("*");
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results: Record<string, { sent: number; skipped: number; errors: string[] }> = {};
  for (const t of TIERS) results[t.label] = { sent: 0, skipped: 0, errors: [] };

  for (const profile of (profiles as AthleteProfile[]) ?? []) {
    const userId = profile.user_id;

    // Full check-in history to judge eligibility across all tiers.
    const { data: ciData } = await admin
      .from("daily_checkins")
      .select("*")
      .eq("user_id", userId)
      .order("checkin_date", { ascending: true })
      .limit(50);
    const checkinsAsc = (ciData as DailyCheckin[]) ?? [];
    if (checkinsAsc.length === 0) continue;

    const firstDate = checkinsAsc[0].checkin_date;
    const daysInProgram = daysBetween(today, firstDate);
    const checkins = [...checkinsAsc].reverse(); // newest first for context

    // Shared context data fetched once per athlete, reused across tiers.
    let sharedCtx: Awaited<ReturnType<typeof fetchSharedContext>> | null = null;

    for (const tierDef of TIERS) {
      const res = results[tierDef.label];

      // Already sent this tier.
      if (profile[tierDef.sentAtColumn]) { res.skipped++; continue; }

      // Not enough days or check-ins yet.
      if (daysInProgram < tierDef.minDays || checkins.length < tierDef.minCheckins) {
        res.skipped++; continue;
      }

      // Lazy-load shared context on first eligible tier.
      if (!sharedCtx) {
        sharedCtx = await fetchSharedContext(admin, userId, checkins);
      }

      const ctx: CoachContext = {
        athleteName: sharedCtx.athleteName,
        today,
        profile,
        latestCheckin: checkins[0] ?? null,
        recentCheckins: checkins,
        screenshots: [],
        memoryNotes: sharedCtx.memoryNotes,
        previousResponses: sharedCtx.previousResponses,
        predictions: sharedCtx.predictions,
        feedback: sharedCtx.feedback,
        recentWorkouts: sharedCtx.recentWorkouts,
        programContext: {
          dayNumber: daysInProgram + 1,
          programWeek: Math.ceil((daysInProgram + 1) / 7),
          totalCheckins: checkins.length,
          firstCheckinDate: firstDate,
        },
      };

      try {
        const report = await generateMilestoneReport(ctx, tierDef.tier);
        const { error: msgErr } = await admin.from("coach_messages").insert({
          user_id: userId,
          role: "coach",
          body: report,
          ai_generated: true,
        });
        if (msgErr) {
          res.errors.push(`${userId}: ${msgErr.message}`);
          continue;
        }
        await admin
          .from("athlete_profiles")
          .update({ [tierDef.sentAtColumn]: new Date().toISOString() })
          .eq("user_id", userId);
        res.sent++;
      } catch (err) {
        res.errors.push(`${userId}: ${err instanceof Error ? err.message : "report failed"}`);
      }
    }
  }

  return NextResponse.json({ ok: true, results });
}

// ---------------------------------------------------------------------------
// Shared data fetched once per athlete (reused across tiers in one cron pass).
// ---------------------------------------------------------------------------
async function fetchSharedContext(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  checkins: DailyCheckin[],
) {
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
  const athleteName = userRec?.full_name || userRec?.email || null;

  // Per-set workout data.
  const sessions = (sessionRes.data as { id: string; session_date: string; day_name: string | null; notes: string | null }[]) ?? [];
  let recentWorkouts: CoachContext["recentWorkouts"] = [];
  if (sessions.length > 0) {
    const { data: setRows } = await admin
      .from("workout_set_logs")
      .select("session_id, exercise_name, muscle_group, set_number, weight, reps")
      .in("session_id", sessions.map((s) => s.id))
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
        const row = r as { exercise_name: string; muscle_group: string | null; set_number: number; weight: number | null; reps: number | null };
        return { exercise: row.exercise_name, muscle: row.muscle_group, set: row.set_number, weight: row.weight, reps: row.reps };
      }),
    }));
  }

  return {
    athleteName,
    memoryNotes: (memoryRes.data as AthleteMemoryNote[]) ?? [],
    previousResponses: (responsesRes.data as CoachResponse[]) ?? [],
    predictions: (predictionsRes.data as PredictionWithOutcome[]) ?? [],
    feedback: (feedbackRes.data as UserFeedback[]) ?? [],
    recentWorkouts,
  };
}
