// ----------------------------------------------------------------------------
// GET /api/cron/reminders  — the SMS reminder "tick"
//
// Designed to be called frequently (every ~15 min). On each tick it sends, when
// due and not already sent:
//   • Morning check-in reminder  — ~9am local, if no check-in logged today.
//   • Post-workout reminder      — ~7pm local, if no post-workout logged today.
//   • Feedback nudge             — ~15 min after a coach response is sent, if the
//                                  athlete hasn't given feedback on it yet.
//
// "Local" uses REMINDER_TIMEZONE (default America/New_York) — a single app
// timezone for the beta; can be made per-athlete later. Idempotent via
// athlete_profiles.morning_reminder_date / postworkout_reminder_date and
// coach_responses.feedback_reminder_at. Protected by CRON_SECRET.
// ----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendSms, smsConfigured } from "@/lib/sms";
import type { AthleteProfile, CoachResponse } from "@/lib/types";

export const maxDuration = 60;

const MORNING_HOUR = 9; // 9am local
const POSTWORKOUT_HOUR = 19; // 7pm local

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "";
}

// Athlete-local date (YYYY-MM-DD) and hour (0-23) in the configured timezone.
function localNow(tz: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = parseInt(get("hour"), 10) % 24;
  return { date, hour };
}

function firstName(name: string | null): string {
  return (name || "there").trim().split(/\s+/)[0];
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  if (!smsConfigured()) {
    return NextResponse.json({ ok: true, skipped: "SMS not configured" });
  }

  const admin = createAdminClient();
  const tz = process.env.REMINDER_TIMEZONE || "America/New_York";
  const { date: localDate, hour } = localNow(tz);
  const base = appBaseUrl();

  const { data: profData, error } = await admin
    .from("athlete_profiles")
    .select(
      "user_id, full_name, phone, morning_reminder_date, postworkout_reminder_date",
    )
    .not("phone", "is", null);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const profiles = (profData as Pick<
    AthleteProfile,
    "user_id" | "full_name" | "phone" | "morning_reminder_date" | "postworkout_reminder_date"
  >[]) ?? [];

  let morning = 0;
  let postworkout = 0;
  let feedback = 0;
  const errors: string[] = [];

  // --- Morning + post-workout reminders (time-of-day gated) -----------------
  for (const p of profiles) {
    const phone = p.phone as string;
    const first = firstName(p.full_name);

    // Today's check-in row (one per day).
    const needCheckinRow =
      (hour === MORNING_HOUR && p.morning_reminder_date !== localDate) ||
      (hour === POSTWORKOUT_HOUR && p.postworkout_reminder_date !== localDate);
    let row: { workout_completed: boolean | null } | null = null;
    if (needCheckinRow) {
      const { data: ci } = await admin
        .from("daily_checkins")
        .select("id, workout_completed")
        .eq("user_id", p.user_id)
        .eq("checkin_date", localDate)
        .maybeSingle();
      row = (ci as { workout_completed: boolean | null } | null) ?? null;
    }

    if (hour === MORNING_HOUR && p.morning_reminder_date !== localDate) {
      if (!row) {
        const r = await sendSms(
          phone,
          `Good morning ${first}! Don't forget your morning check-in so your coach can plan today: ${base}/checkin (reply STOP to opt out)`,
        );
        if (r.ok) morning++;
        else errors.push(`morning ${p.user_id}: ${r.error}`);
      }
      await admin
        .from("athlete_profiles")
        .update({ morning_reminder_date: localDate })
        .eq("user_id", p.user_id);
    }

    if (hour === POSTWORKOUT_HOUR && p.postworkout_reminder_date !== localDate) {
      const trained = row?.workout_completed !== null && row?.workout_completed !== undefined;
      if (!trained) {
        const r = await sendSms(
          phone,
          `Hey ${first}, log your post-workout check-in so your coach can see how today went: ${base}/post-workout (reply STOP to opt out)`,
        );
        if (r.ok) postworkout++;
        else errors.push(`postworkout ${p.user_id}: ${r.error}`);
      }
      await admin
        .from("athlete_profiles")
        .update({ postworkout_reminder_date: localDate })
        .eq("user_id", p.user_id);
    }
  }

  // --- Feedback nudge: ~15 min after a sent response with no feedback yet ----
  const now = Date.now();
  const cutoff = new Date(now - 15 * 60 * 1000).toISOString(); // sent > 15 min ago
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString(); // but within a day
  const phoneByUser = new Map(profiles.map((p) => [p.user_id, p.phone as string]));
  const nameByUser = new Map(profiles.map((p) => [p.user_id, p.full_name]));

  const { data: respData } = await admin
    .from("coach_responses")
    .select("id, user_id, sent_at")
    .eq("status", "sent")
    .is("feedback_reminder_at", null)
    .lt("sent_at", cutoff)
    .gt("sent_at", dayAgo)
    .limit(100);
  const responses = (respData as Pick<CoachResponse, "id" | "user_id" | "sent_at">[]) ?? [];

  for (const resp of responses) {
    const phone = phoneByUser.get(resp.user_id);
    // Stamp regardless so we evaluate each response once.
    if (phone) {
      const { data: fb } = await admin
        .from("user_feedback")
        .select("id")
        .eq("coach_response_id", resp.id)
        .maybeSingle();
      if (!fb) {
        const first = firstName(nameByUser.get(resp.user_id) ?? null);
        const r = await sendSms(
          phone,
          `Hey ${first}, your coach sent today's plan — 30 seconds of feedback makes it sharper: ${base}/feedback/${resp.id} (reply STOP to opt out)`,
        );
        if (r.ok) feedback++;
        else errors.push(`feedback ${resp.id}: ${r.error}`);
      }
    }
    await admin
      .from("coach_responses")
      .update({ feedback_reminder_at: new Date().toISOString() })
      .eq("id", resp.id);
  }

  return NextResponse.json({
    ok: true,
    localDate,
    hour,
    tz,
    sent: { morning, postworkout, feedback },
    errors,
  });
}
