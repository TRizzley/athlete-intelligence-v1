// ----------------------------------------------------------------------------
// GET /api/cron/checkin-reminders
//
// Daily job: text every athlete who has a phone on file but hasn't logged a
// check-in yet today, nudging them to do it. Idempotent per day via
// athlete_profiles.last_checkin_reminder_at, so re-runs won't double-text.
//
// Scheduled by Vercel Cron (see vercel.json). Vercel automatically sends an
// "Authorization: Bearer <CRON_SECRET>" header when CRON_SECRET is set, which we
// require here so the endpoint can't be triggered by anyone else.
// ----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendSms, smsConfigured } from "@/lib/sms";

export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // refuse to run until a secret is configured
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "";
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!smsConfigured()) {
    return NextResponse.json({ ok: true, skipped: "SMS not configured" });
  }

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10); // UTC calendar day
  const base = appBaseUrl();
  const checkinLink = base ? `${base}/checkin` : "your check-in";

  const { data: profiles, error } = await admin
    .from("athlete_profiles")
    .select("user_id, full_name, phone, last_checkin_reminder_at")
    .not("phone", "is", null);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const p of profiles ?? []) {
    const phone = (p as { phone: string | null }).phone;
    if (!phone) {
      skipped++;
      continue;
    }

    // Already reminded today?
    const last = (p as { last_checkin_reminder_at: string | null }).last_checkin_reminder_at;
    if (last && last.slice(0, 10) === today) {
      skipped++;
      continue;
    }

    // Already checked in today? Then no nudge needed.
    const { data: ci } = await admin
      .from("daily_checkins")
      .select("id")
      .eq("user_id", (p as { user_id: string }).user_id)
      .eq("checkin_date", today)
      .maybeSingle();
    if (ci) {
      skipped++;
      continue;
    }

    const first =
      ((p as { full_name: string | null }).full_name || "there").trim().split(/\s+/)[0];
    const body =
      `Hey ${first}, quick reminder to log today's check-in with your coach: ${checkinLink} ` +
      `(reply STOP to opt out)`;

    const r = await sendSms(phone, body);
    if (r.ok) {
      sent++;
      await admin
        .from("athlete_profiles")
        .update({ last_checkin_reminder_at: new Date().toISOString() })
        .eq("user_id", (p as { user_id: string }).user_id);
    } else {
      errors.push(`${(p as { user_id: string }).user_id}: ${r.error}`);
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, errors });
}
