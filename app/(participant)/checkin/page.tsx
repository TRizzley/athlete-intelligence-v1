import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageShell } from "@/components/ui";
import { serverToday } from "@/lib/server-date";
import { CheckinForm } from "./checkin-form";
import { UploadForm } from "@/app/(participant)/upload/upload-form";
import {
  getValidWhoopToken,
  fetchWhoopRecoveries,
  fetchWhoopSleeps,
  fetchWhoopCycles,
  type WhoopTokenRow,
} from "@/lib/whoop";
import type { DailyCheckin, WorkoutDay } from "@/lib/types";

export const metadata = { title: "Daily check-in — The Coach" };

function msToHours(ms: number): number {
  return Math.round((ms / 3_600_000) * 10) / 10;
}

export default async function CheckinPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const admin = createAdminClient();
  const date = await serverToday();

  // Start yesterday so we catch WHOOP cycles that closed overnight.
  const since = new Date(date + "T00:00:00Z");
  since.setUTCDate(since.getUTCDate() - 1);
  const sinceISO = since.toISOString();

  const [{ data: existing }, { data: daysData }, { data: tokenRow }] = await Promise.all([
    supabase
      .from("daily_checkins")
      .select("*")
      .eq("user_id", user.id)
      .eq("checkin_date", date)
      .maybeSingle(),
    supabase
      .from("workout_days")
      .select("id, name, label")
      .eq("user_id", user.id)
      .order("position", { ascending: true }),
    admin
      .from("whoop_tokens")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const existingCheckin = (existing as DailyCheckin) ?? null;
  const days = (daysData as Pick<WorkoutDay, "id" | "name" | "label">[]) ?? [];

  // If WHOOP is connected and today's biometrics are missing, fetch live from
  // the WHOOP API right now — this gets the score from this morning's cycle
  // even if it hasn't been written to our DB yet.
  type BiometricFields = {
    recovery_score?: number | null;
    hrv_ms?: number | null;
    resting_hr?: number | null;
    sleep_hours?: number | null;
    sleep_quality?: number | null;
    spo2_percentage?: number | null;
    skin_temp_celsius?: number | null;
    whoop_strain?: number | null;
    sleep_light_hours?: number | null;
    sleep_sws_hours?: number | null;
    sleep_rem_hours?: number | null;
    sleep_disturbances?: number | null;
    respiratory_rate?: number | null;
  };

  let liveWhoopBiometrics: BiometricFields | null = null;

  if (existingCheckin?.recovery_score == null && tokenRow) {
    try {
      const token = tokenRow as WhoopTokenRow;
      const accessToken = await getValidWhoopToken(token, admin);

      const [recoveries, sleeps, cycles] = await Promise.all([
        fetchWhoopRecoveries(accessToken, sinceISO),
        fetchWhoopSleeps(accessToken, sinceISO),
        fetchWhoopCycles(accessToken, sinceISO),
      ]);

      // Find the most recent scored recovery (covers today or yesterday cycle).
      const latest = recoveries
        .filter((r) => r.score_state === "SCORED" && r.score)
        .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))[0];

      if (latest?.score) {
        // Match the sleep that ended on or after the recovery's date.
        const recDate = latest.created_at.slice(0, 10);
        const matchedSleep = sleeps
          .filter((s) => !s.nap && s.score_state === "SCORED" && s.score)
          .sort((a, b) => (a.end > b.end ? -1 : 1))
          .find((s) => s.end.slice(0, 10) >= recDate);

        // Get daily strain from the matching cycle.
        const matchedCycle = cycles
          .filter((c) => c.score_state === "SCORED" && c.score)
          .sort((a, b) => (a.start > b.start ? -1 : 1))
          .find((c) => c.start.slice(0, 10) === recDate);

        const ss = matchedSleep?.score?.stage_summary;
        liveWhoopBiometrics = {
          recovery_score: Math.round(latest.score.recovery_score),
          hrv_ms: Math.round(latest.score.hrv_rmssd_milli * 10) / 10,
          resting_hr: Math.round(latest.score.resting_heart_rate),
          spo2_percentage: latest.score.spo2_percentage ?? null,
          skin_temp_celsius: latest.score.skin_temp_celsius ?? null,
          whoop_strain: matchedCycle?.score ? Math.round(matchedCycle.score.strain * 10) / 10 : null,
          sleep_hours: ss
            ? msToHours(
                ss.total_light_sleep_time_milli +
                ss.total_slow_wave_sleep_time_milli +
                ss.total_rem_sleep_time_milli,
              )
            : null,
          sleep_quality: matchedSleep?.score?.sleep_efficiency_percentage != null
            ? Math.round(matchedSleep.score.sleep_efficiency_percentage / 10)
            : null,
          sleep_light_hours: ss ? msToHours(ss.total_light_sleep_time_milli) : null,
          sleep_sws_hours: ss ? msToHours(ss.total_slow_wave_sleep_time_milli) : null,
          sleep_rem_hours: ss ? msToHours(ss.total_rem_sleep_time_milli) : null,
          sleep_disturbances: ss?.disturbance_count ?? null,
          respiratory_rate: matchedSleep?.score?.respiratory_rate ?? null,
        };

        // Persist to DB so the coach and dashboard also see it.
        await admin.from("daily_checkins").upsert(
          { user_id: user.id, checkin_date: date, ...liveWhoopBiometrics },
          { onConflict: "user_id,checkin_date", ignoreDuplicates: false },
        );
      }
    } catch {
      // Non-fatal — form just shows blank biometric fields.
    }
  }

  const checkinForForm: DailyCheckin | null = existingCheckin
    ?? (liveWhoopBiometrics
      ? ({ ...liveWhoopBiometrics, checkin_date: date } as unknown as DailyCheckin)
      : null);

  const whoopPrefilled =
    liveWhoopBiometrics != null ||
    (existingCheckin?.recovery_score != null && existingCheckin?.energy == null);

  return (
    <PageShell width="content">
      <div className="mb-6">
        <div className="eyebrow mb-1.5">Morning check-in</div>
        <h1 className="text-2xl font-semibold tracking-tight">How did you wake up?</h1>
        <p className="mt-1.5 text-sm text-muted">
          Do this in the morning: how you slept last night, yesterday&apos;s completed
          fuel, and how you feel right now — anything blank is fine. When you submit,
          your coach reads it (with your screenshots) and opens today&apos;s conversation
          with a plan and a prediction — you can reply right there.
        </p>
      </div>

      <CheckinForm existing={checkinForForm} dateISO={date} workoutDays={days} whoopPrefilled={whoopPrefilled} />

      <details className="mt-8 rounded-2xl border border-border bg-surface/40 p-4">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          Add a screenshot (optional)
        </summary>
        <p className="mb-3 mt-1 text-xs text-muted">
          Snap your Whoop, Oura, Garmin, Apple, or nutrition screen — your coach
          reads the numbers off it. You&apos;ll confirm what we read before it&apos;s used.
        </p>
        <UploadForm dateISO={date} />
      </details>
    </PageShell>
  );
}
