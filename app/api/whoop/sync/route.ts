// POST /api/whoop/sync
// Fetches the last N days of WHOOP data and upserts into daily_checkins.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getValidWhoopToken,
  fetchWhoopRecoveries,
  fetchWhoopSleeps,
  fetchWhoopCycles,
  type WhoopTokenRow,
} from "@/lib/whoop";

const SYNC_DAYS = 30;

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function msToHours(ms: number): number {
  return Math.round((ms / 3_600_000) * 10) / 10;
}

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: tokenRow, error: tokenErr } = await admin
    .from("whoop_tokens")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle<WhoopTokenRow>();

  if (tokenErr || !tokenRow) {
    return NextResponse.json({ error: "whoop_not_connected" }, { status: 400 });
  }

  let accessToken: string;
  try {
    accessToken = await getValidWhoopToken(tokenRow, admin);
  } catch (err) {
    console.error("WHOOP token refresh failed", err);
    return NextResponse.json({ error: "token_refresh_failed" }, { status: 500 });
  }

  const start = daysAgoISO(SYNC_DAYS);

  let recoveries, sleeps, cycles;
  try {
    [recoveries, sleeps, cycles] = await Promise.all([
      fetchWhoopRecoveries(accessToken, start),
      fetchWhoopSleeps(accessToken, start),
      fetchWhoopCycles(accessToken, start),
    ]);
  } catch (err) {
    console.error("WHOOP data fetch failed", err);
    return NextResponse.json({ error: "whoop_fetch_failed" }, { status: 502 });
  }

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
  let skipped = 0;

  for (const rec of recoveries) {
    if (rec.score_state !== "SCORED" || !rec.score) { skipped++; continue; }

    const date = rec.created_at.slice(0, 10);
    const sleep = sleepByDate.get(date);

    const update: Record<string, unknown> = {
      user_id: user.id,
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

    if (upsertErr) { console.error(`WHOOP upsert failed for ${date}:`, upsertErr); skipped++; }
    else synced++;
  }

  return NextResponse.json({ ok: true, synced, skipped, days_back: SYNC_DAYS });
}
