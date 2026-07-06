// ----------------------------------------------------------------------------
// Shared athlete context builder for all AI routes.
//
// Fetches everything we know about one athlete (profile, check-ins, screenshots,
// coach responses, predictions, feedback, memory notes, and recent workouts) and
// assembles it into a CoachContext ready to pass to lib/coach-ai.ts.
//
// All reads use the service-role admin client so RLS policy gaps can never
// silently return partial data to Claude.
//
// Message fetching is intentionally left to each caller — the strategy differs
// enough between routes (7-day window vs. full conversation history vs. none)
// that a shared helper would need too many special cases. Pass the result in as
// opts.recentMessages when needed.
// ----------------------------------------------------------------------------

import type { createAdminClient } from "./supabase/admin";
import type {
  AthleteProfile,
  DailyCheckin,
  UploadedScreenshot,
  CoachResponse,
  PredictionWithOutcome,
  UserFeedback,
  AthleteMemoryNote,
} from "./types";
import type { CoachContext, ChatTurn, WorkoutLogBrief, WorkoutDayBrief, WorkoutExerciseBrief, SelfEvalBrief } from "./coach-types";
import { embedText } from "./embeddings";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface ContextOptions {
  /** How many recent check-ins to load (newest first). Default 8. */
  checkinLimit?: number;
  /** How many screenshots to load. Pass 0 to skip entirely. Default 12. */
  screenshotLimit?: number;
  /** How many coach responses to load. Default 10. */
  responseLimit?: number;
  /** How many predictions (with outcomes) to load. Default 12. */
  predictionLimit?: number;
  /** How many feedback rows to load. Default 12. */
  feedbackLimit?: number;
  /** How many workout sessions to load (per-set logs follow). Default 5. */
  workoutSessionLimit?: number;
  /**
   * How many post-workout self-evals to load (newest first). Default 35 so a
   * 5x/week athlete's 30-day pattern window (lib/coach-patterns.ts) is never
   * truncated by the count bound.
   */
  selfEvalLimit?: number;
  /**
   * If provided, `latestCheckin` in the returned context will be the row
   * matching this date (falling back to checkins[0] if not found). Used by
   * post-workout-ack to ensure today's just-logged training fields are the
   * ones the coach reacts to, not just the most recently dated row.
   */
  latestCheckinDate?: string;
  /** Pre-fetched chat turns to include as context.recentMessages. */
  recentMessages?: ChatTurn[];
}

/**
 * Build a complete CoachContext for one athlete.
 * Throws only if the admin client itself fails — callers handle empty data via
 * the null/empty-array values in the returned context.
 */
export async function buildCoachContext(
  userId: string,
  admin: AdminClient,
  today: string,
  opts: ContextOptions = {},
): Promise<CoachContext> {
  const {
    checkinLimit = 8,
    screenshotLimit = 12,
    responseLimit = 10,
    predictionLimit = 12,
    feedbackLimit = 12,
    workoutSessionLimit = 5,
    selfEvalLimit = 35,
    latestCheckinDate,
    recentMessages,
  } = opts;

  // Fetch all tabular data in parallel (screenshots handled separately below
  // because it's conditional on screenshotLimit > 0).
  const [
    userRes,
    profileRes,
    checkinsRes,
    responsesRes,
    predictionsRes,
    feedbackRes,
    selfEvalsRes,
  ] = await Promise.all([
    admin.from("users").select("full_name, email").eq("id", userId).maybeSingle(),
    admin.from("athlete_profiles").select("*").eq("user_id", userId).maybeSingle(),
    admin
      .from("daily_checkins")
      .select("*")
      .eq("user_id", userId)
      .order("checkin_date", { ascending: false })
      .limit(checkinLimit),
    admin
      .from("coach_responses")
      .select("*")
      .eq("user_id", userId)
      .order("response_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(responseLimit),
    admin
      .from("predictions")
      .select("*, prediction_outcomes(*)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(predictionLimit),
    admin
      .from("user_feedback")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(feedbackLimit),
    admin
      .from("workout_self_evals")
      .select("rpe, feedback, workout_sessions(session_date, day_name)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(selfEvalLimit),
  ]);

  // Screenshots are optional — milestone-reports skips them to reduce noise.
  let screenshots: UploadedScreenshot[] = [];
  if (screenshotLimit > 0) {
    const { data } = await admin
      .from("uploaded_screenshots")
      .select("*")
      .eq("user_id", userId)
      .neq("parse_status", "error")
      .order("created_at", { ascending: false })
      .limit(screenshotLimit);
    screenshots = (data as UploadedScreenshot[]) ?? [];
  }

  const userRec = userRes.data as { full_name: string | null; email: string | null } | null;
  const profile = (profileRes.data as AthleteProfile) ?? null;
  const checkins = (checkinsRes.data as DailyCheckin[]) ?? [];

  // RAG memory retrieval — embed a summary of the current check-in context and
  // retrieve the most relevant memory notes via cosine similarity. Falls back to
  // loading all notes if embeddings are unavailable (missing OPENAI_API_KEY or API error).
  const latestCheckinForQuery = checkins[0] ?? null;
  let memoryNotes: AthleteMemoryNote[] = [];
  {
    const queryParts: string[] = [];
    if (profile?.primary_goal) queryParts.push(`Goal: ${profile.primary_goal}`);
    if (latestCheckinForQuery) {
      const c = latestCheckinForQuery;
      if (c.hrv_ms) queryParts.push(`HRV ${c.hrv_ms}ms`);
      if (c.recovery_score) queryParts.push(`recovery score ${c.recovery_score}`);
      if (c.sleep_hours) queryParts.push(`sleep ${c.sleep_hours}h`);
      if (c.soreness) queryParts.push(`soreness ${c.soreness}/10`);
      if (c.energy) queryParts.push(`energy ${c.energy}/10`);
      if (c.stress) queryParts.push(`stress ${c.stress}/10`);
      if (c.workout_types?.length) queryParts.push(`training: ${c.workout_types.join(", ")}`);
      if (c.pain_injury_note) queryParts.push(`injury: ${c.pain_injury_note}`);
      if (c.open_comments) queryParts.push(`notes: ${c.open_comments}`);
    }
    const queryText = queryParts.length > 0 ? queryParts.join(". ") : "athlete performance coaching";

    const queryEmbedding = await embedText(queryText);
    if (queryEmbedding) {
      const { data: ragData } = await admin.rpc("match_athlete_memory_notes", {
        p_user_id: userId,
        p_embedding: `[${queryEmbedding.join(",")}]`,
        p_match_count: 8,
      });
      memoryNotes = (ragData as AthleteMemoryNote[]) ?? [];
    } else {
      // Fallback: load all notes (original behavior — no OPENAI_API_KEY or embed failed)
      const { data: allNotes } = await admin
        .from("athlete_memory_notes")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      memoryNotes = (allNotes as AthleteMemoryNote[]) ?? [];
    }
  }

  // Workout sessions + per-set logs (two queries: sessions first, then sets).
  let recentWorkouts: WorkoutLogBrief[] = [];
  if (workoutSessionLimit > 0) {
    const { data: sessionRows } = await admin
      .from("workout_sessions")
      .select("id, session_date, day_name, notes")
      .eq("user_id", userId)
      .order("session_date", { ascending: false })
      .limit(workoutSessionLimit);

    const sessions = (sessionRows as {
      id: string;
      session_date: string;
      day_name: string | null;
      notes: string | null;
    }[]) ?? [];

    if (sessions.length > 0) {
      const { data: setRows } = await admin
        .from("workout_set_logs")
        .select("session_id, exercise_name, muscle_group, set_number, weight, reps")
        .in("session_id", sessions.map((s) => s.id))
        .order("position", { ascending: true });

      const bySession = new Map<string, typeof setRows>();
      (setRows ?? []).forEach((r) => {
        const sid = (r as { session_id: string }).session_id;
        const arr = bySession.get(sid) ?? [];
        arr.push(r);
        bySession.set(sid, arr);
      });

      recentWorkouts = sessions.map((s) => ({
        session_date: s.session_date,
        day_name: s.day_name,
        notes: s.notes,
        sets: (bySession.get(s.id) ?? []).map((r) => {
          const row = r as {
            exercise_name: string;
            muscle_group: string | null;
            set_number: number;
            weight: number | null;
            reps: number | null;
          };
          return {
            exercise: row.exercise_name,
            muscle: row.muscle_group,
            set: row.set_number,
            weight: row.weight,
            reps: row.reps,
          };
        }),
      }));
    }
  }

  // Post-workout self-evals, joined to their session for date/day-name. The
  // unique workout_id FK makes the embed one-to-one, but PostgREST can still
  // hand back an array — normalize either shape.
  const selfEvals: SelfEvalBrief[] = (
    (selfEvalsRes.data as {
      rpe: number;
      feedback: string | null;
      workout_sessions:
        | { session_date: string; day_name: string | null }
        | { session_date: string; day_name: string | null }[]
        | null;
    }[]) ?? []
  ).map((row) => {
    const session = Array.isArray(row.workout_sessions)
      ? row.workout_sessions[0] ?? null
      : row.workout_sessions;
    return {
      workout_date: session?.session_date ?? "",
      day_name: session?.day_name ?? null,
      rpe: row.rpe,
      feedback: row.feedback,
    };
  });

  // If a specific date is requested, find that row first (post-workout-ack
  // needs today's training fields); otherwise use the most recent row.
  const latestCheckin = latestCheckinDate
    ? (checkins.find((c) => c.checkin_date === latestCheckinDate) ?? checkins[0] ?? null)
    : (checkins[0] ?? null);

  // Workout program: saved days + exercises (for coach editing proposals).
  let workoutDays: WorkoutDayBrief[] = [];
  const { data: dayRows } = await admin
    .from("workout_days")
    .select("id, name, label, position")
    .eq("user_id", userId)
    .order("position", { ascending: true });

  if (dayRows && dayRows.length > 0) {
    const { data: exRows } = await admin
      .from("workout_exercises")
      .select("id, workout_day_id, name, muscle_group, target_sets, target_reps, position")
      .in("workout_day_id", dayRows.map((d: { id: string }) => d.id))
      .order("position", { ascending: true });

    const exByDay = new Map<string, WorkoutExerciseBrief[]>();
    (exRows ?? []).forEach((r: {
      id: string; workout_day_id: string; name: string;
      muscle_group: string | null; target_sets: number | null;
      target_reps: string | null; position: number;
    }) => {
      const arr = exByDay.get(r.workout_day_id) ?? [];
      arr.push({ id: r.id, name: r.name, muscle_group: r.muscle_group, target_sets: r.target_sets, target_reps: r.target_reps, position: r.position });
      exByDay.set(r.workout_day_id, arr);
    });

    workoutDays = dayRows.map((d: { id: string; name: string; label: string | null; position: number }) => ({
      id: d.id,
      name: d.name,
      label: d.label,
      position: d.position,
      exercises: exByDay.get(d.id) ?? [],
    }));
  }

  return {
    athleteName: userRec?.full_name || profile?.full_name || userRec?.email || null,
    today,
    profile,
    latestCheckin,
    recentCheckins: checkins,
    screenshots,
    memoryNotes,
    previousResponses: (responsesRes.data as CoachResponse[]) ?? [],
    predictions: (predictionsRes.data as PredictionWithOutcome[]) ?? [],
    feedback: (feedbackRes.data as UserFeedback[]) ?? [],
    recentWorkouts,
    selfEvals,
    recentMessages,
    workoutDays,
  };
}
