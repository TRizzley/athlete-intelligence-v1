// ----------------------------------------------------------------------------
// POST /api/whoop/sync
//
// Fetches the last N days of WHOOP recovery, sleep, and cycle data and
// upserts the biometric fields into daily_checkins. Only WHOOP-sourced fields
// are written — any manually entered data on the same date is preserved.
//
// Called manually from the dashboard "Sync WHOOP" button, or can be wired
// into a cron for automatic daily syncing.
// ----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getValidWhoopToken,
  fetchWhoopRecoveries,
  fetchWhoopSleeps,
  type WhoopTokenRow,
} from "@/lib/whoop";

// How many days back to sync on each call.
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
  // Require a logged-in user.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Look up WHOOP token.
  const { data: tokenRow, error: tokenErr } = await admin
    .from("whoop_tokens")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle<WhoopTokenRow>();

  if (tokenErr || !tokenRow) {
    return NextResponse.json({ error: "whoop_not_connected" }, { status: 400 });
  }

  // Get a valid access token (refreshes if needed).
  let accessToken: string;
  try {
    accessToken = await getValidWhoopToken(tokenRow, admin);
  } catch (err) {
    console.error("WHOOP token refresh failed", err);
    return NextResponse.json({ error: "token_refresh_failed" }, { status: 500 });
  }

  const start = daysAgoISO(SYNC_DAYS);

  // Fetch recovery + sleep in parallel.
  let recoveries, sleeps;
  try {
    [recoveries, sleeps] = await Promise.all([
      fetchWhoopRecoveries(accessToken, start),
      fetchWhoopSleeps(accessToken, start),
    ]);
  } catch (err) {
    console.error("WHOOP data fetch failed", err);
    return NextResponse.json({ error: "whoop_fetch_failed" }, { status: 502 });
  }

  // Build a map of date → sleep data (skip naps).
  const sleepByDate = new Map<string, {
    hours: number;
    efficiency: number | null;
  }>();

  for (const sleep of sleeps) {
    if (sleep.nap) continue;
    if (sleep.score_state !== "SCORED" || !sleep.score) continue;

    // Use the end date as the "wake date" (the day the sleep belongs to).
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

  // Upsert each recovery into daily_checkins.
  let synced = 0;
  let skipped = 0;

  for (const rec of recoveries) {
    if (rec.score_state !== "SCORED" || !rec.score) {
      skipped++;
      continue;
    }

    // WHOOP recovery is tied to the cycle's start date.
    const date = rec.created_at.slice(0, 10);
    const sleep = sleepByDate.get(date);

    const update: Record<string, unknown> = {
      user_id: user.id,
      checkin_date: date,
      recovery_score: Math.round(rec.score.recovery_score),
      hrv_ms: Math.round(rec.score.hrv_rmssd_milli * 10) / 10,
      resting_hr: Math.round(rec.score.resting_heart_rate),
    };

    if (sleep) {
      update.sleep_hours = sleep.hours;
      // Map sleep efficiency (0–100) to a 1–10 quality scale.
      if (sleep.efficiency !== null) {
        update.sleep_quality = Math.round(sleep.efficiency / 10);
      }
    }

    const { error: upsertErr } = await admin
      .from("daily_checkins")
      .upsert(update, {
        onConflict: "user_id,checkin_date",
        ignoreDuplicates: false,
      });

    if (upsertErr) {
      console.error(`WHOOP upsert failed for ${date}:`, upsertErr);
      skipped++;
    } else {
      synced++;
    }
  }

  return NextResponse.json({
    ok: true,
    synced,
    skipped,
    days_back: SYNC_DAYS,
  });
}
