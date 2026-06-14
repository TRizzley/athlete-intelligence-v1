// ----------------------------------------------------------------------------
// GET /api/cron/whoop-sync
//
// Runs daily via Vercel Cron. Loops over every user with a connected WHOOP
// account and syncs the last 7 days of recovery + sleep into daily_checkins.
//
// Protected by CRON_SECRET (same pattern as /api/cron/reminders).
// ----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getValidWhoopToken,
  fetchWhoopRecoveries,
  fetchWhoopSleeps,
  type WhoopTokenRow,
} from "@/lib/whoop";

export const maxDuration = 60;

const SYNC_DAYS = 7;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function msToHours(ms: number): number {
  return Math.round((ms / 3_600_000) * 10) / 10;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Fetch all connected WHOOP tokens.
  const { data: tokens, error } = await admin
    .from("whoop_tokens")
    .select("*");

  if (error || !tokens) {
    return NextResponse.json({ error: "failed_to_load_tokens" }, { status: 500 });
  }

  const start = daysAgoISO(SYNC_DAYS);
  const results: { user_id: string; synced: number; error?: string }[] = [];

  for (const tokenRow of tokens as WhoopTokenRow[]) {
    try {
      const accessToken = await getValidWhoopToken(tokenRow, admin);

      const [recoveries, sleeps] = await Promise.all([
        fetchWhoopRecoveries(accessToken, start),
        fetchWhoopSleeps(accessToken, start),
      ]);

      // Build sleep map (date → hours + efficiency).
      const sleepByDate = new Map<string, { hours: number; efficiency: number | null }>();
      for (const sleep of sleeps) {
        if (sleep.nap || sleep.score_state !== "SCORED" || !sleep.score) continue;
        const date = sleep.end.slice(0, 10);
        const totalSleepMs =
          sleep.score.stage_summary.total_light_sleep_time_milli +
          sleep.score.stage_summary.total_slow_wave_sleep_time_milli +
          sleep.score.stage_summary.total_rem_sleep_time_milli;
        sleepByDate.set(date, {
          hours: msToHours(totalSleepMs),
          efficiency: sleep.score.sleep_efficiency_percentage ?? null,
        });
      }

      let synced = 0;
      for (const rec of recoveries) {
        if (rec.score_state !== "SCORED" || !rec.score) continue;

        const date = rec.created_at.slice(0, 10);
        const sleep = sleepByDate.get(date);

        const update: Record<string, unknown> = {
          user_id: tokenRow.user_id,
          checkin_date: date,
          recovery_score: Math.round(rec.score.recovery_score),
          hrv_ms: Math.round(rec.score.hrv_rmssd_milli * 10) / 10,
          resting_hr: Math.round(rec.score.resting_heart_rate),
        };

        if (sleep) {
          update.sleep_hours = sleep.hours;
          if (sleep.efficiency !== null) {
            update.sleep_quality = Math.round(sleep.efficiency / 10);
          }
        }

        const { error: upsertErr } = await admin
          .from("daily_checkins")
          .upsert(update, { onConflict: "user_id,checkin_date", ignoreDuplicates: false });

        if (!upsertErr) synced++;
      }

      results.push({ user_id: tokenRow.user_id, synced });
    } catch (err) {
      console.error(`WHOOP sync failed for user ${tokenRow.user_id}:`, err);
      results.push({ user_id: tokenRow.user_id, synced: 0, error: String(err) });
    }
  }

  return NextResponse.json({ ok: true, results });
}
