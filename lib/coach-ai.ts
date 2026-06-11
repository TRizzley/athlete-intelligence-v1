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

// A compact view of one logged workout session for the model.
export interface WorkoutLogBrief {
  session_date: string;
  day_name: string | null;
  notes?: string | null;
  sets: {
    exercise: string;
    muscle?: string | null;
    set: number;
    weight: number | null;
    reps: number | null;
  }[];
}

// Where the athlete is in their program. Gives the AI temporal context it
// otherwise lacks — a Day 5 recommendation is very different from Day 47.
export interface ProgramContext {
  dayNumber: number;     // calendar days since first check-in (1-indexed)
  programWeek: number;   // ceil(dayNumber / 7)
  totalCheckins: number; // how many check-ins have been logged so far
  firstCheckinDate: string; // YYYY-MM-DD of their very first check-in
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
  recentWorkouts?: WorkoutLogBrief[]; // logged sessions w/ per-set weight+reps
  recentMessages?: ChatTurn[]; // recent coach<->athlete chat (oldest first)
  programContext?: ProgramContext; // where they are in the program (optional — absent for brand-new athletes)
}

// ----------------------------------------------------------------------------
// System prompt: who the coach is, the bar for quality, the structure, and the
// non-negotiable safety rules.
// ----------------------------------------------------------------------------
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
    bed_time: c.bed_time,
    wake_time: c.wake_time,
    workout_completed: c.workout_completed,
    workout_types: c.workout_types,
    workout_type: c.workout_type,
    workout_split: c.workout_split,
    training_load: c.training_load,
    top_set_lbs: c.top_set_lbs,
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

// Turn recent feedback into explicit, prioritized calibration directives so the
// next decision actually adapts to what the athlete said fell short — instead of
// the model just seeing a flat dump of ratings.
//
// Sample guard: we need at least 3 feedback entries before firing directives.
// Below that threshold, a single "somewhat" would otherwise trigger a full
// override, which over-corrects on noise and makes the coach unstable early on.
//
// Weighting: "no" counts 2× vs "somewhat" so a clear miss is treated more
// urgently than a mild dissatisfaction.
function feedbackCalibration(feedback: UserFeedback[]): string | null {
  const recent = feedback.slice(0, 6); // newest first
  // Require a minimum sample before we trust the signal enough to act on it.
  if (recent.length < 3) return null;

  // Weighted score: "no" = 2 points, "somewhat" = 1 point.
  const weightedScore = (key: keyof UserFeedback) =>
    recent.reduce((sum, f) => {
      if (f[key] === "no") return sum + 2;
      if (f[key] === "somewhat") return sum + 1;
      return sum;
    }, 0);
  // Threshold: fire a directive when weighted score >= half the max possible
  // (i.e., average "somewhat" or worse across the window).
  const threshold = recent.length; // max is 2×n (all "no"), threshold at n
  const weak = (key: keyof UserFeedback) => weightedScore(key) >= threshold;

  const directives: string[] = [];

  if (weak("felt_personalized")) {
    directives.push(
      "PERSONALIZATION IS THE #1 FIX: recent feedback says the coaching does not feel personalized. Open with something only THIS athlete would recognize — a specific number or trend from their data, a memory note, a stated preference, or a callback to a past prediction. Delete any sentence that could be sent verbatim to a different athlete.",
    );
  }
  if (weak("felt_accurate")) {
    directives.push(
      "ACCURACY: recent feedback questions accuracy. Anchor every claim to a specific datum, and when signals conflict or data is thin, lower your confidence and name what you are unsure about rather than overstating.",
    );
  }
  if (weak("was_useful")) {
    directives.push(
      "USEFULNESS: recent feedback says responses are not useful enough. Make the recommendation a concrete action for today with numbers (sets, intensity, calories, bedtime) — not a general principle.",
    );
  }

  // The athlete's own most recent words are the richest signal — address them.
  const latestComment = recent
    .find((f) => f.free_text && f.free_text.trim())
    ?.free_text?.trim();
  if (latestComment) {
    directives.push(
      `ADDRESS THE ATHLETE'S OWN WORDS from recent feedback: "${latestComment}"`,
    );
  }

  if (directives.length === 0) return null;
  return (
    "FEEDBACK CALIBRATION (act on this — it overrides habit):\n- " +
    directives.join("\n- ")
  );
}

function buildContextText(ctx: CoachContext, closing?: string): string {
  const parts: string[] = [];

  // Program context header — where the athlete is in their journey.
  if (ctx.programContext) {
    const pc = ctx.programContext;
    const weekLabel = `Week ${pc.programWeek}`;
    const dayLabel = `Day ${pc.dayNumber}`;
    parts.push(
      `Today is ${ctx.today} — the day you are planning for ${ctx.athleteName ?? "this athlete"}. ` +
        `PROGRAM POSITION: ${dayLabel} (${weekLabel}) — ${pc.totalCheckins} check-in${pc.totalCheckins === 1 ? "" : "s"} logged since ${pc.firstCheckinDate}. ` +
        `Let the stage of the program inform your coaching: early weeks (1–3) should emphasize habit-building and baseline-setting, not max intensity; ` +
        `mid-program (weeks 4–8) is where you push progression; later blocks should account for accumulated fatigue and adaptation. ` +
        `Everything below is RESULTS from days that have already happened; the most recent check-in is the latest completed day (usually yesterday/last night). ` +
        `Read those results, then tell the athlete exactly how to train, fuel, and recover TODAY.`,
    );
  } else {
    parts.push(
      `Today is ${ctx.today} — the day you are planning for ${ctx.athleteName ?? "this athlete"}. ` +
        `Everything below is RESULTS from days that have already happened; the most recent check-in is the latest completed day (usually yesterday/last night). ` +
        `Read those results, then tell the athlete exactly how to train, fuel, and recover TODAY.`,
    );
  }

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
            coaching_tone: ctx.profile.coaching_tone,
            fatigue_tendency: ctx.profile.fatigue_tendency,
            motivation: ctx.profile.motivation,
            coaching_wants: ctx.profile.coaching_wants,
            life_context: ctx.profile.life_context,
            background: ctx.profile.background,
          }),
          null,
          2,
        ) +
        "\nHONOR THE ATHLETE'S STATED COACHING PREFERENCES: match coaching_tone (e.g. tough_love vs supportive) in how you speak; use fatigue_tendency to anticipate whether they over-push or back off; speak to their motivation and coaching_wants; ground specifics in their background and life_context. Especially in the first week — before there is much data — these preferences are your main source of personalization.",
    );
  } else {
    parts.push("ATHLETE PROFILE: (not completed yet)");
  }

  // Latest check-in (the most recent completed-day results to plan today from)
  if (ctx.latestCheckin) {
    parts.push(
      "LATEST CHECK-IN (most recent completed-day results — plan today from this):\n" +
        JSON.stringify(checkinBrief(ctx.latestCheckin), null, 2),
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
          .map(
            (n) =>
              `- ${n.category ? `[${n.category}] ` : ""}${n.note.replace(/^\[fb:[^\]]+\]\s*/, "")}`,
          )
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

  // Recent chat — what the athlete told you or asked between daily decisions.
  if (ctx.recentMessages && ctx.recentMessages.length > 0) {
    parts.push(
      "RECENT CHAT WITH THIS ATHLETE (most recent last — preferences they stated, context they shared, and open questions; honor what they told you and let it shape today's plan):\n" +
        ctx.recentMessages
          .map((m) => `${m.role === "athlete" ? "Athlete" : "Coach"}: ${m.body}`)
          .join("\n"),
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

  // Logged workouts (per-set weight + reps — the athlete's actual training load)
  if (ctx.recentWorkouts && ctx.recentWorkouts.length > 0) {
    const workouts = ctx.recentWorkouts.map((w) =>
      compact({
        date: w.session_date,
        day: w.day_name,
        notes: w.notes,
        sets: w.sets.map((s) =>
          compact({
            exercise: s.exercise,
            muscle: s.muscle,
            set: s.set,
            weight_lbs: s.weight,
            reps: s.reps,
          }),
        ),
      }),
    );
    parts.push(
      "LOGGED WORKOUTS (most recent first — actual weights and reps per set; use these to judge progression, fatigue, and whether load is moving the right way):\n" +
        JSON.stringify(workouts, null, 2),
    );
  }

  // Calibration from feedback goes LAST so it's the freshest instruction in mind.
  const calibration = feedbackCalibration(ctx.feedback);
  if (calibration) parts.push(calibration);

  parts.push(
    closing ??
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

// ----------------------------------------------------------------------------
// Conversational chat reply — the athlete can message the coach any time.
// ----------------------------------------------------------------------------

export interface ChatTurn {
  role: "athlete" | "coach";
  body: string;
}

const CHAT_SYSTEM_PROMPT = [
  "You are the athlete's personal performance coach, replying in an ongoing chat.",
  "You have full context on this athlete (profile, recent check-ins, screenshots, logged workouts, past coaching decisions, predictions, and feedback) — it is provided below. Use it: reference their actual numbers, trends, sport, goal, and known patterns so every reply feels personal.",
  "",
  "STYLE:",
  "- Talk like a sharp, warm human coach texting back. Conversational and concise — usually 1-4 sentences. No corporate tone, no bullet-point essays unless they ask for a plan.",
  "- Lead with the answer. Be specific and direct. Ask a follow-up question only when it genuinely helps.",
  "- Speak in second person ('you'). No emojis unless they use them first.",
  "",
  "SAFETY — non-negotiable. You are a PERFORMANCE COACH, not a healthcare provider:",
  "- Do NOT give medical advice, diagnose, or interpret medical conditions.",
  "- Do NOT prescribe or adjust supplements, medications, or dosages.",
  "- If they describe pain, injury, illness, or concerning symptoms, keep training guidance conservative and point them to a qualified professional (doctor, physio, or dietitian).",
  "- When unsure, be conservative and defer to a professional.",
  "",
  "If you don't have enough data to answer well, say so plainly and ask for what you'd need. Never invent data.",
].join("\n");

/**
 * Generate the coach's conversational reply to the athlete's latest message,
 * given full athlete context and the recent conversation history.
 */
export async function generateCoachChatReply(
  ctx: CoachContext,
  history: ChatTurn[],
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const client = new Anthropic({ apiKey });

  const contextText = buildContextText(
    ctx,
    "That is everything you know about this athlete. Reply to their messages as their coach.",
  );

  // Athlete context lives in the system prompt; the messages array is just the
  // real conversation (athlete -> user, coach -> assistant). No assistant
  // prefill, and we guard the two hard API rules: the conversation must START
  // with a user message and END with a user message.
  const mapped: Anthropic.MessageParam[] = history.map((t) => ({
    role: (t.role === "athlete" ? "user" : "assistant") as "user" | "assistant",
    content: t.body,
  }));

  // Coalesce consecutive same-role turns. The API requires strictly alternating
  // user/assistant roles; if a prior coach reply failed, the DB can hold two
  // athlete messages in a row, which would otherwise be rejected.
  const messages: Anthropic.MessageParam[] = [];
  for (const m of mapped) {
    const last = messages[messages.length - 1];
    if (last && last.role === m.role && typeof last.content === "string") {
      last.content = `${last.content}\n\n${m.content as string}`;
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }

  // Drop any leading coach turns (window can start mid-thread on an assistant).
  while (messages.length > 0 && messages[0].role !== "user") messages.shift();
  // Ensure there is a trailing user message for the model to respond to.
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    messages.push({ role: "user", content: "(Please reply to my latest message.)" });
  }

  const msg = await client.messages.create({
    model: process.env.COACH_MODEL || "claude-sonnet-4-6",
    max_tokens: 700,
    system: `${CHAT_SYSTEM_PROMPT}\n\n${contextText}`,
    messages,
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!text) throw new Error("The coach didn't have a reply. Try again.");
  return text;
}

// ----------------------------------------------------------------------------
// Post-workout acknowledgment — a short coach note right after the athlete logs
// their session. This is NOT a new daily decision: the morning decision stays
// frozen. It's a brief, encouraging reaction that lands in the coach chat and
// gives one concrete recover/refuel cue for the rest of today.
// ----------------------------------------------------------------------------

const POST_WORKOUT_ACK_SYSTEM_PROMPT = [
  "You are the athlete's personal performance coach. They just finished training and logged a post-workout check-in. Send ONE short, warm acknowledgment — like a coach texting right after the session.",
  "",
  "WHAT TO DO:",
  "- React to the session they just logged (today's training fields in the latest check-in): what they trained, how hard (intensity/RPE), their key lifts or top set, and how it lines up with the plan and prediction you made for them this morning.",
  "- Give ONE concrete thing to do for the rest of today to recover or refuel, specific to their data (e.g. a protein/calorie target to hit, hydration, an earlier bedtime, easy mobility).",
  "- Be genuinely encouraging but honest. If they coasted through what should've been a hard day, or hammered it against a low-recovery morning, name it kindly.",
  "",
  "STYLE:",
  "- 2-4 sentences. Conversational, second person ('you'). Lead with the reaction to their session. No emojis unless they use them. No bullet lists.",
  "- This is a one-way note in their chat — don't ask a question that needs an answer to make sense (a light rhetorical nudge is fine).",
  "",
  "SAFETY — non-negotiable. You are a PERFORMANCE COACH, not a healthcare provider:",
  "- No medical advice, diagnoses, or supplement/medication guidance.",
  "- If they logged pain, injury, or concerning symptoms, keep it conservative and point them to a qualified professional.",
  "",
  "Never invent data you were not given. Write ONLY the message text — nothing else.",
].join("\n");

/**
 * Generate the coach's short post-workout acknowledgment for the athlete, given
 * full context whose LATEST CHECK-IN is today's row (now carrying the just-logged
 * training/effort fields). Returns the message text to post into the coach chat.
 */
export async function generatePostWorkoutAck(ctx: CoachContext): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const client = new Anthropic({ apiKey });

  const contextText = buildContextText(
    ctx,
    "The athlete just logged the post-workout check-in — it's the today-dated LATEST CHECK-IN above (the training/effort fields). Write your short post-workout acknowledgment now, reacting to that session.",
  );

  const msg = await client.messages.create({
    model: process.env.COACH_MODEL || "claude-sonnet-4-6",
    max_tokens: 400,
    system: `${POST_WORKOUT_ACK_SYSTEM_PROMPT}\n\n${contextText}`,
    messages: [{ role: "user", content: "Send me your post-workout note." }],
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!text) throw new Error("The coach didn't have a post-workout note.");
  return text;
}

// ----------------------------------------------------------------------------
// Milestone analytical reports — three-tier system.
//
// Day 7  ("First Week"): Brief pattern note, 3-4 sentences. Signals are thin
//         but a quick observation validates the habit early and builds trust.
//
// Day 21 ("Phase 1"):   The original deep report. Full pattern analysis across
//         the first training block. The "whoa, I didn't realize that" moment.
//
// Day 42 ("Phase 2"):   Longitudinal analysis comparing Phase 1 vs Phase 2.
//         Has the intervention worked? What's trending? What needs adjusting?
//         More sophisticated — the coach can reference the Day-21 report.
//
// All three land in the coach chat. Timing is controlled in the cron route.
// ----------------------------------------------------------------------------

export type MilestoneTier = 7 | 21 | 42;

const MILESTONE_SYSTEM_PROMPTS: Record<MilestoneTier, string> = {
  7: [
    "You are the athlete's performance coach. They've just completed their first week of tracking. Send them ONE brief observation — a first-week pattern note that lands in chat.",
    "",
    "YOUR JOB — find ONE early signal worth naming:",
    "- Look at the 7 days of data. What's the clearest, most specific thing you can already see? It might be a consistency strength, an early trend (e.g. recovery climbing or sliding), a pattern in how they respond to training, or a data gap worth flagging.",
    "- Be honest about confidence: one week is thin. Frame it as 'here's what I'm already noticing' not 'here's the definitive pattern'. Early observations carry low-moderate confidence.",
    "- Name one specific thing they can do in week 2 based on this observation.",
    "- End with a short, genuine note that acknowledges the work of building the habit.",
    "",
    "STYLE:",
    "- 3-4 sentences, 60-90 words. Warm, direct, second person. No bullet lists, no headers, no emojis. Conversational — like a coach texting at the end of week one.",
    "- Never invent a pattern. If the data is too thin to say anything specific, acknowledge that briefly and ask one question that would sharpen week 2.",
    "",
    "SAFETY — you are a PERFORMANCE COACH, not a healthcare provider: no medical advice, diagnoses, or supplement/medication guidance.",
    "",
    "Write ONLY the message text — nothing else.",
  ].join("\n"),

  21: [
    "You are the athlete's performance coach. They've completed their first three weeks. Write them a short, standalone report that makes them go 'whoa, I didn't realize that.'",
    "",
    "YOUR JOB — find the non-obvious:",
    "- Analyze the WHOLE window (check-ins, recovery/sleep/HRV, training, nutrition, logged workouts, subjective feel). Look for a real pattern or relationship they probably can't see themselves.",
    "- Examples of insights to hunt for (only if data supports it): a lag effect (recovery dips the day AFTER a specific training type), a threshold (energy craters when sleep drops below X), a mismatch (high motivation but hardest sessions fall on low-recovery days), a trend (HRV climbing over three weeks), a nutrition link (low-protein days precede worse next-day sessions).",
    "- Lead with the single most interesting, specific finding. Cite their actual numbers and dates/days to prove it — this must be clearly about THEM.",
    "- Give ONE concrete thing to do with that insight over the next few weeks.",
    "- End with a brief, genuine note of encouragement about their consistency or progress.",
    "",
    "STYLE:",
    "- 150-220 words. Warm, sharp, second person. Plain language — like a smart coach texting, not a statistics report. No bullet lists, no headers, no emojis.",
    "- Be honest about confidence: if data is thin or noisy, say the pattern is early and worth watching rather than overstating it. Never invent a pattern.",
    "",
    "SAFETY — you are a PERFORMANCE COACH, not a healthcare provider: no medical advice, diagnoses, or supplement/medication guidance.",
    "",
    "Write ONLY the message text — nothing else.",
  ].join("\n"),

  42: [
    "You are the athlete's performance coach. They've just passed the six-week mark — two full training blocks. Write a Phase 2 analysis report.",
    "",
    "YOUR JOB — longitudinal comparison and adaptation check:",
    "- Compare Phase 1 (first 3 weeks) vs Phase 2 (weeks 4-6). What has actually changed? What's trending in the right direction? What's stalled or regressed?",
    "- Look for adaptation signatures: is performance going up (weights, recovery scores, HRV trend)? Is fatigue accumulating faster than they can recover? Are their subjective scores drifting from objective wearable data?",
    "- The standard at 6 weeks is higher than at 3: you have enough data to identify genuine trends, not just early patterns. Lead with the most important insight — the thing that should directly change how they train or recover in weeks 7+.",
    "- Name ONE specific adjustment for the next training block based on the full 6-week picture.",
    "- Close with a genuine observation about what they've built — consistency, progression, behavioral change — that's earned, not generic.",
    "",
    "STYLE:",
    "- 200-270 words. Precise, warm, second person. No bullet lists, no headers, no emojis. Reference specific numbers and dates.",
    "- Be honest about what the data does and doesn't show. Never invent a trend.",
    "",
    "SAFETY — you are a PERFORMANCE COACH, not a healthcare provider: no medical advice, diagnoses, or supplement/medication guidance.",
    "",
    "Write ONLY the message text — nothing else.",
  ].join("\n"),
};

const MILESTONE_CLOSING: Record<MilestoneTier, string> = {
  7: "That's the first 7 days. Identify the clearest early signal and write the first-week note now.",
  21: "Everything above is this athlete's first ~3 weeks. Study the whole window, find the most interesting non-obvious pattern, and write their Phase 1 report now.",
  42: "Everything above covers this athlete's full 6 weeks across two training blocks. Compare the two phases, identify the most important trend, and write their Phase 2 analysis now.",
};

/**
 * Generate a milestone analytical report for an athlete.
 *
 * tier  = 7  → brief first-week note (fires ~day 7, min 5 check-ins)
 * tier  = 21 → phase-1 deep report   (fires ~day 21, min 12 check-ins)
 * tier  = 42 → phase-2 longitudinal  (fires ~day 42, min 25 check-ins)
 *
 * ctx.recentCheckins should carry the full available window (newest first).
 */
export async function generateMilestoneReport(
  ctx: CoachContext,
  tier: MilestoneTier = 21,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const client = new Anthropic({ apiKey });

  const contextText = buildContextText(ctx, MILESTONE_CLOSING[tier]);
  const systemPrompt = MILESTONE_SYSTEM_PROMPTS[tier];
  const maxTok = tier === 7 ? 300 : tier === 21 ? 700 : 900;

  const msg = await client.messages.create({
    model: process.env.COACH_MODEL || "claude-sonnet-4-6",
    max_tokens: maxTok,
    system: `${systemPrompt}\n\n${contextText}`,
    messages: [{ role: "user", content: "Send me my milestone report." }],
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!text) throw new Error(`Milestone tier-${tier} report returned empty.`);
  return text;
}

// ----------------------------------------------------------------------------
// Memory distillation — turn a chat conversation into durable athlete notes.
//
// After a chat exchange, this reads the conversation (plus the notes we already
// have, to avoid duplicates) and extracts only the LASTING facts worth carrying
// into future coaching: preferences, constraints, history, recurring patterns,
// goals, and communication style. Transient state (today's soreness, "I'm tired
// right now") is deliberately ignored — that already lives in the check-ins.
//
// Returns the NEW notes to insert. Empty array means "nothing new worth saving".
// Uses a small, cheap model; never throws fatally — callers treat failure as
// "no new notes" so chat is never blocked on this.
// ----------------------------------------------------------------------------

export interface DistilledNote {
  category: string | null; // e.g. "preference", "history", "pattern", "goal", "constraint", "style"
  note: string;
}

const DISTILL_SYSTEM_PROMPT = [
  "You maintain a performance coach's private long-term memory about ONE athlete.",
  "You are given the notes already on file and a recent chat between the coach and the athlete.",
  "Extract ONLY new, durable facts worth remembering for future coaching sessions — things that will still be true next week:",
  "- preferences (how they like to train, be coached, communicate)",
  "- constraints (schedule, equipment, recurring injuries, dietary limits)",
  "- history & context (past PRs, life events, work/school stressors, sport background)",
  "- stable patterns (e.g. 'pushes through fatigue', 'sleep drops during exam weeks')",
  "- goals and what 'good coaching' means to them",
  "Do NOT record transient daily state (today's soreness, one-off mood, a single night's sleep) — that already lives in check-ins.",
  "Do NOT duplicate or lightly reword a note already on file. Only return genuinely new information.",
  "Keep each note one crisp sentence, written about the athlete in third person so it reads cleanly as a standalone fact.",
  "If there is nothing new worth saving, return an empty list. Be conservative — quality over quantity.",
  "Return ONLY by calling save_memory_notes.",
].join("\n");

const DISTILL_TOOL: Anthropic.Tool = {
  name: "save_memory_notes",
  description:
    "Save any new durable memory notes extracted from the conversation. Return an empty notes array if there is nothing new worth remembering.",
  input_schema: {
    type: "object",
    properties: {
      notes: {
        type: "array",
        description: "New durable facts about the athlete. May be empty.",
        items: {
          type: "object",
          properties: {
            category: {
              type: "string",
              description:
                "One short tag: preference | constraint | history | pattern | goal | style | other",
            },
            note: {
              type: "string",
              description: "One crisp sentence stating the durable fact.",
            },
          },
          required: ["note"],
        },
      },
    },
    required: ["notes"],
  },
};

export async function distillMemoryFromChat(
  existingNotes: { category: string | null; note: string }[],
  history: ChatTurn[],
): Promise<DistilledNote[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || history.length === 0) return [];

  const client = new Anthropic({ apiKey });

  const existingText =
    existingNotes.length > 0
      ? existingNotes
          .map((n) => `- ${n.category ? `[${n.category}] ` : ""}${n.note}`)
          .join("\n")
      : "(none yet)";
  const convoText = history
    .map((t) => `${t.role === "athlete" ? "Athlete" : "Coach"}: ${t.body}`)
    .join("\n");

  const userContent =
    "NOTES ALREADY ON FILE:\n" +
    existingText +
    "\n\nRECENT CONVERSATION:\n" +
    convoText +
    "\n\nExtract any new durable notes by calling save_memory_notes.";

  let input: unknown;
  try {
    const msg = await client.messages.create({
      model: process.env.MEMORY_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: DISTILL_SYSTEM_PROMPT,
      tools: [DISTILL_TOOL],
      tool_choice: { type: "tool", name: "save_memory_notes" },
      messages: [{ role: "user", content: userContent }],
    });
    const toolUse = msg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    input = toolUse?.input;
  } catch {
    return []; // never block chat on memory distillation
  }

  const raw = (input as { notes?: unknown })?.notes;
  if (!Array.isArray(raw)) return [];

  const seen = new Set(
    existingNotes.map((n) => n.note.trim().toLowerCase()),
  );
  const out: DistilledNote[] = [];
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    const note = asString(o.note);
    if (!note) continue;
    const key = note.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const category = asString(o.category) || null;
    out.push({ category, note });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Check-in memory distillation — harvest durable facts from daily check-ins.
// ----------------------------------------------------------------------------

const CHECKIN_DISTILL_SYSTEM_PROMPT = [
  "You maintain a performance coach's private long-term memory about ONE athlete.",
  "You are given the notes already on file and the free-text fields from a single daily check-in (open_comments and/or pain_injury_note).",
  "Extract ONLY new, durable facts worth remembering for future coaching — things that will still be true or relevant next week:",
  "- injuries and recurring pain patterns (e.g. 'right shoulder clicking during pressing', 'knee flares up on high-volume squat days')",
  "- schedule or life constraints (e.g. 'starting a new demanding job', 'exam week in June', 'traveling for work')",
  "- coaching context they shared (e.g. 'their sport coach said to limit overhead pressing', 'doctor cleared them for full training')",
  "- stable behavioral patterns (e.g. 'tends to underreport fatigue', 'skips post-workout nutrition when busy')",
  "Do NOT record: today's soreness, how they feel today, one-off moods, routine check-in context.",
  "Do NOT duplicate or lightly reword a note already on file.",
  "Keep each note one crisp sentence, written about the athlete in third person.",
  "If there is nothing new worth saving, return an empty list. Be very conservative — quality over quantity.",
  "Return ONLY by calling save_memory_notes.",
].join("\n");

export async function distillMemoryFromCheckin(
  existingNotes: { category: string | null; note: string }[],
  checkin: { open_comments?: string | null; pain_injury_note?: string | null },
): Promise<DistilledNote[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const open = checkin.open_comments?.trim() ?? "";
  const pain = checkin.pain_injury_note?.trim() ?? "";
  if (!apiKey || (!open && !pain)) return [];

  const client = new Anthropic({ apiKey });

  const existingText =
    existingNotes.length > 0
      ? existingNotes
          .map((n) => `- ${n.category ? `[${n.category}] ` : ""}${n.note}`)
          .join("\n")
      : "(none yet)";

  const checkinText = [
    pain ? `pain_injury_note: "${pain}"` : null,
    open ? `open_comments: "${open}"` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const userContent =
    "NOTES ALREADY ON FILE:\n" +
    existingText +
    "\n\nCHECK-IN FREE-TEXT FIELDS:\n" +
    checkinText +
    "\n\nExtract any new durable memory notes by calling save_memory_notes.";

  let input: unknown;
  try {
    const msg = await client.messages.create({
      model: process.env.MEMORY_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: CHECKIN_DISTILL_SYSTEM_PROMPT,
      tools: [DISTILL_TOOL],
      tool_choice: { type: "tool", name: "save_memory_notes" },
      messages: [{ role: "user", content: userContent }],
    });
    const toolUse = msg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    input = toolUse?.input;
  } catch {
    return [];
  }

  const raw = (input as { notes?: unknown })?.notes;
  if (!Array.isArray(raw)) return [];

  const seen = new Set(existingNotes.map((n) => n.note.trim().toLowerCase()));
  const out: DistilledNote[] = [];
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    const note = asString(o.note);
    if (!note) continue;
    const key = note.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const category = asString(o.category) || null;
    out.push({ category, note });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Prediction scoring — close the track-record loop.
//
// Each daily decision logs a specific, checkable prediction for the next day
// (e.g. "recovery climbs above 55, energy up at least a point"). Once the target
// day's check-in exists, this compares the prediction against what actually
// happened and returns a graded outcome. Those outcomes feed back into future
// decisions ("learn from what came true vs missed"), and into trust metrics.
//
// Throws on infrastructure failure (missing key / API error) so the caller can
// skip and retry later rather than permanently recording a bogus outcome.
// "unknown" / "too_early" are legitimate verdicts the model may return.
// ----------------------------------------------------------------------------

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

  // No data for the target day yet — caller normally guards against this, but
  // be safe: nothing to score against.
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
