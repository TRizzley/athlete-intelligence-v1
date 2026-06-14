// ----------------------------------------------------------------------------
// GET /api/whoop/callback
//
// WHOOP redirects here after the user authorizes (or denies) access.
// Validates the nonce, exchanges the code for tokens, fetches the user
// profile to get the whoop_user_id, and upserts the token row.
//
// Query params WHOOP sends:
//   ?code=xxx&state=<nonce>       — success
//   ?error=access_denied&...      — user declined
// ----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeWhoopCode, fetchWhoopProfile, fetchWhoopRecoveries, fetchWhoopSleeps } from "@/lib/whoop";
import { cookies } from "next/headers";

function appUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return `${base}${path}`;
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

  // Validate nonce
  const cookieStore = await cookies();
  const storedNonce = cookieStore.get("whoop_oauth_nonce")?.value;
  cookieStore.delete("whoop_oauth_nonce");

  if (!storedNonce || storedNonce !== state) {
    return NextResponse.redirect(appUrl("/dashboard?whoop=invalid_state"));
  }

  // Require a Supabase session
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(appUrl("/login"));
  }

  // Exchange code for tokens
  let tokenData;
  try {
    tokenData = await exchangeWhoopCode(code, appUrl("/api/whoop/callback"));
  } catch (err) {
    console.error("WHOOP code exchange failed", err);
    return NextResponse.redirect(appUrl("/dashboard?whoop=token_error"));
  }

  // Fetch WHOOP user profile to get whoop_user_id
  let whoopProfile;
  try {
    whoopProfile = await fetchWhoopProfile(tokenData.access_token);
  } catch (err) {
    console.error("WHOOP profile fetch failed", err);
    return NextResponse.redirect(appUrl("/dashboard?whoop=profile_error"));
  }

  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
  const admin = createAdminClient();

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

  // Trigger a 30-day historical sync immediately while the token is fresh.
  try {
    const SYNC_DAYS = 30;
    const start = new Date();
    start.setDate(start.getDate() - SYNC_DAYS);
    start.setHours(0, 0, 0, 0);
    const startISO = start.toISOString();

    function msToHours(ms: number): number {
      return Math.round((ms / 3_600_000) * 10) / 10;
    }

    const [recoveries, sleeps] = await Promise.all([
      fetchWhoopRecoveries(tokenData.access_token, startISO),
      fetchWhoopSleeps(tokenData.access_token, startISO),
    ]);

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
      };

      if (sleep) {
        update.sleep_hours = sleep.hours;
        if (sleep.efficiency !== null) {
          update.sleep_quality = Math.round(sleep.efficiency / 10);
        }
      }

      await admin
        .from("daily_checkins")
        .upsert(update, { onConflict: "user_id,checkin_date", ignoreDuplicates: false });
    }
  } catch (syncErr) {
    // Non-fatal: token is stored, user is connected, sync can retry later.
    console.error("WHOOP post-connect sync failed", syncErr);
  }

  return NextResponse.redirect(appUrl("/dashboard?whoop=connected"));
}
