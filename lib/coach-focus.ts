// Pattern-driven coaching focus — turns the detected workout-type patterns
// into an explicit, deterministic coaching directive. The DECISION of what to
// emphasize lives here, in inspectable and testable code; the LLM's only job
// is to phrase it (same pre-compute reasoning as lib/coach-evals.ts and
// lib/coach-patterns.ts — no LLM arithmetic, ever).
// Pure functions only; fetching lives in lib/context.ts.

import type { WorkoutPatterns, WorkoutTypePattern } from "./coach-patterns";

/**
 * Every chosen bucket needs at least this many evals for the focus to be
 * 'high' confidence; anything thinner is 'low'. (Feeds B3 metrics later.)
 */
export const FOCUS_CONFIDENCE_MIN_COUNT = 3;

/** How each trend value reads inside a rationale line. */
const TREND_PHRASE: Record<WorkoutTypePattern["trend"], string> = {
  up: "trending up",
  down: "trending down",
  stable: "holding steady",
};

/**
 * The deterministic coaching directive derived from an athlete's workout-type
 * patterns. The fields say WHAT to emphasize; phrasing the actual coaching
 * words is the LLM's job.
 */
export interface PatternFocus {
  /** Display label of the peak type to lean into; null when there are no peaks. */
  push_type: string | null;
  /** Display label of the struggle type to ease off; null when there are no struggles. */
  pull_back_type: string | null;
  /**
   * One deterministic evidence line per chosen type (push first), built from
   * the actual numbers — e.g. "Leg day averaging 8/10 and trending up".
   * Never contains calendar-day language.
   */
  rationale: string[];
  /**
   * 'high' when every chosen bucket has at least
   * {@link FOCUS_CONFIDENCE_MIN_COUNT} evals, 'low' otherwise; null when no
   * type was chosen at all.
   */
  confidence: "high" | "low" | null;
}

/**
 * Rank a trend for tie-breaking: the preferred direction beats 'stable',
 * which beats the opposite direction.
 */
function trendRank(
  trend: WorkoutTypePattern["trend"],
  preferred: "up" | "down",
): number {
  if (trend === preferred) return 2;
  if (trend === "stable") return 1;
  return 0;
}

/**
 * Pick the single best bucket among the candidate labels, fully
 * deterministically. Peaks: highest avgRpe wins; struggles: lowest wins.
 * Ties break by trend (prefer 'up' for peaks, 'down' for struggles, with
 * 'stable' beating the opposite direction), then by higher count (more
 * evidence), then alphabetically by label so the order of the input can
 * never change the result.
 */
function pickBucket(
  labels: string[],
  byLabel: Map<string, WorkoutTypePattern>,
  direction: "peak" | "struggle",
): WorkoutTypePattern | null {
  const candidates = labels
    .map((label) => byLabel.get(label))
    .filter((p): p is WorkoutTypePattern => p !== undefined);
  if (candidates.length === 0) return null;

  const preferredTrend = direction === "peak" ? "up" : "down";
  const best = [...candidates].sort((a, b) => {
    if (a.avgRpe !== b.avgRpe) {
      return direction === "peak" ? b.avgRpe - a.avgRpe : a.avgRpe - b.avgRpe;
    }
    const byTrend =
      trendRank(b.trend, preferredTrend) - trendRank(a.trend, preferredTrend);
    if (byTrend !== 0) return byTrend;
    if (a.count !== b.count) return b.count - a.count;
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  });
  return best[0];
}

/** Deterministic evidence line for a chosen bucket. No calendar-day language. */
function rationaleLine(p: WorkoutTypePattern): string {
  return `${p.label} averaging ${p.avgRpe}/10 and ${TREND_PHRASE[p.trend]}`;
}

/**
 * Derive the coaching focus directive from detected workout-type patterns.
 *
 * Decision priority (all deterministic, independent of input order):
 * - push_type: the peak type with the highest avgRpe; ties break by trend
 *   (prefer 'up'), then higher count, then alphabetical label.
 * - pull_back_type: the struggle type with the lowest avgRpe; ties break by
 *   trend (prefer 'down'), then higher count, then alphabetical label.
 * - A type can never be both (peaks are avgRpe >= 7, struggles <= 5, mutually
 *   exclusive by construction) — asserted, throws on the impossible case.
 * - confidence: 'high' only when EVERY chosen bucket has at least
 *   {@link FOCUS_CONFIDENCE_MIN_COUNT} evals, else 'low'; null with no choice.
 *
 * The returned directive is what the coach should emphasize; the LLM voices
 * it naturally but never re-derives or recomputes it.
 *
 * @param patterns Output of detectWorkoutPatterns(). The empty shape (or one
 *                 with no peaks/struggles) yields the all-null focus — never
 *                 throws on thin input.
 */
export function derivePatternFocus(patterns: WorkoutPatterns): PatternFocus {
  const byLabel = new Map<string, WorkoutTypePattern>();
  for (const p of Object.values(patterns.byWorkoutType)) {
    byLabel.set(p.label, p);
  }

  const push = pickBucket(patterns.peakTypes, byLabel, "peak");
  const pullBack = pickBucket(patterns.struggleTypes, byLabel, "struggle");

  if (push && pullBack && push.label === pullBack.label) {
    throw new Error(
      `derivePatternFocus: "${push.label}" is both peak and struggle — thresholds must be broken`,
    );
  }

  const chosen = [push, pullBack].filter(
    (p): p is WorkoutTypePattern => p !== null,
  );
  if (chosen.length === 0) {
    return { push_type: null, pull_back_type: null, rationale: [], confidence: null };
  }

  return {
    push_type: push ? push.label : null,
    pull_back_type: pullBack ? pullBack.label : null,
    rationale: chosen.map(rationaleLine),
    confidence: chosen.every((p) => p.count >= FOCUS_CONFIDENCE_MIN_COUNT)
      ? "high"
      : "low",
  };
}
