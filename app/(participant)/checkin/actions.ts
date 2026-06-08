"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error: string | null };

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function intOrNull(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (v === null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function floatOrNull(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function boolOrNull(fd: FormData, key: string): boolean | null {
  const v = str(fd, key);
  if (v === "yes") return true;
  if (v === "no") return false;
  return null;
}

// Hours of sleep between a bed time and a wake time ("HH:MM"), rolling past
// midnight (e.g. 22:30 -> 06:15 = 7.75h). Rounded to two decimals.
function sleepHoursFromTimes(bed: string, wake: string): number | null {
  const toMin = (t: string): number | null => {
    const [h, m] = t.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  };
  const b = toMin(bed);
  const w = toMin(wake);
  if (b === null || w === null) return null;
  let diff = w - b;
  if (diff <= 0) diff += 24 * 60; // crossed midnight
  return Math.round((diff / 60) * 100) / 100;
}

export async function saveCheckin(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Please sign in again." };

  const checkinDate = str(formData, "checkin_date");
  if (!checkinDate) return { error: "Please choose a date." };

  // Multi-select workout types; keep the legacy single column in sync (first pick).
  const workoutTypes = formData
    .getAll("workout_types")
    .map(String)
    .filter(Boolean);

  // Derive sleep duration from bed/wake times when the athlete didn't type hours.
  const bedTime = str(formData, "bed_time");
  const wakeTime = str(formData, "wake_time");
  let sleepHours = floatOrNull(formData, "sleep_hours");
  if (sleepHours === null && bedTime && wakeTime) {
    sleepHours = sleepHoursFromTimes(bedTime, wakeTime);
  }

  const payload = {
    user_id: user.id,
    checkin_date: checkinDate,
    sleep_hours: sleepHours,
    sleep_quality: intOrNull(formData, "sleep_quality"),
    recovery_score: intOrNull(formData, "recovery_score"),
    hrv_ms: intOrNull(formData, "hrv_ms"),
    resting_hr: intOrNull(formData, "resting_hr"),
    body_weight_lbs: floatOrNull(formData, "body_weight_lbs"),
    calories: intOrNull(formData, "calories"),
    protein_g: intOrNull(formData, "protein_g"),
    carbs_g: intOrNull(formData, "carbs_g"),
    fat_g: intOrNull(formData, "fat_g"),
    water_oz: floatOrNull(formData, "water_oz"),
    workout_completed: boolOrNull(formData, "workout_completed"),
    workout_types: workoutTypes,
    workout_type: workoutTypes[0] ?? null,
    workout_split: str(formData, "workout_split"),
    training_load: str(formData, "training_load"),
    top_set_lbs: floatOrNull(formData, "top_set_lbs"),
    bed_time: bedTime,
    wake_time: wakeTime,
    workout_intensity: intOrNull(formData, "workout_intensity"),
    soreness: intOrNull(formData, "soreness"),
    energy: intOrNull(formData, "energy"),
    mood: intOrNull(formData, "mood"),
    stress: intOrNull(formData, "stress"),
    motivation: intOrNull(formData, "motivation"),
    pain_injury_note: str(formData, "pain_injury_note"),
    open_comments: str(formData, "open_comments"),
  };

  const { error } = await supabase
    .from("daily_checkins")
    .upsert(payload, { onConflict: "user_id,checkin_date" });

  if (error) {
    console.error(
      `[checkin] save failed for user=${user.id} date=${checkinDate}:`,
      error.message,
    );
    return {
      error: `Could not save your check-in: ${error.message}. Please try again.`,
    };
  }

  console.log(`[checkin] saved for user=${user.id} date=${checkinDate}`);

  revalidatePath("/dashboard");
  revalidatePath("/checkin");
  // The coach console reads check-ins too; make sure it reflects this submission.
  revalidatePath("/admin");
  redirect("/dashboard?saved=checkin");
}
