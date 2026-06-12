// Daily coaching decision draft — generates a structured CoachDraft via Claude.
// Server-only. Requires ANTHROPIC_API_KEY.

import Anthropic from "@anthropic-ai/sdk";
import type { Confidence } from "./types";
import type { CoachDraft, CoachContext } from "./coach-types";
import { buildContextText, asString, CONFIDENCES } from "./coach-context";

const SYSTEM_PROMPT = [
  "You are an elite performance coach writing ONE athlete's daily training decision.",
  "You are drafting for a human head coach who will review, edit, and approve your draft before the athlete sees it. Your job is to save the coach time by getting 90% of the way there with a sharp, specific first draft.",
  "",
  "TIMING — this is critical:",
  "- The data you are given (check-ins, screenshots, logged workouts) are RESULTS from days that have ALREADY happened. The most recent entry is the latest completed day — usually yesterday and last night.",
  "- Your decision is for TODAY, the day being planned. Think of it like reading yesterday's test results to plan today's session.",
  "- So look BACKWARD at the results, then give FORWARD marching orders for today: exactly how to train, fuel, and recover today. Do not simply recap a day that's already over.",
  "",
  "THE BAR — this must feel like 'damn, it gets me':",
  "- Lead with the conclusion. No throat-clearing, no generic wellness advice.",
  "- Be specific and personal to THIS athlete. Reference their actual numbers, trends, notes, sport, goal, and known patterns. If two athletes could receive the same message, it is not good enough.",
  "- Notice the non-obvious: a trend across days, a mismatch (e.g. high reported energy but low recovery), a pattern from their memory notes, a repeat of something a past prediction caught.",
  "- Speak directly to the athlete in second person ('you'). Warm, confident, concise. No emojis. No hedging filler.",
  "- Make the recommendation a single clear call (push / hold / back off) with concrete specifics: intensity, volume, or what to swap.",
  "- Make the prediction about how TODAY will go — specific and verifiable by the end of today (e.g. how the session will feel, what they'll hit, how energy will hold up), so it can be checked against tonight's post-workout check-in.",
  "- Calibrate confidence honestly: 'high' only when the data is consistent and points one way; 'low' when it is sparse, noisy, or conflicting.",
  "",
  "SAFETY — these are non-negotiable. You are a PERFORMANCE COACH, not a healthcare provider:",
  "- Do NOT give medical advice, diagnose, or name/interpret any medical condition.",
  "- Do NOT prescribe, recommend, or adjust supplements, medications, or dosages.",
  "- If the data shows pain, injury, illness, abnormal symptoms, or concerning health signals (e.g. unusual resting HR, sustained poor recovery, a pain/injury note), do not try to train through it: recommend the athlete check in with a qualified professional (doctor, physio, or registered dietitian as appropriate) and keep your training guidance conservative.",
  "- Never claim to detect or rule out a medical issue. Frame everything as performance and training guidance only.",
  "- When in doubt, be conservative and defer to a professional.",
  "",
  "If the athlete has very little data, say so plainly in 'what_noticed', keep the recommendation safe and general, and set confidence to 'low'. Never invent data you were not given.",
  "",
  "THE CHAT MESSAGE — how the athlete actually receives this:",
  "- The structured fields are stored for tracking, but the athlete reads ONE conversational message in their coach chat. Write it in 'chat_message'.",
  "- It should read like their coach texting them after seeing this morning's numbers: what you noticed, the call for today, and your prediction for how today will go — woven into natural sentences, NOT a list and NOT a section-by-section recap of the other fields.",
  "- Keep it tight: roughly 4-7 short sentences. End with your one question for them (the same one as 'athlete_question') so the conversation has somewhere to go.",
  "- Same voice rules: second person, warm, confident, specific to their numbers. No headers, no bullets, no emojis.",
  "",
  "Return your draft ONLY by calling the draft_coach_response tool. Do not write anything outside the tool call.",
].join("\n");

const DRAFT_TOOL: Anthropic.Tool = {
  name: "draft_coach_response",
  description:
    "Save the athlete's daily coaching decision as a structured draft. Every field is shown to the athlete (after the human coach approves it), so write each one in their voice, ready to read.",
  input_schema: {
    type: "object",
    properties: {
      what_noticed: {
        type: "string",
        description:
          "What I noticed: the specific, non-obvious observation from this athlete's data. Concrete and personal.",
      },
      why_it_matters: {
        type: "string",
        description:
          "Why it matters: why that observation matters for their goal today.",
      },
      recommendation: {
        type: "string",
        description:
          "Today's recommendation: a single clear call (push / hold / back off) with concrete specifics.",
      },
      prediction: {
        type: "string",
        description:
          "Prediction for today: a specific call about how today will go (session quality, energy, a number they'll hit) that can be verified against tonight's post-workout check-in.",
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
        description:
          "Confidence level in this decision, honestly calibrated to the quality and consistency of the data.",
      },
      data_used: {
        type: "string",
        description:
          "Data used: a short, plain-language list of the signals this decision is based on (e.g. HRV trend, sleep, soreness, the WHOOP screenshot, their note about work stress).",
      },
      athlete_question: {
        type: "string",
        description:
          "One short question for the athlete that would sharpen tomorrow's decision. A single sentence.",
      },
      chat_message: {
        type: "string",
        description:
          "The conversational message the athlete reads in their coach chat: the observation, today's call, and the prediction for today woven into 4-7 natural sentences, ending with the athlete_question. No lists, headers, or emojis.",
      },
    },
    required: [
      "what_noticed",
      "why_it_matters",
      "recommendation",
      "prediction",
      "confidence",
      "data_used",
      "athlete_question",
      "chat_message",
    ],
  },
};

function validate(input: unknown): CoachDraft {
  const o = (input ?? {}) as Record<string, unknown>;
  const confRaw = asString(o.confidence).toLowerCase();
  const confidence: Confidence = (CONFIDENCES as string[]).includes(confRaw)
    ? (confRaw as Confidence)
    : "low";

  const draft: CoachDraft = {
    what_noticed: asString(o.what_noticed),
    why_it_matters: asString(o.why_it_matters),
    recommendation: asString(o.recommendation),
    prediction: asString(o.prediction),
    confidence,
    data_used: asString(o.data_used),
    athlete_question: asString(o.athlete_question),
    chat_message: asString(o.chat_message),
  };

  if (!draft.what_noticed && !draft.recommendation) {
    throw new Error("Model returned an empty draft.");
  }
  return draft;
}

/**
 * Generate a daily coaching decision draft for one athlete using Claude.
 * Throws on a missing key or an unusable model response.
 */
export async function generateCoachDraft(ctx: CoachContext): Promise<CoachDraft> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const client = new Anthropic({ apiKey });

  const msg = await client.messages.create({
    model: process.env.COACH_MODEL || "claude-sonnet-4-6",
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    tools: [DRAFT_TOOL],
    tool_choice: { type: "tool", name: "draft_coach_response" },
    messages: [{ role: "user", content: buildContextText(ctx) }],
  });

  const toolUse = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("Model did not return a structured draft. Try regenerating.");
  }

  return validate(toolUse.input);
}
