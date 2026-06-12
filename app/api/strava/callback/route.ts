// ----------------------------------------------------------------------------
// GET /api/strava/callback
//
// Strava redirects here after the athlete authorizes (or denies) access.
// Validates the nonce, exchanges the code for tokens, and upserts the token
// row in strava_tokens. On success, redirects to the dashboard (or an error
// page on failure).
//
// Query params Strava sends:
//   ?code=xxx&scope=xxx&state=<nonce>     — success
//   ?error=access_denied&state=<nonce>   — user declined
// ----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeStravaCode } from "@/lib/strava";
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

  if (error === "access_denied") {
    return NextResponse.redirect(appUrl("/dashboard?strava=denied"));
  }

  if (!code || !state) {
    return NextResponse.redirect(appUrl("/dashboard?strava=error"));
  }

  // Validate nonce.
  const cookieStore = await cookies();
  const storedNonce = cookieStore.get("strava_oauth_nonce")?.value;
  cookieStore.delete("strava_oauth_nonce");

  if (!storedNonce || storedNonce !== state) {
    return NextResponse.redirect(appUrl("/dashboard?strava=invalid_state"));
  }

  // Require a Supabase session.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(appUrl("/login"));
  }

  // Exchange the code for tokens.
  let tokenData;
  try {
    tokenData = await exchangeStravaCode(code, appUrl("/api/strava/callback"));
  } catch (err) {
    console.error("Strava code exchange failed", err);
    return NextResponse.redirect(appUrl("/dashboard?strava=token_error"));
  }

  const admin = createAdminClient();
  const expiresAt = new Date(tokenData.expires_at * 1000).toISOString();

  // Upsert the token row (one row per user_id, keyed on strava_athlete_id).
  const { error: upsertErr } = await admin.from("strava_tokens").upsert(
    {
      user_id: user.id,
      strava_athlete_id: tokenData.athlete.id,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: expiresAt,
      scope: ("scope" in tokenData ? tokenData.scope : null) ?? null,
    },
    { onConflict: "user_id" },
  );

  if (upsertErr) {
    console.error("strava_tokens upsert failed", upsertErr);
    return NextResponse.redirect(appUrl("/dashboard?strava=db_error"));
  }

  return NextResponse.redirect(appUrl("/dashboard?strava=connected"));
}
