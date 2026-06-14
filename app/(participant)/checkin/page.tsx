import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/ui";
import { serverToday } from "@/lib/server-date";
import { CheckinForm } from "./checkin-form";
import { UploadForm } from "@/app/(participant)/upload/upload-form";
import type { DailyCheckin, WorkoutDay } from "@/lib/types";

export const metadata = { title: "Daily check-in — The Coach" };

export default async function CheckinPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const date = await serverToday();

  const [{ data: existing }, { data: daysData }] = await Promise.all([
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
  ]);

  const days = (daysData as Pick<WorkoutDay, "id" | "name" | "label">[]) ?? [];

  // True when WHOOP has synced biometrics for today but the user hasn't
  // manually filled in subjective fields yet (energy, mood, etc.).
  const existingCheckin = (existing as DailyCheckin) ?? null;
  const whoopPrefilled =
    existingCheckin != null &&
    existingCheckin.recovery_score != null &&
    existingCheckin.energy == null;

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

      <CheckinForm existing={existingCheckin} dateISO={date} workoutDays={days} whoopPrefilled={whoopPrefilled} />

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
