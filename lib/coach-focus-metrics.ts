// Focus coverage metrics — the dial for how often the self-eval pipeline
// (detectWorkoutPatterns -> derivePatternFocus) produces an actionable
// coaching focus across the athlete base. No new coaching behavior lives
// here; it only measures what lib/coach-focus.ts already decided.
// Pure functions only; fetching lives with the caller.

import type { PatternFocus } from "./coach-focus";

/** Coverage stats over one focus directive per athlete. */
export interface FocusCoverage {
  /** How many athletes were measured. */
  total: number;
  /** Athletes whose focus names at least one type (push or pull_back). */
  withActionableFocus: number;
  /** Athletes whose focus is 'high' confidence. */
  highConfidence: number;
  /** withActionableFocus as a percentage of total, rounded to 1 decimal. */
  pct_actionable: number;
  /** highConfidence as a percentage of total, rounded to 1 decimal. */
  pct_high_confidence: number;
}

/** Percentage of `part` in `total`, rounded to 1 decimal; 0 when total is 0. */
function pct(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

/**
 * Summarize how much of the athlete base gets an actionable coaching focus.
 *
 * "Actionable" means the focus names at least one type to act on
 * (`push_type` or `pull_back_type` non-null); "high confidence" means the
 * directive's confidence is 'high' (every chosen bucket met
 * FOCUS_CONFIDENCE_MIN_COUNT). Percentages are rounded to 1 decimal and are
 * 0 (never NaN) for empty input — never throws.
 *
 * This operates on already-derived focus objects, one per athlete, so it
 * stays pure and DB-free: the caller is responsible for building each
 * athlete's context and running derivePatternFocus, then passing the
 * results here.
 *
 * Expect 0% until athletes actually submit self-evals — that reading is the
 * signal that getting evals flowing is the priority, not a pipeline failure.
 *
 * @param perAthlete One derived focus per athlete (the PatternFocus fields
 *                   the metric needs; rationale is irrelevant here).
 */
export function summarizeFocusCoverage(
  perAthlete: Array<
    Pick<PatternFocus, "push_type" | "pull_back_type" | "confidence">
  >,
): FocusCoverage {
  const total = perAthlete.length;
  const withActionableFocus = perAthlete.filter(
    (f) => f.push_type !== null || f.pull_back_type !== null,
  ).length;
  const highConfidence = perAthlete.filter(
    (f) => f.confidence === "high",
  ).length;

  return {
    total,
    withActionableFocus,
    highConfidence,
    pct_actionable: pct(withActionableFocus, total),
    pct_high_confidence: pct(highConfidence, total),
  };
}
