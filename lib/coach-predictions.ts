// Prediction scoring — closes the track-record loop.
//
// Each daily decision logs a specific, checkable prediction for the next day.
// Once the target day's check-in exists, this compares the prediction against
// what actually happened and returns a graded outcome.
//
// Throws on infrastructure failure so the caller can skip and retry later
// rather than permanently recording a bogus outcome.
// Server-only. Requires ANTHROPIC_API_KEY.

import Anthropic from "@anthropic-ai/sdk";
import type { DailyCheckin, SelfGrade } from "./types";
import type { WorkoutLogBrief } from "./coach-types";
import { checkinBrief, asString } from "./coach-context";

export type PredictionOutcomeValue =
  | "came_true"
  | "partially"
  | "false"
  | "too_early"
  | "unknown";

export interface PredictionScore {
  outcome: PredictionOutcomeValue;
  notes: string;
}

// Layer-1 self-grade: the coach grading its OWN performance prediction against
// what the athlete actually lifted/did, in plain Accurate / Slightly Off / Missed
// terms with a one-sentence delta note.
export interface PredictionSelfGrade {
  self_grade: SelfGrade;
  note: string;
}

const SELF_GRADES: SelfGrade[] = ["accurate", "slightly_off", "missed"];

const PRED_OUTCOMES: PredictionOutcomeValue[] = [
  "came_true",
  "partially",
  "false",
  "too_early",
  "unknown",
];

const SCORE_SYSTEM_PROMPT = [
  "You grade whether a performance coach's next-day prediction came true, given the athlete's ACTUAL check-in for the day the prediction was about.",
  "Compare the prediction's specific, checkable claims (e.g. a recovery score threshold, an energy/mood change, a soreness change) against the actual numbers.",
  "Choose ONE outcome:",
  "- came_true: the main checkable claims held.",
  "- partially: some claims held, others did not.",
  "- false: the main claims were wrong.",
  "- too_early: the specific metric the prediction depends on is missing from the actual check-in, so it can't be judged yet.",
  "- unknown: the prediction was too vague to verify, or the data genuinely can't settle it.",
  "Write one short notes sentence citing the actual numbers vs. what was predicted. Be objective; do not give the coach the benefit of the doubt.",
  "Return ONLY by calling record_outcome.",
].join("\n");

const SCORE_TOOL: Anthropic.Tool = {
  name: "record_outcome",
  description: "Record the graded outcome of the coach's prediction.",
  input_schema: {
    type: "object",
    properties: {
      outcome: {
        type: "string",
        enum: ["came_true", "partially", "false", "too_early", "unknown"],
        description: "How the prediction held up against the actual data.",
      },
      notes: {
        type: "string",
        description:
          "One short sentence citing the actual numbers vs. what was predicted.",
      },
    },
    required: ["outcome", "notes"],
  },
};

export async function scorePredictionOutcome(
  predictionText: string,
  targetDate: string,
  actualCheckin: DailyCheckin | null,
  priorCheckin: DailyCheckin | null,
): Promise<PredictionScore> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  if (!actualCheckin) {
    return { outcome: "too_early", notes: "No check-in for the target day yet." };
  }

  const client = new Anthropic({ apiKey });

  const userContent =
    `PREDICTION (made the day before, about ${targetDate}):\n${predictionText}\n\n` +
    (priorCheckin
      ? `BASELINE — check-in the prediction was made from:\n${JSON.stringify(
          checkinBrief(priorCheckin),
          null,
          2,
        )}\n\n`
      : "") +
    `ACTUAL — check-in for ${targetDate} (what really happened):\n${JSON.stringify(
      checkinBrief(actualCheckin),
      null,
      2,
    )}\n\nGrade it by calling record_outcome.`;

  const msg = await client.messages.create({
    model: process.env.MEMORY_MODEL || "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system: SCORE_SYSTEM_PROMPT,
    tools: [SCORE_TOOL],
    tool_choice: { type: "tool", name: "record_outcome" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) throw new Error("Prediction scorer returned no result.");

  const o = (toolUse.input ?? {}) as Record<string, unknown>;
  const raw = asString(o.outcome).toLowerCase() as PredictionOutcomeValue;
  const outcome: PredictionOutcomeValue = PRED_OUTCOMES.includes(raw)
    ? raw
    : "unknown";
  return { outcome, notes: asString(o.notes) };
}

// ── Layer 1: coach self-grade vs. the actual workout log ──────────────────────

const SELF_GRADE_SYSTEM_PROMPT = [
  "You are a performance coach grading your OWN previous-day prediction against what the athlete ACTUALLY did in the gym, read from their logged workout (exercises, weights, reps).",
  "The prediction was a concrete performance call (e.g. 'hit 245 on squat for 4x5', or a target pace/distance/RPE). Compare it to the matching exercise in the workout log.",
  "Assign ONE grade, judged on how close the actual output was to what you predicted:",
  "- accurate: they hit essentially what you called (the predicted lift/output landed on target).",
  "- slightly_off: in the right ballpark but meaningfully above or below (e.g. predicted 245x5, hit 235x5, or got the reps but not the weight).",
  "- missed: clearly wrong — wrong direction, far off the numbers, or they trained something entirely different than the prediction assumed.",
  "Write ONE short note citing actual vs predicted numbers, and the likely reason for any delta if the data suggests one (e.g. 'predicted 245 squat, hit 235 — likely the poor sleep they reported').",
  "Be objective; do not give yourself the benefit of the doubt. Return ONLY by calling record_self_grade.",
].join("\n");

const SELF_GRADE_TOOL: Anthropic.Tool = {
  name: "record_self_grade",
  description: "Record how the coach's performance prediction held up against the actual workout log.",
  input_schema: {
    type: "object",
    properties: {
      self_grade: {
        type: "string",
        enum: ["accurate", "slightly_off", "missed"],
        description: "How close the actual workout was to the prediction.",
      },
      note: {
        type: "string",
        description: "One short sentence citing actual vs. predicted numbers and the likely cause of any delta.",
      },
    },
    required: ["self_grade", "note"],
  },
};

/**
 * Grade a performance prediction against the athlete's actual logged workout.
 * Returns null when there is no usable workout to grade against (no sets logged),
 * so the caller can simply skip the self-grade rather than fabricate one.
 * Throws on infrastructure failure so the caller can skip and retry later.
 */
export async function gradePredictionVsWorkout(
  predictionText: string,
  targetDate: string,
  workout: WorkoutLogBrief | null,
): Promise<PredictionSelfGrade | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  // No logged workout (or an empty one) means there's nothing to grade against.
  if (!workout || !workout.sets || workout.sets.length === 0) return null;

  const client = new Anthropic({ apiKey });

  const userContent =
    `PREDICTION (made the day before, about ${targetDate}'s session):\n${predictionText}\n\n` +
    `ACTUAL WORKOUT LOGGED on ${workout.session_date}` +
    (workout.day_name ? ` (${workout.day_name})` : "") +
    `:\n${JSON.stringify(
      {
        notes: workout.notes ?? undefined,
        sets: workout.sets.map((s) => ({
          exercise: s.exercise,
          muscle: s.muscle ?? undefined,
          set: s.set,
          weight_lbs: s.weight,
          reps: s.reps,
        })),
      },
      null,
      2,
    )}\n\nGrade your prediction by calling record_self_grade.`;

  const msg = await client.messages.create({
    model: process.env.MEMORY_MODEL || "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system: SELF_GRADE_SYSTEM_PROMPT,
    tools: [SELF_GRADE_TOOL],
    tool_choice: { type: "tool", name: "record_self_grade" },
    messages: [{ role: "user", content: userContent }],
  });

  const toolUse = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) throw new Error("Self-grader returned no result.");

  const o = (toolUse.input ?? {}) as Record<string, unknown>;
  const raw = asString(o.self_grade).toLowerCase() as SelfGrade;
  const self_grade: SelfGrade = SELF_GRADES.includes(raw) ? raw : "missed";
  return { self_grade, note: asString(o.note) };
}
