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

function numOrNull(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function saveProfile(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Please sign in again." };

  const fullName = str(formData, "full_name");
  const trainingAge = str(formData, "training_age");

  if (!fullName) return { error: "Please enter your name." };
  if (!str(formData, "primary_sport"))
    return { error: "Please choose your primary sport." };

  // Experience routing: beginners get guide mode, everyone else advisor mode.
  const experienceMode = trainingAge === "beginner" ? "guide" : "advisor";

  const devices = formData.getAll("devices").map(String).filter(Boolean);

  const payload = {
    user_id: user.id,
    full_name: fullName,
    age: numOrNull(formData, "age"),
    sex: str(formData, "sex"),
    height_in: numOrNull(formData, "height_in"),
    body_weight_lbs: numOrNull(formData, "body_weight_lbs"),
    primary_sport: str(formData, "primary_sport"),
    primary_goal: str(formData, "primary_goal"),
    goal_detail: str(formData, "goal_detail"),
    training_age: trainingAge,
    experience_mode: experienceMode,
    training_days_per_week: numOrNull(formData, "training_days_per_week"),
    current_program: str(formData, "current_program"),
    devices,
    nutrition_app: str(formData, "nutrition_app"),
    injuries: str(formData, "injuries"),
  };

  const { error: profileError } = await supabase
    .from("athlete_profiles")
    .upsert(payload, { onConflict: "user_id" });

  if (profileError) return { error: profileError.message };

  // Keep the display name on the users row in sync.
  await supabase.from("users").update({ full_name: fullName }).eq("id", user.id);

  revalidatePath("/dashboard");
  revalidatePath("/onboarding");
  redirect("/dashboard");
}
