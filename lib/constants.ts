// ----------------------------------------------------------------------------
// Option lists + human-readable labels used across forms and displays.
// ----------------------------------------------------------------------------

import type { ScreenshotSource } from "./types";

export const APP_NAME = "The Coach";
export const APP_TAGLINE = "Know exactly how hard to train today — based on your body, not averages.";

export const SPORTS: { value: string; label: string }[] = [
  { value: "strength", label: "Strength / Powerlifting" },
  { value: "endurance", label: "Endurance (run / bike / tri)" },
  { value: "hybrid", label: "Hybrid (CrossFit / mixed)" },
  { value: "other", label: "Other" },
];

export const GOALS: { value: string; label: string }[] = [
  { value: "performance", label: "Performance / get stronger / faster" },
  { value: "body_composition", label: "Body composition" },
  { value: "event", label: "Prep for a specific event" },
  { value: "general_health", label: "General health & longevity" },
];

export const TRAINING_AGES: { value: string; label: string; hint: string }[] = [
  { value: "beginner", label: "Beginner", hint: "Less than 1 year of consistent training" },
  { value: "intermediate", label: "Intermediate", hint: "1–3 years, you have a system" },
  { value: "advanced", label: "Advanced", hint: "3+ years, experienced & self-coached" },
];

export const COACHING_TONES: { value: string; label: string; hint: string }[] = [
  { value: "tough_love", label: "Tough love", hint: "Direct, demanding, hold me accountable" },
  { value: "balanced", label: "Balanced", hint: "Straight talk, but read the room" },
  { value: "supportive", label: "Supportive", hint: "Encouraging, meet me where I am" },
];

export const FATIGUE_TENDENCIES: { value: string; label: string; hint: string }[] = [
  { value: "push_through", label: "Push through", hint: "I tend to override fatigue and train anyway" },
  { value: "balanced", label: "It depends", hint: "I read it case by case" },
  { value: "cautious", label: "Back off", hint: "I tend to rest when I feel run down" },
];

export const SEXES: { value: string; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

export const DEVICES: { value: string; label: string }[] = [
  { value: "whoop", label: "WHOOP" },
  { value: "oura", label: "Oura" },
  { value: "garmin", label: "Garmin" },
  { value: "apple_watch", label: "Apple Watch" },
  { value: "coros", label: "COROS" },
  { value: "polar", label: "Polar" },
  { value: "other", label: "Other" },
];

export const WORKOUT_TYPES: { value: string; label: string }[] = [
  { value: "strength", label: "Strength" },
  { value: "hypertrophy", label: "Hypertrophy" },
  { value: "cardio_easy", label: "Easy cardio (Z1–2)" },
  { value: "cardio_hard", label: "Hard cardio (threshold / VO2)" },
  { value: "intervals", label: "Intervals / HIIT" },
  { value: "sport", label: "Sport / skill" },
  { value: "mobility", label: "Mobility / recovery" },
  { value: "rest", label: "Rest day" },
  { value: "other", label: "Other" },
];

export const WORKOUT_SPLITS: { value: string; label: string }[] = [
  { value: "push", label: "Push" },
  { value: "pull", label: "Pull" },
  { value: "legs", label: "Legs" },
  { value: "upper", label: "Upper" },
  { value: "lower", label: "Lower" },
  { value: "full_body", label: "Full body" },
  { value: "conditioning", label: "Conditioning" },
  { value: "other", label: "Other" },
];

export const SCREENSHOT_SOURCES: { value: ScreenshotSource; label: string; hint: string }[] = [
  { value: "whoop", label: "WHOOP", hint: "Recovery, HRV, sleep, strain" },
  { value: "oura", label: "Oura", hint: "Readiness, sleep, HRV" },
  { value: "garmin", label: "Garmin", hint: "Body Battery, sleep, training status" },
  { value: "apple_health", label: "Apple Health", hint: "Sleep, HR, steps, weight" },
  { value: "apple_fitness", label: "Apple Fitness", hint: "Workouts, rings, calories" },
  { value: "nutrition", label: "Nutrition app", hint: "MyFitnessPal, Cronometer, etc." },
  { value: "other", label: "Other", hint: "Anything else relevant" },
];

export const SOURCE_LABELS: Record<string, string> = Object.fromEntries(
  SCREENSHOT_SOURCES.map((s) => [s.value, s.label]),
);

export const CONFIDENCE_OPTIONS: { value: string; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const HORIZON_OPTIONS: { value: string; label: string }[] = [
  { value: "tomorrow", label: "Tomorrow" },
  { value: "3-day", label: "Next 3 days" },
  { value: "7-day", label: "Next 7 days" },
  { value: "this-week", label: "This week" },
];

export const OUTCOME_OPTIONS: { value: string; label: string }[] = [
  { value: "came_true", label: "Came true" },
  { value: "partially", label: "Partially" },
  { value: "false", label: "Did not come true" },
  { value: "too_early", label: "Too early to tell" },
  { value: "unknown", label: "Unknown" },
];

// Coach self-grade (Layer 1) — performance prediction vs. actual workout log.
export const SELF_GRADE_OPTIONS: { value: string; label: string }[] = [
  { value: "accurate", label: "Accurate" },
  { value: "slightly_off", label: "Slightly Off" },
  { value: "missed", label: "Missed" },
];

// Feedback question option sets
export const YSN_OPTIONS: { value: string; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "somewhat", label: "Somewhat" },
  { value: "no", label: "No" },
];

export const PREDICTION_FEEDBACK_OPTIONS: { value: string; label: string }[] = [
  { value: "yes", label: "Yes, it did" },
  { value: "somewhat", label: "Sort of" },
  { value: "no", label: "No" },
  { value: "too_early", label: "Too early to tell" },
];

export const WOULD_PAY_OPTIONS: { value: string; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "maybe", label: "Maybe" },
  { value: "no", label: "No" },
];

// 1–10 subjective slider metadata (label + low/high anchors)
export const SLIDER_FIELDS: {
  name: string;
  label: string;
  low: string;
  high: string;
}[] = [
  { name: "energy", label: "Energy", low: "Exhausted", high: "Energized" },
  { name: "mood", label: "Mood", low: "Terrible", high: "Excellent" },
  { name: "soreness", label: "Muscle soreness", low: "None", high: "Severe" },
  { name: "stress", label: "Stress", low: "Calm", high: "Very stressed" },
  { name: "motivation", label: "Motivation to train", low: "None", high: "High" },
  { name: "sleep_quality", label: "Sleep quality (felt)", low: "Terrible", high: "Great" },
];

export function labelFor(
  options: { value: string; label: string }[],
  value: string | null | undefined,
): string {
  if (!value) return "—";
  return options.find((o) => o.value === value)?.label ?? value;
}
