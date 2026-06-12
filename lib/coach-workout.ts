// Post-workout review — the coach's conversational review right after the
// athlete logs their session. Closes the morning loop, reviews the session,
// gives rest-of-day recovery guidance, and sets a prediction for tomorrow.
// Server-only. Requires ANTHROPIC_API_KEY.

import Anthropic from "@anthropic-ai/sdk";
import type { Confidence } from "./types";
import type { CoachContext } from "./coach-types";
import { buildContextText, asString, CONFIDENCES } from "./coach-context";
import type { PredictionOutcomeValue } from "./coach-predictions";

export interface WorkoutReview {
  message: string;
  next_morning_prediction: string;
  confidence: Confidence;
}

// What the route scored the morning prediction as (if one existed for today).
export interface MorningPredictionResult {
  prediction_text: string;
  outcome: PredictionOutcomeValue;
  notes: string | null;
}

const WORKOUT_REVIEW_SYSTEM_PROMPT = [
  "You are the athlete's personal performance coach. They just finished training, logged their post-workout check-in, and opened the chat to see your review. Write it like a coach texting right after watching the session.",
  "",
  "COVER, woven into natural conversation (not sections):",
  "1. The session itself: what they trained, how hard (intensity/RPE), key lifts or top set, and how it lines up with the plan you set this morning. Be encouraging but honest — if they coasted on a day that should've been hard, or hammered it on low recovery, name it kindly.",
  "2. The verdict on this morning's prediction, if one is provided below: say plainly whether you called it right or missed, and what that tells you about them. Owning a miss builds trust — never spin it.",
  "3. Rest of today: 1-2 concrete recovery/refuel moves specific to their data (protein or calorie target, hydration, bedtime, easy mobility) so tomorrow starts right.",
  "4. Your prediction for TOMORROW MORNING: how you expect them to wake up (recovery, soreness, energy, readiness) given today's session and their patterns. Make it specific and verifiable against tomorrow's morning check-in. Include it in the message AND in the structured field.",
  "",
  "STYLE:",
  "- Roughly 4-7 short sentences. Conversational, second person ('you'). Lead with the reaction to the session. No headers, no bullets, no emojis.",
  "- It's fine to end with a short question about how the session felt — they can reply right there in the chat.",
  "",
  "SAFETY — non-negotiable. You are a PERFORMANCE COACH, not a healthcare provider:",
  "- No medical advice, diagnoses, or supplement/medication guidance.",
  "- If they logged pain, injury, or concerning symptoms, keep it conservative and point them to a qualified professional.",
  "",
  "Never invent data you were not given. Return the review ONLY by calling the workout_review tool.",
].join("\n");

const WORKOUT_REVIEW_TOOL: Anthropic.Tool = {
  name: "workout_review",
  description: "Save the coach's post-workout review for the athlete.",
  input_schema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description:
          "The conversational review the athlete reads in their coach chat: session reaction, prediction verdict (if any), rest-of-day guidance, and the tomorrow-morning prediction woven into natural sentences.",
      },
      next_morning_prediction: {
        type: "string",
        description:
          "The prediction for tomorrow morning as a standalone sentence, specific and verifiable against tomorrow's morning check-in (recovery, soreness, energy, readiness).",
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "Honest confidence in the tomorrow-morning prediction.",
      },
    },
    required: ["message", "next_morning_prediction", "confidence"],
  },
};

/**
 * Generate the coach's post-workout review, given full context whose LATEST
 * CHECK-IN is today's row (now carrying the just-logged training/effort fields)
 * and, when available, the scored result of this morning's prediction.
 */
export async function generateWorkoutReview(
  ctx: CoachContext,
  morningPrediction: MorningPredictionResult | null,
): Promise<WorkoutReview> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const client = new Anthropic({ apiKey });

  const verdictBlock = morningPrediction
    ? [
        "THIS MORNING'S PREDICTION (already scored against today's data — deliver this verdict in your own words):",
        `- Prediction: ${morningPrediction.prediction_text}`,
        `- Scored outcome: ${morningPrediction.outcome}`,
        morningPrediction.notes ? `- Scoring notes: ${morningPrediction.notes}` : null,
      ]
        .filter(Boolean)
        .join("\n")
    : "THIS MORNING'S PREDICTION: none was logged for today — skip the verdict.";

  const contextText = buildContextText(
    ctx,
    `${verdictBlock}\n\nThe athlete just logged the post-workout check-in — it's the today-dated LATEST CHECK-IN above (the training/effort fields). Write your post-workout review now.`,
  );

  const msg = await client.messages.create({
    model: process.env.COACH_MODEL || "claude-sonnet-4-6",
    max_tokens: 900,
    system: `${WORKOUT_REVIEW_SYSTEM_PROMPT}\n\n${contextText}`,
    tools: [WORKOUT_REVIEW_TOOL],
    tool_choice: { type: "tool", name: "workout_review" },
    messages: [{ role: "user", content: "Send me your review of today's session." }],
  });

  const toolUse = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) throw new Error("The coach didn't return a review.");

  const o = (toolUse.input ?? {}) as Record<string, unknown>;
  const confRaw = asString(o.confidence).toLowerCase();
  const review: WorkoutReview = {
    message: asString(o.message),
    next_morning_prediction: asString(o.next_morning_prediction),
    confidence: (CONFIDENCES as string[]).includes(confRaw)
      ? (confRaw as Confidence)
      : "low",
  };
  if (!review.message) throw new Error("The coach didn't have a review.");
  return review;
}
