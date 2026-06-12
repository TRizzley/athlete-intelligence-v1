// ----------------------------------------------------------------------------
// GET /api/cron/milestone-reports
//
// Background job: sends three tiers of milestone analytical reports to athletes
// as they accumulate data. All three land in coach_messages (chat).
//
// Tier 7  (Day 7):  "First Week" -- brief, 3-4 sentences, ~day 7, >=5 check-ins
// Tier 21 (Day 21): "Phase 1"   -- deep analysis, ~day 21, >=12 check-ins
// Tier 42 (Day 42): "Phase 2"   -- longitudinal comparison, ~day 42, >=25 check-ins
//
// Each tier is idempotent via its own sent_at column on athlete_profiles.
// Scheduled by Vercel Cron (see vercel.json), protected by CRON_SECRET.
// Athletes are processed in parallel batches of BATCH_SIZE to stay well within
// the 60-second maxDuration limit even as the roster grows.
// ----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateMilestoneReport,
  type CoachContext,
  type MilestoneTier,
} from "@/lib/coach-ai";
import { buildCoachContext } from "@/lib/context";
import type {
  AthleteProfile,
  DailyCheckin,
} from "@/lib/types";

export const maxDuration = 60;

const BATCH_SIZE = 5; // athletes processed in parallel per batch

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

type TierResults = Record<string, { sent: number; skipped: number; errors: string[] }>;

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

// Process a single athlete across all tiers. Returns per-tier result deltas.
async function processAthlete(
  profile: AthleteProfile,
  today: string,
): Promise<TierResults> {
  const admin = createAdminClient();
  const deltas: TierResults = {};
  for (const t of TIERS) deltas[t.label] = { sent: 0, skipped: 0, errors: [] };

  const { data: ciData } = await admin
    .from("daily_checkins")
    .select("*")
    .eq("user_id", profile.user_id)
    .order("checkin_date", { ascending: true })
    .limit(50);
  const checkinsAsc = (ciData as DailyCheckin[]) ?? [];
  if (checkinsAsc.length === 0) return deltas;

  const firstDate = checkinsAsc[0].checkin_date;
  const daysInProgram = daysBetween(today, firstDate);

  let baseCtx: CoachContext | null = null;

  for (const tierDef of TIERS) {
    const res = deltas[tierDef.label];

    if (profile[tierDef.sentAtColumn]) { res.skipped++; continue; }
    if (daysInProgram < tierDef.minDays || checkinsAsc.length < tierDef.minCheckins) {
      res.skipped++; continue;
    }

    if (!baseCtx) {
      baseCtx = await buildCoachContext(profile.user_id, admin, today, {
        screenshotLimit: 0,
        checkinLimit: 50,
      });
    }

    const ctx: CoachContext = {
      ...baseCtx,
      programContext: {
        dayNumber: daysInProgram + 1,
        programWeek: Math.ceil((daysInProgram + 1) / 7),
        totalCheckins: checkinsAsc.length,
        firstCheckinDate: firstDate,
      },
    };

    try {
      const report = await generateMilestoneReport(ctx, tierDef.tier);
      const { error: msgErr } = await admin.from("coach_messages").insert({
        user_id: profile.user_id,
        role: "coach",
        body: report,
        ai_generated: true,
      });
      if (msgErr) {
        res.errors.push(`${profile.user_id}: ${msgErr.message}`);
        continue;
      }
      await admin
        .from("athlete_profiles")
        .update({ [tierDef.sentAtColumn]: new Date().toISOString() })
        .eq("user_id", profile.user_id);
      res.sent++;
    } catch (err) {
      res.errors.push(`${profile.user_id}: ${err instanceof Error ? err.message : "report failed"}`);
    }
  }

  return deltas;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: profiles, error } = await admin
    .from("athlete_profiles")
    .select("*");
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const allProfiles = (profiles as AthleteProfile[]) ?? [];

  // Aggregate results across all athletes.
  const results: TierResults = {};
  for (const t of TIERS) results[t.label] = { sent: 0, skipped: 0, errors: [] };

  // Process in batches of BATCH_SIZE to bound concurrency.
  for (let i = 0; i < allProfiles.length; i += BATCH_SIZE) {
    const batch = allProfiles.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(
      batch.map((profile) => processAthlete(profile, today)),
    );
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        for (const [label, delta] of Object.entries(outcome.value)) {
          results[label].sent += delta.sent;
          results[label].skipped += delta.skipped;
          results[label].errors.push(...delta.errors);
        }
      } else {
        // Athlete-level failure (e.g. DB unreachable mid-batch) -- log and continue.
        const msg = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        for (const t of TIERS) results[t.label].errors.push(`batch error: ${msg}`);
      }
    }
  }

  return NextResponse.json({ ok: true, results });
}
