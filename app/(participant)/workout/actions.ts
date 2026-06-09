"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { WorkoutExercise } from "@/lib/types";

export type FormState = { error: string | null; ok?: boolean };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function floatVal(v: FormDataEntryValue | null): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function intVal(v: FormDataEntryValue | null): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

async function uid() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// ---------------------------------------------------------------------------
// Template days
// ---------------------------------------------------------------------------

export async function createDay(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await uid();
  if (!user) return { error: "Your session expired. Please sign in again." };

  const name = str(formData, "name");
  if (!name) return { error: "Give this day a name (e.g. Push, Upper 1)." };
  const label = str(formData, "label");

  // Place new days at the end.
  const { data: last } = await supabase
    .from("workout_days")
    .select("position")
    .eq("user_id", user.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last?.position as number | undefined) ?? -1) + 1;

  const { data: inserted, error } = await supabase
    .from("workout_days")
    .insert({ user_id: user.id, name, label, position })
    .select("id")
    .single();

  if (error || !inserted) return { error: error?.message ?? "Could not create the day." };

  revalidatePath("/workout/days");
  revalidatePath("/workout");
  redirect(`/workout/days/${inserted.id}`);
}

export async function updateDay(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await uid();
  if (!user) return { error: "Your session expired." };

  const id = str(formData, "id");
  const name = str(formData, "name");
  if (!id) return { error: "Missing day id." };
  if (!name) return { error: "The day needs a name." };

  const { error } = await supabase
    .from("workout_days")
    .update({ name, label: str(formData, "label") })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return { error: error.message };
  revalidatePath(`/workout/days/${id}`);
  revalidatePath("/workout/days");
  revalidatePath("/workout");
  return { error: null, ok: true };
}

export async function deleteDay(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await uid();
  if (!user) return { error: "Your session expired." };
  const id = str(formData, "id");
  if (!id) return { error: "Missing day id." };

  await supabase.from("workout_days").delete().eq("id", id).eq("user_id", user.id);
  revalidatePath("/workout/days");
  revalidatePath("/workout");
  redirect("/workout/days");
}

// ---------------------------------------------------------------------------
// Template exercises
// ---------------------------------------------------------------------------

export async function addExercise(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await uid();
  if (!user) return { error: "Your session expired." };

  const dayId = str(formData, "workout_day_id");
  const name = str(formData, "name");
  if (!dayId) return { error: "Missing day." };
  if (!name) return { error: "Enter the exercise name." };

  const { data: last } = await supabase
    .from("workout_exercises")
    .select("position")
    .eq("workout_day_id", dayId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last?.position as number | undefined) ?? -1) + 1;

  const { error } = await supabase.from("workout_exercises").insert({
    workout_day_id: dayId,
    user_id: user.id,
    name,
    target_sets: intOrNull(formData, "target_sets"),
    target_reps: str(formData, "target_reps"),
    muscle_group: str(formData, "muscle_group"),
    position,
  });

  if (error) return { error: error.message };
  revalidatePath(`/workout/days/${dayId}`);
  return { error: null, ok: true };
}

export async function updateExercise(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await uid();
  if (!user) return { error: "Your session expired." };

  const id = str(formData, "id");
  const dayId = str(formData, "workout_day_id");
  const name = str(formData, "name");
  if (!id) return { error: "Missing exercise id." };
  if (!name) return { error: "Exercise needs a name." };

  const { error } = await supabase
    .from("workout_exercises")
    .update({
      name,
      target_sets: intOrNull(formData, "target_sets"),
      target_reps: str(formData, "target_reps"),
      muscle_group: str(formData, "muscle_group"),
    })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return { error: error.message };
  if (dayId) revalidatePath(`/workout/days/${dayId}`);
  return { error: null, ok: true };
}

export async function deleteExercise(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await uid();
  if (!user) return { error: "Your session expired." };
  const id = str(formData, "id");
  const dayId = str(formData, "workout_day_id");
  if (!id) return { error: "Missing exercise id." };

  await supabase.from("workout_exercises").delete().eq("id", id).eq("user_id", user.id);
  if (dayId) revalidatePath(`/workout/days/${dayId}`);
  return { error: null, ok: true };
}

// Plain-signature variant for an inline delete button (formAction) inside the
// editable exercise form, so we don't nest <form> elements.
export async function removeExerciseInline(formData: FormData): Promise<void> {
  const { supabase, user } = await uid();
  if (!user) return;
  const id = str(formData, "id");
  const dayId = str(formData, "workout_day_id");
  if (!id) return;
  await supabase.from("workout_exercises").delete().eq("id", id).eq("user_id", user.id);
  if (dayId) revalidatePath(`/workout/days/${dayId}`);
}

// ---------------------------------------------------------------------------
// Sessions (today's workout) + per-set logging
// ---------------------------------------------------------------------------

// Pick a template day → make it today's workout. Snapshots the day's exercises
// into blank set-log rows (weight/reps null) for the athlete to fill in.
export async function startSession(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await uid();
  if (!user) return { error: "Your session expired." };

  const dayId = str(formData, "workout_day_id");
  if (!dayId) return { error: "Choose a workout day." };

  const dateRaw = str(formData, "session_date");
  const sessionDate =
    dateRaw && DATE_RE.test(dateRaw) ? dateRaw : new Date().toISOString().slice(0, 10);

  // Load the chosen template (must belong to the user).
  const { data: day } = await supabase
    .from("workout_days")
    .select("id, name, user_id")
    .eq("id", dayId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!day) return { error: "That workout day was not found." };

  // If today's session is already this same day, keep it (don't wipe logs).
  const { data: existing } = await supabase
    .from("workout_sessions")
    .select("id, workout_day_id")
    .eq("user_id", user.id)
    .eq("session_date", sessionDate)
    .maybeSingle();

  if (existing && (existing as { workout_day_id: string | null }).workout_day_id === dayId) {
    redirect("/workout");
  }

  // Otherwise replace any existing session for the day (cascades its set logs).
  if (existing) {
    await supabase
      .from("workout_sessions")
      .delete()
      .eq("id", (existing as { id: string }).id);
  }

  const { data: session, error: sErr } = await supabase
    .from("workout_sessions")
    .insert({
      user_id: user.id,
      workout_day_id: dayId,
      day_name: (day as { name: string }).name,
      session_date: sessionDate,
    })
    .select("id")
    .single();
  if (sErr || !session) return { error: sErr?.message ?? "Could not start the workout." };

  // Snapshot exercises → set-log rows.
  const { data: exercises } = await supabase
    .from("workout_exercises")
    .select("*")
    .eq("workout_day_id", dayId)
    .order("position", { ascending: true });

  const rows: Record<string, unknown>[] = [];
  (exercises as WorkoutExercise[] | null)?.forEach((ex, exIdx) => {
    const sets = ex.target_sets && ex.target_sets > 0 ? ex.target_sets : 1;
    for (let s = 1; s <= sets; s++) {
      rows.push({
        session_id: (session as { id: string }).id,
        user_id: user.id,
        exercise_name: ex.name,
        muscle_group: ex.muscle_group,
        set_number: s,
        target_reps: ex.target_reps,
        weight: null,
        reps: null,
        position: exIdx * 100 + s,
      });
    }
  });
  if (rows.length > 0) {
    await supabase.from("workout_set_logs").insert(rows);
  }

  revalidatePath("/workout");
  redirect("/workout");
}

// Save the weights + reps the athlete entered for today's session. The form
// posts weight_<logId> / reps_<logId> plus a hidden list of log ids.
export async function saveSession(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await uid();
  if (!user) return { error: "Your session expired." };

  const sessionId = str(formData, "session_id");
  if (!sessionId) return { error: "Missing session." };

  const ids = (str(formData, "log_ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  await Promise.all(
    ids.map((id) =>
      supabase
        .from("workout_set_logs")
        .update({
          weight: floatVal(formData.get(`weight_${id}`)),
          reps: intVal(formData.get(`reps_${id}`)),
        })
        .eq("id", id)
        .eq("user_id", user.id),
    ),
  );

  // Optional session note + finalize: pressing Save marks the session completed.
  await supabase
    .from("workout_sessions")
    .update({
      notes: str(formData, "notes"),
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", user.id);

  revalidatePath("/workout");
  revalidatePath("/dashboard");
  return { error: null, ok: true };
}

// ---------------------------------------------------------------------------
// Autosave — incremental, best-effort writes so an accidental close never loses
// what the athlete typed. The session stays 'in_progress' (pending) until Save.
// These take plain args (called directly from the client logger), return quietly,
// and intentionally do NOT revalidate (the client owns the live UI state).
// ---------------------------------------------------------------------------

export async function autosaveSetLog(
  id: string,
  weight: number | null,
  reps: number | null,
): Promise<{ ok: boolean }> {
  const { supabase, user } = await uid();
  if (!user) return { ok: false };
  if (!id) return { ok: false };
  await supabase
    .from("workout_set_logs")
    .update({ weight, reps })
    .eq("id", id)
    .eq("user_id", user.id);
  return { ok: true };
}

export async function autosaveSessionNotes(
  sessionId: string,
  notes: string | null,
): Promise<{ ok: boolean }> {
  const { supabase, user } = await uid();
  if (!user) return { ok: false };
  if (!sessionId) return { ok: false };
  await supabase
    .from("workout_sessions")
    .update({ notes: notes && notes.trim() !== "" ? notes : null })
    .eq("id", sessionId)
    .eq("user_id", user.id);
  return { ok: true };
}

// Remove today's session so the athlete can pick a different day.
export async function clearSession(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await uid();
  if (!user) return { error: "Your session expired." };
  const id = str(formData, "session_id");
  if (!id) return { error: "Missing session." };

  await supabase.from("workout_sessions").delete().eq("id", id).eq("user_id", user.id);
  revalidatePath("/workout");
  redirect("/workout");
}

// Plain-signature variant for the inline "Discard" button inside the logger
// form (formAction), avoiding nested <form> elements.
export async function discardSessionInline(formData: FormData): Promise<void> {
  const { supabase, user } = await uid();
  if (!user) return;
  const id = str(formData, "session_id");
  if (!id) return;
  await supabase.from("workout_sessions").delete().eq("id", id).eq("user_id", user.id);
  revalidatePath("/workout");
  redirect("/workout");
}
