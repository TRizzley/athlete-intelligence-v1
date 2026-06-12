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
import type { DailyCheckin } from "./types";
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
