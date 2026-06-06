// ----------------------------------------------------------------------------
// Trust / accuracy metric computation. Pure functions over feedback + outcome
// rows so the same logic powers the admin dashboard, the user detail page, and
// the saved trust_metrics snapshots.
// ----------------------------------------------------------------------------

import type {
  ComputedTrustMetrics,
  PredictionOutcome,
  UserFeedback,
} from "./types";

// Share of non-null answers equal to a target value, as a percentage.
function rate(values: (string | null)[], positive: string): number | null {
  const answered = values.filter((v) => v !== null && v !== undefined);
  if (answered.length === 0) return null;
  const hits = answered.filter((v) => v === positive).length;
  return (hits / answered.length) * 100;
}

export function computeTrustMetrics(
  feedback: UserFeedback[],
  outcomes: PredictionOutcome[],
  predictionsTotal: number,
): ComputedTrustMetrics {
  const ahaRate = rate(feedback.map((f) => f.felt_personalized), "yes");
  const accuracyRate = rate(feedback.map((f) => f.felt_accurate), "yes");
  const usefulnessRate = rate(feedback.map((f) => f.was_useful), "yes");
  const wouldPayRate = rate(feedback.map((f) => f.would_pay), "yes");

  // Prediction accuracy: came_true = 1.0, partially = 0.5, false = 0.
  // too_early / unknown are not yet scorable.
  const scorable = outcomes.filter((o) =>
    ["came_true", "partially", "false"].includes(o.outcome),
  );
  let correct = 0;
  for (const o of scorable) {
    if (o.outcome === "came_true") correct += 1;
    else if (o.outcome === "partially") correct += 0.5;
  }
  const predictionAccuracy =
    scorable.length > 0 ? (correct / scorable.length) * 100 : null;

  return {
    feedbackCount: feedback.length,
    ahaRate,
    accuracyRate,
    usefulnessRate,
    wouldPayRate,
    predictionsTotal,
    predictionsScored: scorable.length,
    predictionsCorrect: correct,
    predictionAccuracy,
  };
}

// Normalize a possibly-nested prediction_outcomes relation (Supabase returns
// either an object, an array, or null depending on the join) into a flat list.
export function flattenOutcomes(
  rows: { prediction_outcomes: PredictionOutcome[] | PredictionOutcome | null }[],
): PredictionOutcome[] {
  const out: PredictionOutcome[] = [];
  for (const r of rows) {
    const po = r.prediction_outcomes;
    if (!po) continue;
    if (Array.isArray(po)) out.push(...po);
    else out.push(po);
  }
  return out;
}
