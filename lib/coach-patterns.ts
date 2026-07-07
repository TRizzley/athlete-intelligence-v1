// Workout-type pattern detection — deterministic stats over the athlete's
// post-workout self-evals, grouped by the WORKOUT they rated (day_name), never
// by calendar day-of-week: athletes do the same workout on different days, so
// calendar grouping would blur distinct workout types into one average.
// Pre-computed so the AI never does arithmetic over raw rows (same reasoning
// as lib/coach-evals.ts and lib/coach-trends.ts).
// Pure functions only; fetching lives in lib/context.ts.

import type { SelfEvalBrief } from "./coach-types";

/** How many days back from `today` an eval counts toward patterns. */
export const PATTERN_WINDOW_DAYS = 30;
/** Buckets with fewer evals than this are dropped — signal, not outliers. */
export const MIN_EVALS_PER_BUCKET = 2;
/** Average RPE at or above this marks a peak workout type. */
export const PEAK_RPE = 7;
/** Average RPE at or below this marks a struggle workout type. */
export const STRUGGLE_RPE = 5;
/** First-half vs. second-half average gap that counts as a real trend. */
export const TREND_DELTA = 0.5;

const MS_PER_DAY = 86_400_000;

/** One workout type's aggregated pattern over the window. */
export interface WorkoutTypePattern {
  /** Display label: the athlete's most recent spelling ("Ad-hoc" for unnamed). */
  label: string;
  /** Mean RPE across the bucket, rounded to 1 decimal. */
  avgRpe: number;
  /** How many evals landed in this bucket. */
  count: number;
  /**
   * Chronological first half vs. second half of this bucket's evals:
   * 'up' when the later average exceeds the earlier by more than
   * {@link TREND_DELTA}, 'down' for the reverse, else 'stable'.
   */
  trend: "up" | "down" | "stable";
}

/** Everything the coach layer needs about an athlete's workout-type patterns. */
export interface WorkoutPatterns {
  /** Patterns keyed by normalized workout name (trimmed, lowercased; "ad-hoc" for unnamed). */
  byWorkoutType: { [normalizedKey: string]: WorkoutTypePattern };
  /** Display labels of types with avg RPE >= {@link PEAK_RPE}. */
  peakTypes: string[];
  /** Display labels of types with avg RPE <= {@link STRUGGLE_RPE}. */
  struggleTypes: string[];
  /** Plain-language coaching cues derived from peak/struggle types. */
  recommendations: string[];
  /** {@link PATTERN_WINDOW_DAYS} when evals were processed; 0 for empty input. */
  windowDays: number;
}

const EMPTY_PATTERNS: WorkoutPatterns = {
  byWorkoutType: {},
  peakTypes: [],
  struggleTypes: [],
  recommendations: [],
  windowDays: 0,
};

function mean(nums: number[]): number {
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

/**
 * Detect per-workout-type RPE patterns from an athlete's self-evals.
 *
 * Groups evals by normalized `day_name` (null/empty → the "Ad-hoc" bucket),
 * keeps only evals whose `workout_date` falls within the last
 * {@link PATTERN_WINDOW_DAYS} days of `today` (inclusive; empty or unparseable
 * dates are excluded, never NaN-compared), and drops buckets with fewer than
 * {@link MIN_EVALS_PER_BUCKET} evals.
 *
 * @param evals Self-evals in any order (lib/context.ts fetches newest first);
 *              each bucket is re-sorted chronologically by workout_date.
 * @param today The date the context is built for, YYYY-MM-DD.
 * @returns Per-type averages, counts, and trends plus peak/struggle labels and
 *          recommendations. Empty shape (windowDays 0) when `evals` is empty —
 *          never throws.
 */
export function detectWorkoutPatterns(
  evals: SelfEvalBrief[],
  today: string,
): WorkoutPatterns {
  if (evals.length === 0) return EMPTY_PATTERNS;

  const todayMs = Date.parse(today + "T00:00:00Z");
  const cutoffMs = todayMs - PATTERN_WINDOW_DAYS * MS_PER_DAY;

  // Window filter. workout_date can be "" when the session join was null
  // (lib/context.ts falls back to "") — Date.parse then yields NaN and the
  // Number.isFinite guard excludes the eval instead of NaN-comparing.
  const inWindow = evals.filter((e) => {
    const t = Date.parse(e.workout_date + "T00:00:00Z");
    return Number.isFinite(t) && t >= cutoffMs && t <= todayMs;
  });

  const buckets = new Map<string, SelfEvalBrief[]>();
  for (const e of inWindow) {
    const raw = (e.day_name ?? "").trim();
    const key = raw === "" ? "ad-hoc" : raw.toLowerCase();
    const bucket = buckets.get(key);
    if (bucket) bucket.push(e);
    else buckets.set(key, [e]);
  }

  const byWorkoutType: WorkoutPatterns["byWorkoutType"] = {};
  for (const [key, bucketEvals] of buckets) {
    if (bucketEvals.length < MIN_EVALS_PER_BUCKET) continue;

    const ordered = [...bucketEvals].sort((a, b) =>
      a.workout_date.localeCompare(b.workout_date),
    );
    const rpes = ordered.map((e) => e.rpe);
    const avgRpe = Math.round(mean(rpes) * 10) / 10;

    const mid = Math.ceil(rpes.length / 2);
    const firstAvg = mean(rpes.slice(0, mid));
    const secondAvg = mean(rpes.slice(mid));
    let trend: WorkoutTypePattern["trend"] = "stable";
    if (secondAvg > firstAvg + TREND_DELTA) trend = "up";
    else if (secondAvg < firstAvg - TREND_DELTA) trend = "down";

    // Display label: the most recent original spelling of this workout's name.
    const newestName = (ordered[ordered.length - 1].day_name ?? "").trim();
    const label = newestName === "" ? "Ad-hoc" : newestName;

    byWorkoutType[key] = { label, avgRpe, count: rpes.length, trend };
  }

  const patterns = Object.values(byWorkoutType);
  const peakTypes = patterns
    .filter((p) => p.avgRpe >= PEAK_RPE)
    .map((p) => p.label);
  const struggleTypes = patterns
    .filter((p) => p.avgRpe <= STRUGGLE_RPE)
    .map((p) => p.label);

  const recommendations: string[] = [];
  if (peakTypes.length > 0) {
    recommendations.push(
      `You perform strongest on ${peakTypes.join(", ")}. Good days to push intensity.`,
    );
  }
  if (struggleTypes.length > 0) {
    recommendations.push(
      `${struggleTypes.join(", ")} are consistently lower. Consider recovery focus or technique work there.`,
    );
  }

  return {
    byWorkoutType,
    peakTypes,
    struggleTypes,
    recommendations,
    windowDays: PATTERN_WINDOW_DAYS,
  };
}
