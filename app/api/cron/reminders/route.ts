// ----------------------------------------------------------------------------
// GET /api/cron/reminders
//
// Morning check-in reminder via native push (APNs). Replaces the old SMS plan:
// no phone number, no Twilio — just a push to the athlete's registered device.
//
// Sends to the athlete's `users.push_token`, which the iOS app registers via
// components/push-opt-in.tsx -> dashboard/push-actions.ts. The token is set by
// lib/native.ts registerForPush() inside the Capacitor shell.
//
// Runs as an hourly Vercel Cron tick (see vercel.json), protected by CRON_SECRET.
// It only sends at the configured local hour (default 9am in REMINDER_TIMEZONE)
// and only to athletes who (a) have a push token, (b) haven't checked in today,
// and (c) haven't already been reminded today. Per-day idempotency uses the
// existing athlete_profiles.morning_reminder_date column.
//
// ENV-GATED: if APNs isn't configured (see lib/push.ts) it safely no-ops, so
// this can ship now and "turn on" once the APNs key exists (active Apple acct).
// ----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPush, pushConfigured } from "@/lib/push";
import { todayInTz } from "@/lib/format";

export const runtime = "nodejs"; // http2/crypto in lib/push need Node, not edge
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
}

function localHour(tz: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
  );
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // APNS reminders stubbed out for Phase 1. Restore by setting APNS_ENABLED=true
  // and providing keys (APNS_KEY_ID, APNS_KEY_P8) when ready.
  if (process.env.APNS_ENABLED !== "true") {
    return NextResponse.json({ ok: true, message: "APNS reminders disabled" });
  }

  const tz = process.env.REMINDER_TIMEZONE || "America/New_York";
  const localDate = todayInTz(tz);
  const hour = localHour(tz);
  const remindHour = Number(process.env.REMINDER_MORNING_HOUR ?? 9);

  if (!pushConfigured()) {
    return NextResponse.json({ ok: true, skipped: "apns_not_configured", localDate, hour });
  }
  if (hour !== remindHour) {
    return NextResponse.json({ ok: true, localDate, hour, note: "not_reminder_hour" });
  }

  const admin = createAdminClient();

  // Athletes who have registered a device for push.
  const { data: userRows } = await admin
    .from("users")
    .select("id, push_token")
    .not("push_token", "is", null);
  const tokenById = new Map<string, string>();
  (userRows ?? []).forEach((u) => {
    const r = u as { id: string; push_token: string | null };
    if (r.push_token) tokenById.set(r.id, r.push_token);
  });
  const ids = [...tokenById.keys()];
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, localDate, hour, sent: 0 });
  }

  // Already reminded today? (per-day idempotency)
  const { data: profiles } = await admin
    .from("athlete_profiles")
    .select("user_id, morning_reminder_date")
    .in("user_id", ids);
  const remindedToday = new Set(
    (profiles ?? [])
      .map((p) => p as { user_id: string; morning_reminder_date: string | null })
      .filter((p) => p.morning_reminder_date === localDate)
      .map((p) => p.user_id),
  );

  // Already checked in today? (don't nag people who've done it)
  const { data: checkins } = await admin
    .from("daily_checkins")
    .select("user_id")
    .eq("checkin_date", localDate)
    .in("user_id", ids);
  const checkedIn = new Set(
    (checkins ?? []).map((c) => (c as { user_id: string }).user_id),
  );

  const targets = ids.filter((id) => !remindedToday.has(id) && !checkedIn.has(id));

  let sent = 0;
  const errors: string[] = [];

  for (const id of targets) {
    const token = tokenById.get(id);
    if (!token) continue;

    const r = await sendPush(token, {
      title: "Time to check in",
      body: "A quick check-in keeps your coach dialed in to today.",
      path: "/checkin",
    });

    if ("ok" in r && r.ok) {
      sent += 1;
    } else if ("ok" in r && !r.ok) {
      errors.push(`${r.status ?? ""} ${r.reason ?? ""}`.trim());
      // Clear a dead token so we stop trying it (the app re-registers on next open).
      if (r.status === 410 || r.reason === "Unregistered" || r.reason === "BadDeviceToken") {
        await admin.from("users").update({ push_token: null }).eq("id", id);
      }
    }

    // Mark reminded today so later ticks skip this athlete.
    await admin
      .from("athlete_profiles")
      .update({ morning_reminder_date: localDate })
      .eq("user_id", id);
  }

  return NextResponse.json({ ok: true, localDate, hour, sent, errors });
}
