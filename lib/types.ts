// ----------------------------------------------------------------------------
// Database row types + shared unions. Hand-written to mirror supabase/schema.sql.
// ----------------------------------------------------------------------------

export type Role = "participant" | "admin";
export type Sex = "male" | "female" | "other" | "prefer_not_to_say";
export type Sport = "strength" | "endurance" | "hybrid" | "other";
export type TrainingAge = "beginner" | "intermediate" | "advanced";
export type ExperienceMode = "advisor" | "guide";
export type Confidence = "low" | "medium" | "high";
export type ResponseStatus = "draft" | "sent";
export type ScreenshotSource =
  | "whoop"
  | "apple_health"
  | "apple_fitness"
  | "garmin"
  | "oura"
  | "nutrition"
  | "other";
export type Outcome = "came_true" | "partially" | "false" | "too_early" | "unknown";

export type YesSomewhatNo = "yes" | "somewhat" | "no";
export type PredictionFeedback = "yes" | "somewhat" | "no" | "too_early";
export type WouldPay = "yes" | "maybe" | "no";

export interface AppUser {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  created_at: string;
}

export interface AthleteProfile {
  id: string;
  user_id: string;
  full_name: string | null;
  last_checkin_reminder_at: string | null; // (legacy) idempotency for the old daily reminder
  morning_reminder_date: string | null; // athlete-local date the 9am reminder was last evaluated
  postworkout_reminder_date: string | null; // athlete-local date the 7pm reminder was last evaluated
  day7_report_sent_at: string | null;  // when the Day-7 first-week report was sent
  day14_report_sent_at: string | null; // when the Day-21 Phase-1 report was sent (legacy column name)
  day42_report_sent_at: string | null; // when the Day-42 Phase-2 report was sent
  age: number | null;
  sex: Sex | null;
  height_in: number | null;
  body_weight_lbs: number | null;
  primary_sport: Sport | null;
  primary_goal: string | null;
  goal_detail: string | null;
  training_age: TrainingAge | null;
  experience_mode: ExperienceMode | null;
  training_days_per_week: number | null;
  current_program: string | null;
  devices: string[] | null;
  nutrition_app: string | null;
  injuries: string | null;
  notes: string | null;
  coaching_tone: string | null;
  fatigue_tendency: string | null;
  motivation: string | null;
  coaching_wants: string | null;
  life_context: string | null;
  background: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyCheckin {
  id: string;
  user_id: string;
  checkin_date: string;
  sleep_hours: number | null;
  sleep_quality: number | null;
  recovery_score: number | null;
  hrv_ms: number | null;
  resting_hr: number | null;
  body_weight_lbs: number | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  water_oz: number | null;
  workout_completed: boolean | null;
  workout_type: string | null;
  workout_types: string[] | null;
  workout_split: string | null;
  training_load: string | null;
  top_set_lbs: number | null;
  bed_time: string | null;
  wake_time: string | null;
  workout_intensity: number | null;
  soreness: number | null;
  energy: number | null;
  mood: number | null;
  stress: number | null;
  motivation: number | null;
  pain_injury_note: string | null;
  open_comments: string | null;
  // Set when the coach has sent its short post-workout acknowledgment for this
  // day (idempotency key — the ack is sent at most once per logged session).
  post_workout_ack_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ParseStatus = "pending" | "processing" | "done" | "error" | "skipped";

export interface UploadedScreenshot {
  id: string;
  user_id: string;
  source: ScreenshotSource;
  storage_path: string;
  file_name: string | null;
  capture_date: string | null;
  note: string | null;
  created_at: string;
  parse_status: ParseStatus;
  parsed_json: Record<string, number | null> | null;
  parsed_at: string | null;
  parse_error: string | null;
  // Null = the OCR reading is pending the athlete's review. Set once they've
  // confirmed (applied) or dismissed it, so it stops feeding the review queue.
  applied_at: string | null;
}

export type CoachMessageKind = "chat" | "morning_brief" | "workout_review";

export interface CoachMessage {
  id: string;
  user_id: string;
  role: "athlete" | "coach";
  body: string;
  ai_generated: boolean;
  kind: CoachMessageKind;
  created_at: string;
}

// --- Workout tracking -------------------------------------------------------

export interface WorkoutDay {
  id: string;
  user_id: string;
  name: string;
  label: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface WorkoutExercise {
  id: string;
  workout_day_id: string;
  user_id: string;
  name: string;
  target_sets: number | null;
  target_reps: string | null;
  muscle_group: string | null;
  position: number;
  created_at: string;
}

export type WorkoutSessionStatus = "in_progress" | "completed";

export interface WorkoutSession {
  id: string;
  user_id: string;
  workout_day_id: string | null;
  day_name: string | null;
  session_date: string;
  notes: string | null;
  // 'in_progress' = pending/autosaving (stays open to resume); 'completed' = the
  // athlete pressed Save. Ad-hoc "on the fly" sessions have workout_day_id null.
  status: WorkoutSessionStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkoutSetLog {
  id: string;
  session_id: string;
  user_id: string;
  exercise_name: string;
  muscle_group: string | null;
  set_number: number;
  target_reps: string | null;
  weight: number | null;
  reps: number | null;
  // Set logs sharing a non-null group are performed as a superset.
  superset_group: string | null;
  position: number;
  created_at: string;
}

// A template day with its exercises loaded.
export interface WorkoutDayWithExercises extends WorkoutDay {
  workout_exercises: WorkoutExercise[];
}

export interface CoachResponse {
  id: string;
  user_id: string;
  response_date: string;
  what_noticed: string | null;
  why_it_matters: string | null;
  recommendation: string | null;
  prediction: string | null;
  confidence: Confidence | null;
  data_used: string | null;
  athlete_question: string | null;
  status: ResponseStatus;
  ai_generated: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  feedback_reminder_at: string | null; // when the "give feedback" nudge was evaluated
}

export interface Prediction {
  id: string;
  user_id: string;
  coach_response_id: string | null;
  prediction_text: string;
  horizon: string | null;
  confidence: Confidence | null;
  target_date: string | null;
  created_by: string | null;
  created_at: string;
}

export interface PredictionOutcome {
  id: string;
  prediction_id: string;
  outcome: Outcome;
  notes: string | null;
  recorded_by: string | null;
  recorded_at: string;
}

export interface PredictionWithOutcome extends Prediction {
  prediction_outcomes: PredictionOutcome[] | PredictionOutcome | null;
}

export interface UserFeedback {
  id: string;
  user_id: string;
  coach_response_id: string;
  felt_accurate: YesSomewhatNo | null;
  felt_personalized: YesSomewhatNo | null;
  was_useful: YesSomewhatNo | null;
  prediction_came_true: PredictionFeedback | null;
  would_pay: WouldPay | null;
  free_text: string | null;
  created_at: string;
}

export interface AthleteMemoryNote {
  id: string;
  user_id: string;
  category: string | null;
  note: string;
  created_by: string | null;
  created_at: string;
}

export interface TrustMetricSnapshot {
  id: string;
  user_id: string;
  snapshot_date: string;
  responses_sent: number;
  feedback_count: number;
  aha_rate: number | null;
  accuracy_rate: number | null;
  usefulness_rate: number | null;
  would_pay_rate: number | null;
  predictions_total: number;
  predictions_correct: number;
  prediction_accuracy: number | null;
  created_by: string | null;
  created_at: string;
}

// Computed live trust metrics (not persisted).
export interface ComputedTrustMetrics {
  feedbackCount: number;
  ahaRate: number | null;
  accuracyRate: number | null;
  usefulnessRate: number | null;
  wouldPayRate: number | null;
  predictionsTotal: number;
  predictionsScored: number;
  predictionsCorrect: number;
  predictionAccuracy: number | null;
}
