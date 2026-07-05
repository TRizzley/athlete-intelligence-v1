// Self-eval summarization — deterministic stats derived from the athlete's
// post-workout self-evals (RPE + feedback), pre-computed so the AI never has
// to do arithmetic over raw rows (same reasoning as lib/coach-trends.ts).
// Pure functions only; fetching lives in lib/context.ts.

import type { SelfEvalBrief } from "./coach-types";

/** How many of the newest evals the average is taken over. */
export const AVG_WINDOW = 5;

export interface EvalSummary {
  /** Mean RPE of the newest AVG_WINDOW evals, rounded to 1 decimal. Null when no evals. */
  avgRPE: number | null;
  /** The newest eval's feedback text (null when absent — older feedback is not substituted). */
  recentFeedback: string | null;
  /** How many evals were provided. */
  rpeCount: number;
  /** Newest vs. second-newest RPE: 'up' | 'down' | 'stable'. Null with fewer than 2 evals. */
  rpeTrend: "up" | "down" | "stable" | null;
}

/**
 * Derive coaching stats from an athlete's self-evals.
 *
 * @param evals Self-evals NEWEST FIRST (the order lib/context.ts fetches them).
 * @returns Average RPE (last {@link AVG_WINDOW}), the newest feedback text,
 *          eval count, and the direction of the two most recent RPEs.
 *          All-null/zero shape when `evals` is empty — never throws.
 */
export function summarizeSelfEvals(evals: SelfEvalBrief[]): EvalSummary {
  if (evals.length === 0) {
    return { avgRPE: null, recentFeedback: null, rpeCount: 0, rpeTrend: null };
  }

  const window = evals.slice(0, AVG_WINDOW);
  const avgRPE =
    Math.round((window.reduce((sum, e) => sum + e.rpe, 0) / window.length) * 10) / 10;

  let rpeTrend: EvalSummary["rpeTrend"] = null;
  if (evals.length >= 2) {
    if (evals[0].rpe > evals[1].rpe) rpeTrend = "up";
    else if (evals[0].rpe < evals[1].rpe) rpeTrend = "down";
    else rpeTrend = "stable";
  }

  return {
    avgRPE,
    recentFeedback: evals[0].feedback,
    rpeCount: evals.length,
    rpeTrend,
  };
}
