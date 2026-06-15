// ----------------------------------------------------------------------------
// Trend-based coaching engine.
//
// Runs alongside the daily flow ONCE an athlete has >= TREND_GATE_DAYS of workout
// data (the gate). It reads the existing workout log, sleep, and nutrition data and
// turns it into real coaching signals the morning brief uses:
//
//   • readiness  — an INTERNAL high/moderate/low signal (sleep + macros + recent
//                  load) used to calibrate how hard to push. Never shown to the
//                  athlete as a number or label.
//   • progression — lifts where target reps+weight have been hit cleanly across
//                  the last 3-5 sessions → ready to move up, with a data reason.
//   • stalls     — lifts stuck/regressing across 3+ sessions → a concrete fix.
//   • sleep/macro flags — 7-day rolling signals that should temper intensity.
//
// Detection is deterministic (no extra LLM call): it produces specific, factual
// signal strings that the coach model phrases into the PREP beat of the morning
// message in its own voice. Lifts without enough sessions are skipped silently.
//
// All reads use the service-role admin client (callers already hold one). No new
// data is collected — everything here comes from tables that already exist.
// ----------------------------------------------------------------------------

import type { createAdminClient } from "./supabase/admin";
import type { AthleteProfile, DailyCheckin } from "./types";

type AdminClient = ReturnType<typeof createAdminClient>;

// Gate: the engine activates once the athlete has this many days of data.
export const TREND_GATE_DAYS = 21;

// Trend windows.
const LIFT_SESSION_WINDOW = 5; // last N sessions per lift for progression/stall
const SLEEP_NUTRITION_DAYS = 7; // rolling window for sleep/nutrition signals
const WORKOUT_LOOKBACK_DAYS = 60; // how far back to pull sessions for per-lift trends

export interface TrendReadiness {
  level: "high" | "moderate" | "low";
  rationale: string; // short, internal — explains the dominant factor
}

export interface TrendCall {
  lift: string;
  detail: string; // factual, specific; the coach phrases it into PREP
  significant: boolean; // worthy of a rare standalone message
}

export interface TrendInsights {
  readiness: TrendReadiness;
  progression: TrendCall[];
  stalls: TrendCall[];
  sleepFlag: string | null;
  macroFlag: string | null;
  // The single most important call, if any — for the rare standalone alert.
  significantAlert: string | null;
}

// ── Gate ──────────────────────────────────────────────────────────────────────

/**
 * Is the trend engine active for this athlete? Reads the materialized stat off
 * the profile row (already loaded each session) — a single clean field read, no
 * scan of the workout tables. Returns false until TREND_GATE_DAYS of data exist.
 */
export function isTrendGateOpen(
  profile: AthleteProfile | null,
  today: string,
): boolean {
  const start = profile?.workout_data_start_date;
  if (!start) return false;
  const days = Math.floor(
    (Date.parse(today + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) /
      86400000,
  );
  return days >= TREND_GATE_DAYS;
}

/**
 * Recompute and persist the gate stats (first completed-workout date + count) in
 * a single aggregate query. Cheap; call it when a session is completed and as a
 * lazy backfill the first time the trend flow runs for a pre-existing athlete.
 */
export async function refreshWorkoutDataStats(
  userId: string,
  admin: AdminClient,
): Promise<{ startDate: string | null; logCount: number }> {
  const { data, count } = await admin
    .from("workout_sessions")
    .select("session_date", { count: "exact" })
    .eq("user_id", userId)
    .eq("status", "completed")
    .order("session_date", { ascending: true })
    .limit(1);

  const startDate =
    (data as { session_date: string }[] | null)?.[0]?.session_date ?? null;
  const logCount = count ?? 0;

  await admin
    .from("athlete_profiles")
    .update({
      workout_data_start_date: startDate,
      workout_log_count: logCount,
    })
    .eq("user_id", userId);

  return { startDate, logCount };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysAgoISO(today: string, n: number): string {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function normalizeLift(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// Lower bound of a target rep scheme ("5", "8-12", "5x5" → 5). Null if unknown.
function parseTargetLow(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = t.match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

const COMPOUND_RE = /squat|bench|deadlift|dead lift|press|overhead|ohp|\brow\b|clean|snatch/i;
function isCompound(lift: string): boolean {
  return COMPOUND_RE.test(lift);
}

// Suggested next jump: bigger for lower-body compounds, smaller otherwise.
function suggestIncrement(lift: string): number {
  return /squat|deadlift|dead lift/i.test(lift) ? 10 : 5;
}

interface SetRow {
  session_id: string;
  exercise_name: string;
  set_number: number;
  weight: number | null;
  reps: number | null;
  target_reps: string | null;
}

// One lift's result within one session: the top working weight and how it went.
interface LiftSession {
  date: string;
  weight: number;
  minReps: number; // lowest reps among sets at the top weight (the hardest set)
  targetLow: number | null;
  hitTarget: boolean; // every working set met the target lower bound
}

// ── Main entry ─────────────────────────────────────────────────────────────────

/**
 * Analyze trends for one athlete. Returns null when the gate is closed (the
 * caller should run in normal mode). When open, returns the readiness signal plus
 * any progression/stall calls and 7-day sleep/macro flags. Empty arrays are fine
 * — readiness is always returned for intensity calibration.
 */
export async function analyzeTrends(
  admin: AdminClient,
  userId: string,
  today: string,
  profile: AthleteProfile | null,
  recentCheckins: DailyCheckin[],
): Promise<TrendInsights | null> {
  if (!isTrendGateOpen(profile, today)) return null;

  // 1. Pull completed sessions in the lookback window + their set logs.
  const since = daysAgoISO(today, WORKOUT_LOOKBACK_DAYS);
  const { data: sessionRows } = await admin
    .from("workout_sessions")
    .select("id, session_date, day_name")
    .eq("user_id", userId)
    .eq("status", "completed")
    .gte("session_date", since)
    .order("session_date", { ascending: false })
    .limit(40);

  const sessions =
    (sessionRows as { id: string; session_date: string; day_name: string | null }[]) ?? [];
  const sessionDateById = new Map(sessions.map((s) => [s.id, s.session_date]));

  let sets: SetRow[] = [];
  if (sessions.length > 0) {
    const { data: setRows } = await admin
      .from("workout_set_logs")
      .select("session_id, exercise_name, set_number, weight, reps, target_reps")
      .in(
        "session_id",
        sessions.map((s) => s.id),
      );
    sets = (setRows as SetRow[]) ?? [];
  }

  // 2. Reduce to per-lift, per-session top-set summaries.
  //    byLift: normalized name → { display, sessions: LiftSession[] (newest first) }
  const byLift = new Map<
    string,
    { display: string; sessionsByDate: Map<string, SetRow[]> }
  >();
  for (const s of sets) {
    if (!s.exercise_name) continue;
    const key = normalizeLift(s.exercise_name);
    const date = sessionDateById.get(s.session_id);
    if (!date) continue;
    let entry = byLift.get(key);
    if (!entry) {
      entry = { display: s.exercise_name.trim(), sessionsByDate: new Map() };
      byLift.set(key, entry);
    }
    const arr = entry.sessionsByDate.get(date) ?? [];
    arr.push(s);
    entry.sessionsByDate.set(date, arr);
  }

  const progression: TrendCall[] = [];
  const stalls: TrendCall[] = [];

  // Compute the 7-day sleep/macro signals first — they inform stall root-cause.
  const { sleepFlag, macroFlag, sleepAvgQuality, macroLowDays } = sleepAndMacroSignals(
    recentCheckins,
    today,
    profile,
  );

  for (const { display, sessionsByDate } of byLift.values()) {
    // Build newest-first LiftSession list (one summary per session).
    const liftSessions: LiftSession[] = [...sessionsByDate.entries()]
      .map(([date, rows]) => summarizeLiftSession(date, rows))
      .filter((ls): ls is LiftSession => ls !== null)
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    // Need at least 3 sessions to call a trend; skip silently otherwise.
    if (liftSessions.length < 3) continue;

    const window = liftSessions.slice(0, LIFT_SESSION_WINDOW);
    const n = window.length;
    const latest = window[0];

    const allSameWeight = window.every((w) => w.weight === latest.weight);
    const allHitTarget = window.every((w) => w.hitTarget);
    const weightsDescendingRecent = latest.weight < window[1].weight; // dropped vs prior

    // Progression: same weight, target hit cleanly every session in the window.
    if (allSameWeight && allHitTarget && n >= 3) {
      const inc = suggestIncrement(display);
      const next = latest.weight + inc;
      const fuel =
        !sleepFlag && !macroFlag
          ? " Sleep and nutrition have held up, so the timing is right."
          : "";
      progression.push({
        lift: display,
        detail:
          `${display}: hit ${latest.weight}×${latest.minReps} clean across the last ${n} sessions ` +
          `(target ${latest.targetLow ?? latest.minReps}). Ready to move up to ~${next}.${fuel}`,
        significant: isCompound(display),
      });
      continue;
    }

    // Stall: same weight 3+ sessions while missing the target, OR a regression.
    const missingLately = window.slice(0, 3).some((w) => !w.hitTarget);
    if ((allSameWeight && missingLately && n >= 3) || weightsDescendingRecent) {
      stalls.push({
        lift: display,
        detail: buildStallDetail(display, window, { sleepFlag, macroFlag }),
        significant: weightsDescendingRecent || n >= 4,
      });
    }
  }

  // Keep it focused: at most 2 of each, compounds first.
  const rank = (a: TrendCall, b: TrendCall) =>
    Number(isCompound(b.lift)) - Number(isCompound(a.lift));
  progression.sort(rank);
  stalls.sort(rank);
  const topProgression = progression.slice(0, 2);
  const topStalls = stalls.slice(0, 2);

  const readiness = computeReadiness({
    sleepAvgQuality,
    macroLowDays,
    sleepFlag,
    macroFlag,
    recentCheckins,
  });

  // The rare standalone alert: a regression/notable stall wins over a big
  // progression. Null when nothing rises to "genuinely important".
  const significantStall = topStalls.find((s) => s.significant);
  const significantProgression = topProgression.find((p) => p.significant);
  const significantAlert = significantStall
    ? significantStall.detail
    : significantProgression
      ? significantProgression.detail
      : null;

  return {
    readiness,
    progression: topProgression,
    stalls: topStalls,
    sleepFlag,
    macroFlag,
    significantAlert,
  };
}

// ── Per-lift session summary ────────────────────────────────────────────────────

function summarizeLiftSession(date: string, rows: SetRow[]): LiftSession | null {
  // Working sets = those actually logged (weight and reps present).
  const working = rows.filter(
    (r) => typeof r.weight === "number" && typeof r.reps === "number",
  );
  if (working.length === 0) return null;

  const weight = Math.max(...working.map((r) => r.weight as number));
  const atTop = working.filter((r) => r.weight === weight);
  const minReps = Math.min(...atTop.map((r) => r.reps as number));
  const targetLow = parseTargetLow(atTop.find((r) => r.target_reps)?.target_reps);
  const hitTarget = targetLow === null ? true : atTop.every((r) => (r.reps as number) >= targetLow);

  return { date, weight, minReps, targetLow, hitTarget };
}

// ── Stall coaching recommendation ───────────────────────────────────────────────

function buildStallDetail(
  lift: string,
  window: LiftSession[],
  flags: { sleepFlag: string | null; macroFlag: string | null },
): string {
  const latest = window[0];
  const sameWeightCount = window.filter((w) => w.weight === latest.weight).length;
  const regressed = window.length > 1 && latest.weight < window[1].weight;

  let situation: string;
  if (regressed) {
    situation = `${lift}: weight slipped to ${latest.weight} from ${window[1].weight} last session — a regression, not just a plateau.`;
  } else {
    situation = `${lift}: stuck at ${latest.weight} for ${sameWeightCount} sessions, missing the top set (got ${latest.minReps}${
      latest.targetLow ? ` vs target ${latest.targetLow}` : ""
    }).`;
  }

  // Root-cause-aware recommendation (2-3 sentences max overall).
  let rec: string;
  if (flags.macroFlag || flags.sleepFlag) {
    rec = `Recovery looks like the bottleneck here — ${
      flags.macroFlag ? "get protein back to target" : "get sleep back on track"
    } for a few days before forcing the number.`;
  } else if (sameWeightCount >= 4 || regressed) {
    rec = `Take a ~10% deload next session and rebuild — the bar's not moving by grinding it.`;
  } else {
    rec = `Add a focused accessory for the sticking point and tighten setup/bracing rather than just trying again at the same load.`;
  }

  return `${situation} ${rec}`;
}

// ── Sleep & macro 7-day signals ─────────────────────────────────────────────────

function sleepAndMacroSignals(
  checkins: DailyCheckin[],
  today: string,
  profile: AthleteProfile | null,
): {
  sleepFlag: string | null;
  macroFlag: string | null;
  sleepAvgQuality: number | null;
  macroLowDays: number;
} {
  const since = daysAgoISO(today, SLEEP_NUTRITION_DAYS);
  const window = checkins.filter((c) => c.checkin_date >= since);

  // Sleep: short or low-quality nights.
  const sleepRated = window.filter(
    (c) => c.sleep_quality !== null || c.sleep_hours !== null,
  );
  const poorNights = sleepRated.filter(
    (c) =>
      (c.sleep_quality !== null && (c.sleep_quality as number) < 6) ||
      (c.sleep_hours !== null && (c.sleep_hours as number) < 6.5),
  ).length;
  const qualityVals = window
    .map((c) => c.sleep_quality)
    .filter((v): v is number => typeof v === "number");
  const sleepAvgQuality =
    qualityVals.length > 0
      ? qualityVals.reduce((a, b) => a + b, 0) / qualityVals.length
      : null;
  const sleepFlag =
    poorNights >= 3
      ? `Sleep has been short or poor ${poorNights} of the last ${SLEEP_NUTRITION_DAYS} nights — that's likely capping recovery between sessions.`
      : null;

  // Macros: protein under a body-weight-derived target. Defensive ~0.8 g/lb.
  let macroFlag: string | null = null;
  let macroLowDays = 0;
  const bw = profile?.body_weight_lbs ?? null;
  const proteinTarget = bw ? Math.round(bw * 0.8) : null;
  if (proteinTarget) {
    const loggedProtein = window.filter((c) => typeof c.protein_g === "number");
    macroLowDays = loggedProtein.filter(
      (c) => (c.protein_g as number) < proteinTarget,
    ).length;
    if (loggedProtein.length >= 3 && macroLowDays >= 3) {
      macroFlag =
        `Protein has been under ~${proteinTarget}g ${macroLowDays} of the last ${loggedProtein.length} logged days — ` +
        `that's likely slowing recovery. Hit the number before training.`;
    }
  }

  return { sleepFlag, macroFlag, sleepAvgQuality, macroLowDays };
}

// ── Internal readiness signal ───────────────────────────────────────────────────

function computeReadiness(args: {
  sleepAvgQuality: number | null;
  macroLowDays: number;
  sleepFlag: string | null;
  macroFlag: string | null;
  recentCheckins: DailyCheckin[];
}): TrendReadiness {
  const { sleepAvgQuality, sleepFlag, macroFlag, recentCheckins } = args;
  let score = 0;
  const reasons: string[] = [];

  // Sleep.
  if (sleepFlag) {
    score -= 1;
    reasons.push("sleep down");
  } else if (sleepAvgQuality !== null && sleepAvgQuality >= 7) {
    score += 1;
    reasons.push("sleep strong");
  }

  // Macros.
  if (macroFlag) {
    score -= 1;
    reasons.push("protein low");
  } else {
    reasons.push("nutrition steady");
  }

  // Recent training load (last 3 sessions' intensity / load) → accumulated fatigue.
  const recentLoaded = recentCheckins
    .filter((c) => typeof c.workout_intensity === "number")
    .slice(0, 3);
  if (recentLoaded.length > 0) {
    const avgIntensity =
      recentLoaded.reduce((a, c) => a + (c.workout_intensity as number), 0) /
      recentLoaded.length;
    if (avgIntensity >= 8) {
      score -= 1;
      reasons.push("recent load heavy");
    }
  }

  const level: TrendReadiness["level"] =
    score >= 1 ? "high" : score <= -1 ? "low" : "moderate";

  return { level, rationale: reasons.join(", ") };
}
