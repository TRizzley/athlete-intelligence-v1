// Context serialization — turns athlete data into a compact labeled brief for
// the AI, and applies feedback-derived calibration directives. Shared by all
// AI coaching modules; nothing here calls Claude.

import type {
  DailyCheckin,
  UploadedScreenshot,
  CoachResponse,
  PredictionWithOutcome,
  PredictionOutcome,
  UserFeedback,
  Confidence,
} from "./types";
import type { CoachContext } from "./coach-types";
import { summarizeSelfEvals } from "./coach-evals";
import { detectWorkoutPatterns } from "./coach-patterns";
import { derivePatternFocus } from "./coach-focus";

// ── Shared utils ──────────────────────────────────────────────────────────────

export const CONFIDENCES: Confidence[] = ["low", "medium", "high"];

export function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// ── Private helpers ───────────────────────────────────────────────────────────

function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

export function checkinBrief(c: DailyCheckin): Record<string, unknown> {
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
    // Extended WHOOP biometrics
    whoop_daily_strain: c.whoop_strain,
    spo2_pct: c.spo2_percentage,
    skin_temp_celsius: c.skin_temp_celsius,
    sleep_light_hours: c.sleep_light_hours,
    sleep_deep_hours: c.sleep_sws_hours,
    sleep_rem_hours: c.sleep_rem_hours,
    sleep_disturbances: c.sleep_disturbances,
    respiratory_rate: c.respiratory_rate,
  });
}

function firstOutcome(p: PredictionWithOutcome): PredictionOutcome | null {
  const po = p.prediction_outcomes;
  if (!po) return null;
  return Array.isArray(po) ? po[0] ?? null : po;
}

// ── Feedback calibration ──────────────────────────────────────────────────────

// Turn recent feedback into explicit, prioritized calibration directives so the
// next decision actually adapts to what the athlete said fell short.
//
// Sample guard: we need at least 3 feedback entries before firing directives.
// Below that threshold a single "somewhat" would trigger a full override, which
// over-corrects on noise and makes the coach unstable early on.
//
// Weighting: "no" counts 2× vs "somewhat" so a clear miss is treated more
// urgently than mild dissatisfaction.
export function feedbackCalibration(feedback: UserFeedback[]): string | null {
  const recent = feedback.slice(0, 6); // newest first
  if (recent.length < 3) return null;

  const weightedScore = (key: keyof UserFeedback) =>
    recent.reduce((sum, f) => {
      if (f[key] === "no") return sum + 2;
      if (f[key] === "somewhat") return sum + 1;
      return sum;
    }, 0);
  // Fire a directive when weighted score >= half the max possible
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

// ── Context serializer ────────────────────────────────────────────────────────

export function buildContextText(ctx: CoachContext, closing?: string): string {
  const parts: string[] = [];

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

  if (ctx.latestCheckin) {
    parts.push(
      "LATEST CHECK-IN (most recent completed-day results — plan today from this):\n" +
        JSON.stringify(checkinBrief(ctx.latestCheckin), null, 2),
    );
  } else {
    parts.push("LATEST CHECK-IN: (none logged yet)");
  }

  const history = ctx.recentCheckins.filter(
    (c) => c.id !== ctx.latestCheckin?.id,
  );
  if (history.length > 0) {
    parts.push(
      "RECENT CHECK-IN HISTORY (most recent first):\n" +
        JSON.stringify(history.map(checkinBrief), null, 2),
    );
  }

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

  if (ctx.recentMessages && ctx.recentMessages.length > 0) {
    parts.push(
      "RECENT CHAT WITH THIS ATHLETE (most recent last — preferences they stated, context they shared, and open questions; honor what they told you and let it shape today's plan):\n" +
        ctx.recentMessages
          .map((m) => `${m.role === "athlete" ? "Athlete" : "Coach"}: ${m.body}`)
          .join("\n"),
    );
  }

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
        self_grade: o?.self_grade,
        self_grade_note: o?.self_grade_note,
      });
    });
    parts.push(
      "PAST PREDICTIONS & OUTCOMES (your track record with this athlete — outcome is vs. the morning check-in; self_grade is how your performance call held up against the actual workout log. Learn from where you were accurate vs. slightly off vs. missed):\n" +
        JSON.stringify(preds, null, 2),
    );
  }

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

  if (ctx.selfEvals && ctx.selfEvals.length > 0) {
    const summary = summarizeSelfEvals(ctx.selfEvals);
    const evals = ctx.selfEvals.map((e) =>
      compact({
        workout_date: e.workout_date,
        day: e.day_name,
        rpe_1to10: e.rpe,
        their_words: e.feedback,
      }),
    );
    parts.push(
      "ATHLETE SELF-EVALS (most recent first — the athlete's own post-workout rating: RPE 1-10 plus their words, matching the logged workouts above by date. workout_intensity_1to10 in the check-ins is the same scale captured at day level; read them together. The summary is pre-computed: avg_rpe is over the last 5 evals, rpe_trend compares the two most recent. Rising RPE at the same loads = accumulating fatigue, falling RPE at the same loads = adaptation. Their words are the highest-signal personalization you have — echo them back when relevant):\n" +
        "SUMMARY: " +
        JSON.stringify(
          compact({
            avg_rpe_last_5: summary.avgRPE,
            rpe_trend: summary.rpeTrend,
            evals_logged: summary.rpeCount,
            latest_words: summary.recentFeedback,
          }),
        ) +
        "\n" +
        JSON.stringify(evals, null, 2),
    );

    // Pattern summary across those evals, grouped by the workout each one
    // rated. Rendered only once at least one type has enough evals for signal.
    const patterns = detectWorkoutPatterns(ctx.selfEvals, ctx.today);
    if (Object.keys(patterns.byWorkoutType).length > 0) {
      parts.push(
        `WORKOUT PATTERNS (pre-computed from the self-evals above, grouped by WORKOUT TYPE — the workout the athlete rated, never calendar day-of-week. avg_rpe is the mean RPE for that type over the last ${patterns.windowDays} days; trend compares that type's earlier vs. later evals chronologically. peak_types average RPE >= 7 — the athlete performs strongest there, good days to push; struggle_types average <= 5 — favor recovery or technique focus there. All stats are pre-computed; do not re-derive them):\n` +
          "SUMMARY: " +
          JSON.stringify(
            compact({
              peak_types: patterns.peakTypes,
              struggle_types: patterns.struggleTypes,
              recommendations: patterns.recommendations,
            }),
          ) +
          "\n" +
          JSON.stringify(patterns.byWorkoutType, null, 2),
      );

      // Deterministic coaching directive derived from those patterns — the
      // decision of what to emphasize is pre-computed in lib/coach-focus.ts;
      // the model only voices it. Rendered only when a focus actually exists.
      const focus = derivePatternFocus(patterns);
      if (focus.push_type !== null || focus.pull_back_type !== null) {
        parts.push(
          "SUGGESTED FOCUS (pre-computed coaching angle from the workout patterns above — do not re-derive it. push_type is where the athlete is thriving: lean into it when giving recommendations. pull_back_type is where they're consistently struggling: ease off toward recovery or technique focus. Voice this naturally as encouragement in your own words — never quote it verbatim or read it back as raw data, and never mention calendar days. If push_type or pull_back_type is absent, simply don't force that angle):\n" +
            "SUMMARY: " +
            JSON.stringify(
              compact({
                push_type: focus.push_type,
                pull_back_type: focus.pull_back_type,
                confidence: focus.confidence,
                rationale: focus.rationale,
              }),
            ),
        );
      }
    }
  }

  if (ctx.workoutDays && ctx.workoutDays.length > 0) {
    const days = ctx.workoutDays.map((d) => ({
      id: d.id,
      name: d.name,
      label: d.label,
      exercises: d.exercises.map((e) => ({
        id: e.id,
        name: e.name,
        muscle_group: e.muscle_group,
        sets: e.target_sets,
        reps: e.target_reps,
      })),
    }));
    parts.push(
      "SAVED WORKOUT PROGRAM (days and exercises with their IDs — use these IDs in workout proposals):\n" +
        JSON.stringify(days, null, 2),
    );
  }

  // Trend engine output (only present once the athlete passes the 21-day gate).
  // These are pre-computed, data-grounded calls the coach should TRANSLATE into
  // its own voice inside the PREP beat of the morning message — not a new section.
  if (ctx.trendInsights) {
    const t = ctx.trendInsights;
    const lines: string[] = [];
    lines.push(
      "TREND ENGINE (computed from 3+ weeks of this athlete's logged data — use these to make real coaching calls today):",
    );
    lines.push(
      `- INTERNAL READINESS = ${t.readiness.level} (${t.readiness.rationale}). ` +
        "This is for YOU only: let it set how hard you push today (high = push, low = back off and protect the session). " +
        "NEVER show the athlete a readiness score, percentage, or label — it only shapes your tone and the intensity you prescribe.",
    );
    if (t.progression.length > 0) {
      lines.push(
        "- PROGRESSION CALLS (surface these in the PREP beat, in your voice, with the data reason — recommend the move up):\n" +
          t.progression.map((p) => `   • ${p.detail}`).join("\n"),
      );
    }
    if (t.stalls.length > 0) {
      lines.push(
        "- STALLS (surface in the PREP beat with the specific fix — 2-3 sentences, a coach talking, not a report):\n" +
          t.stalls.map((s) => `   • ${s.detail}`).join("\n"),
      );
    }
    if (t.sleepFlag) lines.push(`- SLEEP TREND: ${t.sleepFlag} Factor it into how hard you push and say so briefly in PREP.`);
    if (t.macroFlag) lines.push(`- MACRO TREND: ${t.macroFlag} Mention it briefly in PREP if it affects today.`);
    lines.push(
      "Weave the progression/stall/flag items into PREP only — do NOT add new sections or change the 4-beat format. If an item isn't relevant to today's session, leave it out.",
    );
    parts.push(lines.join("\n"));
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
