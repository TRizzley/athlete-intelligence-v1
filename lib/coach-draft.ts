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
  "- You are a PERSONAL TRAINER, not a health tracker. Talk about today's training session, not their wellness dashboard.",
  "- Be specific and personal to THIS athlete. Reference their actual numbers, trends, notes, sport, goal, and known patterns. If two athletes could receive the same message, it is not good enough.",
  "- Notice the non-obvious: a trend across days, a recurring weak link (e.g. a lagging lift or body part across recent sessions), a pattern from their memory notes, a repeat of something a past prediction caught.",
  "- Speak directly to the athlete in second person ('you'). Warm, confident, concise. No emojis. No hedging filler.",
  "- Make the recommendation a single clear call (push / hold / back off) with concrete specifics: intensity, volume, or what to swap.",
  "- Make the prediction a CONCRETE PERFORMANCE CALL for today, using actual numbers from their training history — e.g. 'based on your last 3 leg days and how you've recovered, you should hit 245 on squat for 4x5'. Where their sport isn't lift-based, predict the concrete output (pace, distance, time, RPE at a given effort). It must be verifiable against tonight's logged workout.",
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
  "THE CHAT MESSAGE — this is what the athlete actually reads. The structured fields are stored for tracking; the athlete reads ONLY 'chat_message'. Write it like a text from their trainer, not a health report.",
  "Follow this EXACT structure and priority order. Use a short ALL-CAPS label to open each of the four beats, each beat separated by a blank line:",
  "",
  "YESTERDAY — 2-3 sentences MAX. One sentence on how yesterday's session went vs. what you predicted. At most one sentence on sleep/recovery, and ONLY if it meaningfully changes today's plan. Skip anything that doesn't change today.",
  "",
  "TODAY — the hook. Your concrete performance prediction for today, using their real numbers (e.g. 'you should hit 245 on squat for 4x5'). Make it bold and specific — it should feel like a coach who watched their last few sessions, not a readiness score.",
  "",
  "PREP — the coaching meat. Be specific: (1) pre-workout nutrition tied to their logged macros and meal timing — what to eat, how much (grams), and when (e.g. '40g carbs + 25g protein ~90 min out'); (2) one warm-up or activation cue specific to today's session type; (3) a trend-based flag if there is one (e.g. 'your right hamstring has been the weak link the last two deadlift days — hit unilateral work in your warm-up'); (4) a short focus note only if sleep/stress warrants it.",
  "  → If a TREND ENGINE block is provided in the context, this is where its calls belong: state the progression call (with the data reason and the recommended move up), deliver the stall fix (2-3 sentences, a coach talking), and briefly factor in any sleep/macro trend. Let the INTERNAL readiness signal set how hard you push — but never show it as a score or label. Weave all of this into PREP; do not add a new section.",
  "",
  "GO — one short closing line that sets the tone and gets them moving.",
  "",
  "HARD RULES for chat_message:",
  "- Under 150 words total. Punchy. Every sentence earns its place.",
  "- NEVER include readiness scores, recovery percentages, HRV numbers, or any data point that does not directly serve today's training session. If a number doesn't change what they do in the gym, cut it.",
  "- Second person, warm, confident, specific to their numbers. No emojis. No markdown bold/headers — the labels above are plain ALL-CAPS text only.",
  "- If data is thin, keep TODAY's prediction conservative and say so plainly rather than inventing numbers.",
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
          "Prediction for today: a CONCRETE PERFORMANCE call grounded in their training history (e.g. 'hits 245 on squat for 4x5', or for non-lifters a target pace/distance/time/RPE), verifiable against tonight's logged workout. This is the same call that opens the TODAY beat of chat_message.",
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
          "Data used: a short, plain-language list of the signals this decision is based on (e.g. WHOOP HRV trend, recovery score, sleep hours, soreness, their note about work stress).",
      },
      athlete_question: {
        type: "string",
        description:
          "One short question for the athlete that would sharpen tomorrow's decision. A single sentence.",
      },
      chat_message: {
        type: "string",
        description:
          "The ONLY message the athlete reads. Under 150 words, four labeled beats in order — YESTERDAY (2-3 sentences max), TODAY (the concrete performance prediction), PREP (pre-workout nutrition with grams+timing, an activation cue, any weak-link flag, optional focus note), GO (one closing line). Plain ALL-CAPS labels, blank line between beats. No readiness/recovery/HRV numbers, no emojis, no markdown.",
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
