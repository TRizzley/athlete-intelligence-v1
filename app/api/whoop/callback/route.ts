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
import { exchangeWhoopCode, fetchWhoopProfile } from "@/lib/whoop";
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

  return NextResponse.redirect(appUrl("/dashboard?whoop=connected"));
}
