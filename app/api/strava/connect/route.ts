// ----------------------------------------------------------------------------
// GET /api/strava/connect
//
// Initiates the Strava OAuth flow. The athlete must be signed in (Supabase
// session required). Stores a nonce in a short-lived cookie, then redirects
// to Strava's authorization page.
//
// After Strava redirects back, /api/strava/callback completes the exchange.
// ----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stravaAuthUrl } from "@/lib/strava";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";

function appUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return `${base}${path}`;
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(appUrl("/login"));
  }

  const nonce = randomUUID();
  const redirectUri = appUrl("/api/strava/callback");

  // Store nonce in a secure, HttpOnly, short-lived cookie.
  const cookieStore = await cookies();
  cookieStore.set("strava_oauth_nonce", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  return NextResponse.redirect(stravaAuthUrl(redirectUri, nonce));
}
