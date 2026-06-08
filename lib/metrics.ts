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

// The column shape of a trust_metrics row to insert/upsert. Shared so the
// automatic daily snapshot and the manual admin snapshot write identical rows.
export interface TrustSnapshotRow {
  user_id: string;
  snapshot_date: string; // YYYY-MM-DD
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
}

// Build a snapshot row from already-fetched data. Pure — the caller upserts it
// on (user_id, snapshot_date) so there is one row per athlete per day.
export function buildTrustSnapshotRow(args: {
  userId: string;
  date: string;
  feedback: UserFeedback[];
  outcomes: PredictionOutcome[];
  predictionsTotal: number;
  responsesSent: number;
  createdBy?: string | null;
}): TrustSnapshotRow {
  const m = computeTrustMetrics(
    args.feedback,
    args.outcomes,
    args.predictionsTotal,
  );
  return {
    user_id: args.userId,
    snapshot_date: args.date,
    responses_sent: args.responsesSent,
    feedback_count: m.feedbackCount,
    aha_rate: m.ahaRate,
    accuracy_rate: m.accuracyRate,
    usefulness_rate: m.usefulnessRate,
    would_pay_rate: m.wouldPayRate,
    predictions_total: m.predictionsTotal,
    predictions_correct: m.predictionsCorrect,
    prediction_accuracy: m.predictionAccuracy,
    created_by: args.createdBy ?? null,
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
