"use server";

// ----------------------------------------------------------------------------
// Nutrition server actions
//
// Three actions that form the data pipeline:
//   logFoodAction          — parse natural language → insert nutrition_logs rows
//                            → sync totals into daily_checkins
//   deleteFoodLogAction    — remove a single log entry → re-sync totals
//   syncNutritionToCheckin — aggregate nutrition_logs for a date and upsert
//                            the macro totals into daily_checkins (the bridge
//                            that keeps coach AI context accurate)
// ----------------------------------------------------------------------------

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseFoods, NutritionixError, type NutritionixFood } from "@/lib/nutritionix";

export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface ParsedFoodItem {
  food_name: string;
  brand_name: string | null;
  nix_item_id: string | null;
  serving_qty: number;
  serving_unit: string;
  serving_weight_grams: number | null;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sodium_mg: number | null;
}

export interface LogFoodResult {
  success: boolean;
  error?: string;
  parsed?: ParsedFoodItem[];
}

// ----------------------------------------------------------------------------
// logFoodAction
//
// Takes a natural language string (e.g. "3 eggs and a cup of oats"), calls
// Nutritionix to parse it, inserts one nutrition_logs row per food item, then
// syncs the daily totals back into daily_checkins.
// ----------------------------------------------------------------------------
export async function logFoodAction(
  naturalText: string,
  logDate: string,
  mealType: MealType,
): Promise<LogFoodResult> {
  // Validate inputs
  const trimmed = naturalText.trim().slice(0, 500);
  if (!trimmed) return { success: false, error: "Please enter what you ate." };
  if (!logDate || isNaN(Date.parse(logDate))) {
    return { success: false, error: "Invalid date." };
  }
  // Reject dates in the future (allow +1 day of slack for timezone differences
  // between the user's local "today" and the server's UTC date).
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (logDate > tomorrow.toISOString().slice(0, 10)) {
    return { success: false, error: "Can't log food for a future date." };
  }
  if (!["breakfast", "lunch", "dinner", "snack"].includes(mealType)) {
    return { success: false, error: "Invalid meal type." };
  }

  const user = await requireUser();

  // Parse with Nutritionix
  let foods: NutritionixFood[];
  try {
    foods = await parseFoods(trimmed);
  } catch (err) {
    if (err instanceof NutritionixError) {
      return { success: false, error: err.message };
    }
    return { success: false, error: "Could not parse food. Please try again." };
  }

  if (!foods.length) {
    return { success: false, error: "No foods recognized. Try rephrasing." };
  }

  // Insert rows (use user client so RLS applies naturally)
  const supabase = await createClient();

  const rows = foods.map((f) => ({
    user_id: user.id,
    log_date: logDate,
    food_name: f.food_name,
    brand_name: f.brand_name ?? null,
    nix_item_id: f.nix_item_id ?? null,
    serving_qty: f.serving_qty,
    serving_unit: f.serving_unit,
    serving_weight_grams: f.serving_weight_grams ?? null,
    calories: f.nf_calories,
    protein_g: f.nf_protein ?? null,
    carbs_g: f.nf_total_carbohydrate ?? null,
    fat_g: f.nf_total_fat ?? null,
    fiber_g: f.nf_dietary_fiber ?? null,
    sodium_mg: f.nf_sodium ?? null,
    meal_type: mealType,
    raw_input: trimmed,
    source: "nutritionix",
  }));

  const { error: insertError } = await supabase.from("nutrition_logs").insert(rows);
  if (insertError) {
    return { success: false, error: "Failed to save food log. Please try again." };
  }

  // Sync totals into daily_checkins
  await syncNutritionToCheckin(user.id, logDate);

  revalidatePath("/nutrition");
  revalidatePath("/dashboard");

  const parsed: ParsedFoodItem[] = foods.map((f) => ({
    food_name: f.food_name,
    brand_name: f.brand_name ?? null,
    nix_item_id: f.nix_item_id ?? null,
    serving_qty: f.serving_qty,
    serving_unit: f.serving_unit,
    serving_weight_grams: f.serving_weight_grams ?? null,
    calories: f.nf_calories,
    protein_g: f.nf_protein ?? null,
    carbs_g: f.nf_total_carbohydrate ?? null,
    fat_g: f.nf_total_fat ?? null,
    fiber_g: f.nf_dietary_fiber ?? null,
    sodium_mg: f.nf_sodium ?? null,
  }));

  return { success: true, parsed };
}

// ----------------------------------------------------------------------------
// deleteFoodLogAction
//
// Removes a single log entry (RLS ensures only the owner can delete), then
// re-syncs daily totals so the check-in stays accurate.
// ----------------------------------------------------------------------------
export async function deleteFoodLogAction(
  logId: string,
  logDate: string,
): Promise<{ success: boolean; error?: string }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { error } = await supabase
    .from("nutrition_logs")
    .delete()
    .eq("id", logId)
    .eq("user_id", user.id); // redundant with RLS but explicit

  if (error) {
    return { success: false, error: "Failed to delete entry." };
  }

  await syncNutritionToCheckin(user.id, logDate);

  revalidatePath("/nutrition");
  revalidatePath("/dashboard");

  return { success: true };
}

// ----------------------------------------------------------------------------
// syncNutritionToCheckin
//
// The critical bridge: aggregates all nutrition_logs for a user on a given
// date and upserts the macro totals (calories, protein_g, carbs_g, fat_g)
// into daily_checkins. Uses service-role client to bypass RLS and to write
// even if no check-in row exists yet for that date.
//
// Called automatically after every log/delete. Can also be called standalone
// to repair any drift.
// ----------------------------------------------------------------------------
export async function syncNutritionToCheckin(
  userId: string,
  logDate: string,
): Promise<void> {
  const admin = createAdminClient();

  // Use the DB helper function for clean aggregation
  const { data, error } = await admin.rpc("get_daily_nutrition_totals", {
    p_user_id: userId,
    p_date: logDate,
  });

  if (error || !data || !data.length) return;

  const totals = data[0] as {
    total_calories: number;
    total_protein_g: number;
    total_carbs_g: number;
    total_fat_g: number;
    meal_count: number;
  };

  // Upsert into daily_checkins — only update the nutrition columns.
  // All other fields (sleep, HRV, workout, etc.) are left untouched.
  await admin.from("daily_checkins").upsert(
    {
      user_id: userId,
      checkin_date: logDate,
      calories: Math.round(totals.total_calories),
      protein_g: Math.round(totals.total_protein_g),
      carbs_g: Math.round(totals.total_carbs_g),
      fat_g: Math.round(totals.total_fat_g),
    },
    {
      onConflict: "user_id,checkin_date",
      ignoreDuplicates: false, // we want to update, not skip
    },
  );
}
