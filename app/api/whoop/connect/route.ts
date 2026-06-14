// ----------------------------------------------------------------------------
// GET /api/whoop/connect
//
// Initiates the WHOOP OAuth flow. User must be signed in (Supabase session
// required). Stores a nonce in a short-lived cookie, then redirects to
// WHOOP's authorization page.
// ----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { whoopAuthUrl } from "@/lib/whoop";
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
  const redirectUri = appUrl("/api/whoop/callback");

  const cookieStore = await cookies();
  cookieStore.set("whoop_oauth_nonce", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  return NextResponse.redirect(whoopAuthUrl(redirectUri, nonce));
}
