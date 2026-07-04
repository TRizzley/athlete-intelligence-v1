// GET /api/whoop/callback
// WHOOP OAuth callback — validates nonce, exchanges code, stores token, kicks 30-day sync.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeWhoopCode, fetchWhoopProfile, syncWhoop } from "@/lib/whoop";

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

  // 30-day historical sync while the token is fresh. A failure here must not
  // break the OAuth flow — the athlete is connected either way, and the daily
  // cron will pick up whatever this pass missed.
  try {
    const result = await syncWhoop(user.id, tokenData.access_token, {
      daysBack: 30,
      admin,
    });
    if (result.errors.length > 0) {
      console.error("WHOOP post-connect sync errors:", result.errors);
    }
  } catch (syncErr) {
    console.error("WHOOP post-connect sync failed", syncErr);
  }

  return NextResponse.redirect(appUrl("/dashboard?whoop=connected"));
}
