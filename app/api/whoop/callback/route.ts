// GET /api/whoop/callback
// WHOOP OAuth callback — validates nonce, exchanges code, stores token, kicks 30-day sync.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  exchangeWhoopCode,
  fetchWhoopProfile,
  fetchWhoopRecoveries,
  fetchWhoopSleeps,
  fetchWhoopCycles,
} from "@/lib/whoop";

function appUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return `${base}${path}`;
}

function msToHours(ms: number): number {
  return Math.round((ms / 3_600_000) * 10) / 10;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    const desc = searchParams.get("error_description") ?? "no_description";
    return NextResponse.redirect(appUrl(`/dashboard?whoop=error&reason=${encodeURIComponent(error)}&desc=${encodeURIComponent(desc)}`));
  }

  if (!code || !state) {
    const params = JSON.stringify(Object.fromEntries(searchParams));
    return NextResponse.redirect(appUrl(`/dashboard?whoop=error&reason=missing_code_or_state&params=${encodeURIComponent(params)}`));
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(appUrl("/login"));

  const admin = createAdminClient();
  const { data: nonceRow } = await admin
    .from("whoop_oauth_nonces")
    .select("nonce, expires_at")
    .eq("nonce", state)
    .eq("user_id", user.id)
    .maybeSingle();

  await admin.from("whoop_oauth_nonces").delete().eq("nonce", state);

  if (!nonceRow || new Date(nonceRow.expires_at) < new Date()) {
    return NextResponse.redirect(appUrl("/dashboard?whoop=invalid_state"));
  }

  let tokenData;
  try {
    tokenData = await exchangeWhoopCode(code, appUrl("/api/whoop/callback"));
  } catch (err) {
    console.error("WHOOP code exchange failed", err);
    return NextResponse.redirect(appUrl("/dashboard?whoop=token_error"));
  }

  let whoopProfile;
  try {
    whoopProfile = await fetchWhoopProfile(tokenData.access_token);
  } catch (err) {
    console.error("WHOOP profile fetch failed", err);
    return NextResponse.redirect(appUrl("/dashboard?whoop=profile_error"));
  }

  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

  const { error: upsertErr } = await admin.from("whoop_tokens").upsert(
    {
      user_id: user.id,
      whoop_user_id: whoopProfile.user_id,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: expiresAt,
      scope: tokenData.scope ?? null,
    },
    { onConflict: "user_id" },
  );

  if (upsertErr) {
    console.error("whoop_tokens upsert failed", upsertErr);
    return NextResponse.redirect(appUrl("/dashboard?whoop=db_error"));
  }

  // 30-day historical sync while the token is fresh.
  try {
    const start = new Date();
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    const startISO = start.toISOString();

    const [recoveries, sleeps, cycles] = await Promise.all([
      fetchWhoopRecoveries(tokenData.access_token, startISO),
      fetchWhoopSleeps(tokenData.access_token, startISO),
      fetchWhoopCycles(tokenData.access_token, startISO),
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

    for (const rec of recoveries) {
      if (rec.score_state !== "SCORED" || !rec.score) continue;
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

      await admin
        .from("daily_checkins")
        .upsert(update, { onConflict: "user_id,checkin_date", ignoreDuplicates: false });
    }
  } catch (syncErr) {
    console.error("WHOOP post-connect sync failed", syncErr);
  }

  return NextResponse.redirect(appUrl("/dashboard?whoop=connected"));
}
