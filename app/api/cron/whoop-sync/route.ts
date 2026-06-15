// GET /api/cron/whoop-sync
// Runs daily via Vercel Cron. Syncs last 7 days for all WHOOP users.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getValidWhoopToken,
  fetchWhoopRecoveries,
  fetchWhoopSleeps,
  fetchWhoopCycles,
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
  const { data: tokens, error } = await admin.from("whoop_tokens").select("*");

  if (error || !tokens) {
    return NextResponse.json({ error: "failed_to_load_tokens" }, { status: 500 });
  }

  const start = daysAgoISO(SYNC_DAYS);
  const results: { user_id: string; synced: number; error?: string }[] = [];

  for (const tokenRow of tokens as WhoopTokenRow[]) {
    try {
      const accessToken = await getValidWhoopToken(tokenRow, admin);

      const [recoveries, sleeps, cycles] = await Promise.all([
        fetchWhoopRecoveries(accessToken, start),
        fetchWhoopSleeps(accessToken, start),
        fetchWhoopCycles(accessToken, start),
      ]);

      type SleepEntry = {
        hours: number; efficiency: number | null;
        light_hours: number | null; sws_hours: number | null; rem_hours: number | null;
        disturbances: number | null; respiratory_rate: number | null;
      };
      const sleepByDate = new Map<string, SleepEntry>();
      for (const sleep of sleeps) {
        if (sleep.nap || sleep.score_state !== "SCORED" || !sleep.score) continue;
        const date = sleep.end.slice(0, 10);
        const ss = sleep.score.stage_summary;
        const totalMs = ss.total_light_sleep_time_milli + ss.total_slow_wave_sleep_time_milli + ss.total_rem_sleep_time_milli;
        sleepByDate.set(date, {
          hours: msToHours(totalMs),
          efficiency: sleep.score.sleep_efficiency_percentage ?? null,
          light_hours: msToHours(ss.total_light_sleep_time_milli),
          sws_hours: msToHours(ss.total_slow_wave_sleep_time_milli),
          rem_hours: msToHours(ss.total_rem_sleep_time_milli),
          disturbances: ss.disturbance_count ?? null,
          respiratory_rate: sleep.score.respiratory_rate ?? null,
        });
      }

      const strainByDate = new Map<string, number>();
      for (const cycle of cycles) {
        if (cycle.score_state !== "SCORED" || !cycle.score) continue;
        strainByDate.set(cycle.start.slice(0, 10), Math.round(cycle.score.strain * 10) / 10);
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
          spo2_percentage: rec.score.spo2_percentage ?? null,
          skin_temp_celsius: rec.score.skin_temp_celsius ?? null,
          whoop_strain: strainByDate.get(date) ?? null,
        };

        if (sleep) {
          update.sleep_hours = sleep.hours;
          if (sleep.efficiency !== null) update.sleep_quality = Math.round(sleep.efficiency / 10);
          update.sleep_light_hours = sleep.light_hours;
          update.sleep_sws_hours = sleep.sws_hours;
          update.sleep_rem_hours = sleep.rem_hours;
          update.sleep_disturbances = sleep.disturbances;
          update.respiratory_rate = sleep.respiratory_rate;
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
