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

// Post-workout check-in: the athlete logs how today's session actually went.
// It writes ONLY the training/effort columns onto the same dated daily_checkins
// row created by the morning check-in. Supabase upsert updates just the columns
// we pass, so this never disturbs the morning recovery/fuel/feel data.
export async function savePostWorkout(
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

  const payload = {
    user_id: user.id,
    checkin_date: checkinDate,
    workout_completed: boolOrNull(formData, "workout_completed"),
    workout_types: workoutTypes,
    workout_type: workoutTypes[0] ?? null,
    workout_split: str(formData, "workout_split"),
    workout_intensity: intOrNull(formData, "workout_intensity"),
    training_load: str(formData, "training_load"),
    top_set_lbs: floatOrNull(formData, "top_set_lbs"),
  };

  const { error } = await supabase
    .from("daily_checkins")
    .upsert(payload, { onConflict: "user_id,checkin_date" });

  if (error) {
    console.error(
      `[post-workout] save failed for user=${user.id} date=${checkinDate}:`,
      error.message,
    );
    return {
      error: `Could not save your post-workout check-in: ${error.message}. Please try again.`,
    };
  }

  console.log(`[post-workout] saved for user=${user.id} date=${checkinDate}`);

  revalidatePath("/dashboard");
  revalidatePath("/post-workout");
  revalidatePath("/admin");
  // Chat-first flow: land the athlete in the conversation, where the coach's
  // workout review is generated and posted (expect=review shows the typing state).
  redirect("/coach/chat?expect=review");
}
