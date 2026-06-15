"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshWorkoutDataStats } from "@/lib/coach-trends";
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

  // Refresh the trend-engine gate stats (first-workout date + completed count)
  // so the trend-engine gate stays a cheap profile-field read. Best-effort.
  try {
    await refreshWorkoutDataStats(user.id, createAdminClient());
  } catch {
    /* stats refresh is best-effort; never block saving the session */
  }

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

// ---------------------------------------------------------------------------
// Workout on the fly + in-session editing
// ---------------------------------------------------------------------------

// Start an ad-hoc session with NO template — an empty workout the athlete builds
// live by adding exercises/sets as they go. day_name is whatever they type (or
// null = "Quick workout").
export async function startAdhocSession(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await uid();
  if (!user) return { error: "Your session expired." };

  const dateRaw = str(formData, "session_date");
  const sessionDate =
    dateRaw && DATE_RE.test(dateRaw) ? dateRaw : new Date().toISOString().slice(0, 10);
  const name = str(formData, "name"); // optional, e.g. "Hotel gym"

  // One session per day — replace any existing one for the date (cascades logs).
  const { data: existing } = await supabase
    .from("workout_sessions")
    .select("id")
    .eq("user_id", user.id)
    .eq("session_date", sessionDate)
    .maybeSingle();
  if (existing) {
    await supabase
      .from("workout_sessions")
      .delete()
      .eq("id", (existing as { id: string }).id);
  }

  const { error } = await supabase.from("workout_sessions").insert({
    user_id: user.id,
    workout_day_id: null,
    day_name: name,
    session_date: sessionDate,
  });
  if (error) return { error: error.message };

  revalidatePath("/workout");
  redirect("/workout");
}

// Append another set to an exercise already in the session. Keeps it grouped
// with that exercise (position just after its current last set).
export async function addSetToExercise(
  sessionId: string,
  exerciseName: string,
  muscleGroup: string | null,
  supersetGroup: string | null,
): Promise<void> {
  const { supabase, user } = await uid();
  if (!user || !sessionId || !exerciseName) return;

  const { data: rows } = await supabase
    .from("workout_set_logs")
    .select("set_number, position, target_reps")
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .eq("exercise_name", exerciseName)
    .order("position", { ascending: false });

  const last = rows?.[0] as
    | { set_number: number; position: number; target_reps: string | null }
    | undefined;
  const nextSet = (last?.set_number ?? 0) + 1;
  const nextPos = (last?.position ?? 0) + 1;

  await supabase.from("workout_set_logs").insert({
    session_id: sessionId,
    user_id: user.id,
    exercise_name: exerciseName,
    muscle_group: muscleGroup,
    set_number: nextSet,
    target_reps: last?.target_reps ?? null,
    weight: null,
    reps: null,
    superset_group: supersetGroup,
    position: nextPos,
  });

  revalidatePath("/workout");
}

// Add a brand-new exercise to the session (its first set). Optionally pair it as
// a superset with the previous exercise.
export async function addExerciseToSession(
  sessionId: string,
  name: string,
  muscleGroup: string | null,
  supersetWithPrevious: boolean,
): Promise<void> {
  const { supabase, user } = await uid();
  if (!user || !sessionId) return;
  const exerciseName = name.trim();
  if (!exerciseName) return;

  const { data: rows } = await supabase
    .from("workout_set_logs")
    .select("position, exercise_name, superset_group")
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .order("position", { ascending: true });

  const all =
    (rows as { position: number; exercise_name: string; superset_group: string | null }[]) ??
    [];
  const maxPos = all.length > 0 ? all[all.length - 1].position : -100;
  // Start each exercise on its own hundred-block so added sets have room.
  const nextPos = Math.floor(maxPos / 100) * 100 + 100;

  // Superset: share a group id with the exercise above it. If that one has no
  // group yet, mint one and tag both.
  let supersetGroup: string | null = null;
  if (supersetWithPrevious && all.length > 0) {
    const prev = all[all.length - 1];
    if (prev.superset_group) {
      supersetGroup = prev.superset_group;
    } else {
      supersetGroup = crypto.randomUUID();
      await supabase
        .from("workout_set_logs")
        .update({ superset_group: supersetGroup })
        .eq("session_id", sessionId)
        .eq("user_id", user.id)
        .eq("exercise_name", prev.exercise_name);
    }
  }

  await supabase.from("workout_set_logs").insert({
    session_id: sessionId,
    user_id: user.id,
    exercise_name: exerciseName,
    muscle_group: muscleGroup,
    set_number: 1,
    target_reps: null,
    weight: null,
    reps: null,
    superset_group: supersetGroup,
    position: nextPos,
  });

  revalidatePath("/workout");
}

// Delete a completed / historical session from the history list.
export async function deleteSession(sessionId: string): Promise<{ ok: boolean; error?: string }> {
  const { supabase, user } = await uid();
  if (!user) return { ok: false, error: "Your session expired." };
  if (!sessionId) return { ok: false, error: "Missing session id." };

  const { error } = await supabase
    .from("workout_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("user_id", user.id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/workout");
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
