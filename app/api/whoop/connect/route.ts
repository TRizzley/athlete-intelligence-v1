// ----------------------------------------------------------------------------
// GET /api/whoop/connect
//
// Initiates the WHOOP OAuth flow. User must be signed in (Supabase session
// required). Stores a nonce in a short-lived cookie, then redirects to
// WHOOP's authorization page.
// ----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { whoopAuthUrl } from "@/lib/whoop";
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

  // Store nonce in DB — cookies are unreliable on mobile OAuth redirects
  // (iOS Safari PWA opens WHOOP in a separate browser context, losing cookies).
  const admin = createAdminClient();
  const { error } = await admin.from("whoop_oauth_nonces").insert({
    nonce,
    user_id: user.id,
  });

  if (error) {
    console.error("Failed to store WHOOP nonce", error);
    return NextResponse.redirect(appUrl("/dashboard?whoop=error&reason=nonce_store_failed"));
  }

  return NextResponse.redirect(whoopAuthUrl(redirectUri, nonce));
}
