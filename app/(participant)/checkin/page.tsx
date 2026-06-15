import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/ui";
import { serverToday } from "@/lib/server-date";
import { CheckinForm } from "./checkin-form";
import { UploadForm } from "@/app/(participant)/upload/upload-form";
import type { DailyCheckin, WorkoutDay } from "@/lib/types";

export const metadata = { title: "Daily check-in — The Coach" };

function yesterday(dateISO: string): string {
  const d = new Date(dateISO + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default async function CheckinPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const date = await serverToday();
  const prev = yesterday(date);

  const [{ data: existing }, { data: daysData }, { data: prevCheckin }] = await Promise.all([
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
    // Yesterday's row — used to pre-fill WHOOP biometrics when today's aren't
    // available yet (WHOOP dates the recovery cycle to when sleep started).
    supabase
      .from("daily_checkins")
      .select("recovery_score, hrv_ms, resting_hr, sleep_hours, sleep_quality")
      .eq("user_id", user.id)
      .eq("checkin_date", prev)
      .maybeSingle(),
  ]);

  const existingCheckin = (existing as DailyCheckin) ?? null;
  const days = (daysData as Pick<WorkoutDay, "id" | "name" | "label">[]) ?? [];

  // Use yesterday's WHOOP biometrics to pre-fill when today's aren't synced yet.
  type BiometricFields = {
    recovery_score?: number | null;
    hrv_ms?: number | null;
    resting_hr?: number | null;
    sleep_hours?: number | null;
    sleep_quality?: number | null;
  };
  const yesterdayBiometrics = prevCheckin as BiometricFields | null;
  const whoopFallback =
    existingCheckin?.recovery_score == null &&
    yesterdayBiometrics?.recovery_score != null
      ? yesterdayBiometrics
      : null;

  // Merge fallback into the existing checkin so CheckinForm can use defaultValue.
  const checkinForForm: DailyCheckin | null = existingCheckin
    ? existingCheckin
    : whoopFallback
      ? ({ ...whoopFallback, checkin_date: date } as unknown as DailyCheckin)
      : null;

  const whoopPrefilled =
    whoopFallback != null ||
    (existingCheckin?.recovery_score != null && existingCheckin?.energy == null);

  return (
    <PageShell width="content">
      <div className="mb-6">
        <div className="eyebrow mb-1.5">Morning check-in</div>
        <h1 className="text-2xl font-semibold tracking-tight">How did you wake up?</h1>
        <p className="mt-1.5 text-sm text-muted">
          Do this in the morning: how you slept last night, yesterday's completed
          fuel, and how you feel right now — anything blank is fine. When you submit,
          your coach reads it (with your screenshots) and opens today's conversation
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
