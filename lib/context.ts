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
import type { CoachContext, ChatTurn, WorkoutLogBrief } from "./coach-types";

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
    memoryRes,
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
      .from("athlete_memory_notes")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
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

  // If a specific date is requested, find that row first (post-workout-ack
  // needs today's training fields); otherwise use the most recent row.
  const latestCheckin = latestCheckinDate
    ? (checkins.find((c) => c.checkin_date === latestCheckinDate) ?? checkins[0] ?? null)
    : (checkins[0] ?? null);

  return {
    athleteName: userRec?.full_name || profile?.full_name || userRec?.email || null,
    today,
    profile,
    latestCheckin,
    recentCheckins: checkins,
    screenshots,
    memoryNotes: (memoryRes.data as AthleteMemoryNote[]) ?? [],
    previousResponses: (responsesRes.data as CoachResponse[]) ?? [],
    predictions: (predictionsRes.data as PredictionWithOutcome[]) ?? [],
    feedback: (feedbackRes.data as UserFeedback[]) ?? [],
    recentWorkouts,
    recentMessages,
  };
}
