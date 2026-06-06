// ----------------------------------------------------------------------------
// AI coach-response drafting via Claude.
//
// Given everything we know about an athlete (profile, check-ins, screenshots,
// memory, past responses, predictions + outcomes, and feedback), asks Claude to
// draft ONE daily coaching decision in the exact 7-part structure the app uses.
//
// This produces a DRAFT only. A human coach reviews, edits, and approves it in
// the admin before the athlete ever sees it — nothing here is sent automatically.
//
// Server-only. Requires ANTHROPIC_API_KEY. Mirrors the calling style of
// lib/ocr.ts so there is one consistent way this codebase talks to Claude.
// ----------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import type {
  AthleteProfile,
  DailyCheckin,
  UploadedScreenshot,
  CoachResponse,
  PredictionWithOutcome,
  PredictionOutcome,
  UserFeedback,
  AthleteMemoryNote,
  Confidence,
} from "./types";

// The structured draft the model must return — one field per section the
// athlete-facing card renders.
export interface CoachDraft {
  what_noticed: string;
  why_it_matters: string;
  recommendation: string;
  prediction: string;
  confidence: Confidence;
  data_used: string;
  athlete_question: string;
}

// Everything we feed the model. Mirrors what the admin review page already loads.
export interface CoachContext {
  athleteName: string | null;
  today: string; // YYYY-MM-DD the decision is for
  profile: AthleteProfile | null;
  latestCheckin: DailyCheckin | null;
  recentCheckins: DailyCheckin[]; // last ~7 days, newest first
  screenshots: UploadedScreenshot[]; // recent uploads (with any OCR'd values)
  memoryNotes: AthleteMemoryNote[];
  previousResponses: CoachResponse[]; // newest first
  predictions: PredictionWithOutcome[];
  feedback: UserFeedback[];
}

// ----------------------------------------------------------------------------
// System prompt: who the coach is, the bar for quality, the structure, and the
// non-negotiable safety rules.
// ----------------------------------------------------------------------------
const SYSTEM_PROMPT = [
  "You are an elite performance coach writing ONE athlete's daily training decision.",
  "You are drafting for a human head coach who will review, edit, and approve your draft before the athlete sees it. Your job is to save the coach time by getting 90% of the way there with a sharp, specific first draft.",
  "",
  "THE BAR — this must feel like 'damn, it gets me':",
  "- Lead with the conclusion. No throat-clearing, no generic wellness advice.",
  "- Be specific and personal to THIS athlete. Reference their actual numbers, trends, notes, sport, goal, and known patterns. If two athletes could receive the same message, it is not good enough.",
  "- Notice the non-obvious: a trend across days, a mismatch (e.g. high reported energy but low recovery), a pattern from their memory notes, a repeat of something a past prediction caught.",
  "- Speak directly to the athlete in second person ('you'). Warm, confident, concise. No emojis. No hedging filler.",
  "- Make the recommendation a single clear call (push / hold / back off) with concrete specifics: intensity, volume, or what to swap.",
  "- Make the prediction specific and verifiable tomorrow, so its accuracy can be scored.",
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
  "Return your draft ONLY by calling the draft_coach_response tool. Do not write anything outside the tool call.",
].join("\n");

// ----------------------------------------------------------------------------
// Tool definition: forces the model to return exactly the 7 structured fields.
// ----------------------------------------------------------------------------
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
          "Prediction for tomorrow: a specific, verifiable call they can check tomorrow.",
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
    },
    required: [
      "what_noticed",
      "why_it_matters",
      "recommendation",
      "prediction",
      "confidence",
      "data_used",
      "athlete_question",
    ],
  },
};

// ----------------------------------------------------------------------------
// Context serialization — turn the athlete's data into a compact, labeled brief.
// ----------------------------------------------------------------------------

// Drop null/empty keys so the model isn't fed a wall of "null".
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

function checkinBrief(c: DailyCheckin): Record<string, unknown> {
  return compact({
    date: c.checkin_date,
    sleep_hours: c.sleep_hours,
    sleep_quality_1to10: c.sleep_quality,
    recovery_score_0to100: c.recovery_score,
    hrv_ms: c.hrv_ms,
    resting_hr: c.resting_hr,
    body_weight_lbs: c.body_weight_lbs,
    calories: c.calories,
    protein_g: c.protein_g,
    carbs_g: c.carbs_g,
    fat_g: c.fat_g,
    water_oz: c.water_oz,
    workout_completed: c.workout_completed,
    workout_type: c.workout_type,
    workout_intensity_1to10: c.workout_intensity,
    soreness_1to10: c.soreness,
    energy_1to10: c.energy,
    mood_1to10: c.mood,
    stress_1to10: c.stress,
    motivation_1to10: c.motivation,
    pain_injury_note: c.pain_injury_note,
    open_comments: c.open_comments,
  });
}

function firstOutcome(p: PredictionWithOutcome): PredictionOutcome | null {
  const po = p.prediction_outcomes;
  if (!po) return null;
  return Array.isArray(po) ? po[0] ?? null : po;
}

function buildContextText(ctx: CoachContext): string {
  const parts: string[] = [];

  parts.push(
    `You are drafting the daily decision for ${ctx.athleteName ?? "this athlete"}, dated ${ctx.today}.`,
  );

  // Profile
  if (ctx.profile) {
    parts.push(
      "ATHLETE PROFILE:\n" +
        JSON.stringify(
          compact({
            age: ctx.profile.age,
            sex: ctx.profile.sex,
            height_in: ctx.profile.height_in,
            body_weight_lbs: ctx.profile.body_weight_lbs,
            primary_sport: ctx.profile.primary_sport,
            primary_goal: ctx.profile.primary_goal,
            goal_detail: ctx.profile.goal_detail,
            training_age: ctx.profile.training_age,
            experience_mode: ctx.profile.experience_mode,
            training_days_per_week: ctx.profile.training_days_per_week,
            current_program: ctx.profile.current_program,
            devices: ctx.profile.devices,
            nutrition_app: ctx.profile.nutrition_app,
            injuries: ctx.profile.injuries,
            notes: ctx.profile.notes,
          }),
          null,
          2,
        ),
    );
  } else {
    parts.push("ATHLETE PROFILE: (not completed yet)");
  }

  // Latest check-in
  if (ctx.latestCheckin) {
    parts.push(
      "LATEST CHECK-IN:\n" + JSON.stringify(checkinBrief(ctx.latestCheckin), null, 2),
    );
  } else {
    parts.push("LATEST CHECK-IN: (none logged yet)");
  }

  // 7-day history (excluding the latest, which is shown above)
  const history = ctx.recentCheckins.filter(
    (c) => c.id !== ctx.latestCheckin?.id,
  );
  if (history.length > 0) {
    parts.push(
      "RECENT CHECK-IN HISTORY (most recent first):\n" +
        JSON.stringify(history.map(checkinBrief), null, 2),
    );
  }

  // Screenshots (file references + any OCR-extracted values)
  if (ctx.screenshots.length > 0) {
    const shots = ctx.screenshots.map((s) =>
      compact({
        source: s.source,
        file_name: s.file_name,
        capture_date: s.capture_date,
        note: s.note,
        extracted_values: s.parsed_json ?? undefined,
      }),
    );
    parts.push(
      "UPLOADED SCREENSHOTS (wearable / nutrition app exports; extracted_values are OCR-read numbers already folded into the check-ins above):\n" +
        JSON.stringify(shots, null, 2),
    );
  }

  // Coach memory notes
  if (ctx.memoryNotes.length > 0) {
    parts.push(
      "COACH MEMORY NOTES (private patterns & context about this athlete):\n" +
        ctx.memoryNotes
          .map((n) => `- ${n.category ? `[${n.category}] ` : ""}${n.note}`)
          .join("\n"),
    );
  }

  // Previous coach responses (sent ones are what the athlete has seen)
  if (ctx.previousResponses.length > 0) {
    const recent = ctx.previousResponses.slice(0, 5).map((r) =>
      compact({
        date: r.response_date,
        status: r.status,
        what_noticed: r.what_noticed,
        recommendation: r.recommendation,
        prediction: r.prediction,
        confidence: r.confidence,
      }),
    );
    parts.push(
      "PREVIOUS COACH RESPONSES (most recent first — keep continuity, avoid repeating yourself, and follow up on open threads):\n" +
        JSON.stringify(recent, null, 2),
    );
  }

  // Predictions + outcomes (track record)
  if (ctx.predictions.length > 0) {
    const preds = ctx.predictions.slice(0, 8).map((p) => {
      const o = firstOutcome(p);
      return compact({
        date: p.created_at?.slice(0, 10),
        prediction: p.prediction_text,
        horizon: p.horizon,
        confidence: p.confidence,
        outcome: o?.outcome,
        outcome_notes: o?.notes,
      });
    });
    parts.push(
      "PAST PREDICTIONS & OUTCOMES (your track record with this athlete — learn from what came true vs missed):\n" +
        JSON.stringify(preds, null, 2),
    );
  }

  // Feedback history (what lands with this athlete)
  if (ctx.feedback.length > 0) {
    const fb = ctx.feedback.slice(0, 8).map((f) =>
      compact({
        felt_accurate: f.felt_accurate,
        felt_personalized: f.felt_personalized,
        was_useful: f.was_useful,
        prediction_came_true: f.prediction_came_true,
        would_pay: f.would_pay,
        comment: f.free_text,
      }),
    );
    parts.push(
      "ATHLETE FEEDBACK ON PAST RESPONSES (what resonates with them — lean into what they found accurate, personal, and useful):\n" +
        JSON.stringify(fb, null, 2),
    );
  }

  parts.push(
    "Now draft today's decision by calling draft_coach_response. Make it specific to the data above and worthy of the 'damn, it gets me' bar.",
  );

  return parts.join("\n\n");
}

// ----------------------------------------------------------------------------
// Validation: coerce the tool input into a clean CoachDraft.
// ----------------------------------------------------------------------------
const CONFIDENCES: Confidence[] = ["low", "medium", "high"];

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

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
  };

  // The recommendation is the hero of the card — refuse a blank one.
  if (!draft.what_noticed && !draft.recommendation) {
    throw new Error("Model returned an empty draft.");
  }
  return draft;
}

/**
 * Generate a daily coaching decision draft for one athlete using Claude.
 * Throws on a missing key or an unusable model response so the API route can
 * surface a clear error to the admin.
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
