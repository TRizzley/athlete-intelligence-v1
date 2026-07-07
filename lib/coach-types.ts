// Shared types for the AI coaching modules. Imported by both the AI modules
// themselves and by any route/action that builds or receives coach data.

import type { Confidence } from "./types";

export interface CoachDraft {
  what_noticed: string;
  why_it_matters: string;
  recommendation: string;
  prediction: string;
  confidence: Confidence;
  data_used: string;
  athlete_question: string;
  // Conversational delivery posted into coach chat as the morning brief.
  chat_message: string;
}

export interface WorkoutLogBrief {
  session_date: string;
  day_name: string | null;
  notes?: string | null;
  sets: {
    exercise: string;
    muscle?: string | null;
    set: number;
    weight: number | null;
    reps: number | null;
  }[];
}

// The athlete's post-workout self-eval (RPE + their own words), joined to the
// session it rates so the AI can line it up with the logged workout by date.
export interface SelfEvalBrief {
  workout_date: string;
  day_name: string | null;
  rpe: number; // 1-10 Rate of Perceived Exertion
  feedback: string | null; // their one-liner ("felt strong", "hit plateau")
}

// Where the athlete is in their program. Gives temporal context the AI lacks.
export interface ProgramContext {
  dayNumber: number;     // calendar days since first check-in (1-indexed)
  programWeek: number;   // ceil(dayNumber / 7)
  totalCheckins: number; // how many check-ins have been logged so far
  firstCheckinDate: string; // YYYY-MM-DD of their very first check-in
}

export interface ChatTurn {
  role: "athlete" | "coach";
  body: string;
}

export interface WorkoutExerciseBrief {
  id: string;
  name: string;
  muscle_group: string | null;
  target_sets: number | null;
  target_reps: string | null;
  position: number;
}

export interface WorkoutDayBrief {
  id: string;
  name: string;
  label: string | null;
  position: number;
  exercises: WorkoutExerciseBrief[];
}

// Everything the AI is fed. Mirrors what the admin review page already loads.
export interface CoachContext {
  athleteName: string | null;
  today: string; // YYYY-MM-DD the decision is for
  profile: import("./types").AthleteProfile | null;
  latestCheckin: import("./types").DailyCheckin | null;
  recentCheckins: import("./types").DailyCheckin[]; // last ~7 days, newest first
  screenshots: import("./types").UploadedScreenshot[]; // recent uploads (with any OCR'd values)
  memoryNotes: import("./types").AthleteMemoryNote[];
  previousResponses: import("./types").CoachResponse[]; // newest first
  predictions: import("./types").PredictionWithOutcome[];
  feedback: import("./types").UserFeedback[];
  recentWorkouts?: WorkoutLogBrief[]; // logged sessions w/ per-set weight+reps
  selfEvals?: SelfEvalBrief[]; // post-workout RPE + feedback, newest first
  recentMessages?: ChatTurn[]; // recent coach<->athlete chat (oldest first)
  programContext?: ProgramContext; // absent for brand-new athletes
  workoutDays?: WorkoutDayBrief[]; // saved program structure (days + exercises with IDs)
  trendInsights?: import("./coach-trends").TrendInsights | null; // trend engine output (gated; absent until 21 days of data)
  temporalSummary?: import("./coach-temporal").TemporalSummary | null; // long-arc view (up to 180 days; absent until C2 wires the fetch)
}
