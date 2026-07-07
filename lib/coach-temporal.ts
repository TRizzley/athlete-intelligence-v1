// Temporal knowledge graph — a span-aware, deterministic summary of the
// athlete's long training arc (up to 180 days): frequency, type mix, volume
// trajectory, fatigue signals, rest rhythm, and seasonality. The long-arc
// sibling of lib/coach-patterns.ts (30-day) and lib/coach-trends.ts (21-day
// gate): pre-computed so the AI never does arithmetic over raw rows.
// Pure functions only; fetching lives in lib/context.ts (wired in C2).
//
// Span-aware by design: the database is young, so the summary works on
// min(180, actual_history) days and grows into its full form — including the
// seasonality section, which stays null until the athlete has enough history
// for month-over-month comparison to mean anything.

import { TREND_DELTA } from "./coach-patterns";

/** Maximum lookback: data older than this many days before `today` is ignored. */
export const TEMPORAL_WINDOW_DAYS = 180;
/** Seasonality renders only once the athlete's span reaches this many days. */
export const SEASONALITY_MIN_SPAN_DAYS = 120;
/** Volume-arc block size: tonnage is aggregated per this many weeks. */
export const BLOCK_SIZE_WEEKS = 4;
/** Block-over-block intensity drop (points on the 1-10 scale) per severity. */
export const FATIGUE_SEVERITY_DELTAS = { mild: 1, moderate: 2, severe: 3 };
/** Gaps strictly longer than this many days count as real rest, not spacing. */
export const REST_THRESHOLD_DAYS = 3;
/** A single gap at or beyond this many days marks a long break. */
export const LONG_BREAK_DAYS = 7;
/** Block-over-block tonnage change (%) beyond which volume is trending. */
const VOLUME_TREND_PCT = 10;
/** Types with fewer intensity samples than this are dropped — signal, not noise. */
const MIN_SAMPLES_PER_TYPE = 2;

const MS_PER_DAY = 86_400_000;
const BLOCK_MS = BLOCK_SIZE_WEEKS * 7 * MS_PER_DAY;

/** One 4-week slice of the volume arc. */
export interface VolumeBlock {
  /** Human label, 1-indexed from the start of the window: "Week 1-4". */
  weekLabel: string;
  /** Sum of weight × reps across every logged set in the block, in lbs. */
  totalTonnage: number;
  /**
   * vs. the previous block's tonnage: 'climbing' when up more than
   * {@link VOLUME_TREND_PCT}%, 'declining' when down more than that, else
   * 'plateau'. 'insufficient_data' for the first block or when the previous
   * block had no logged tonnage to compare against.
   */
  trend: "climbing" | "plateau" | "declining" | "insufficient_data";
}

/** Rest inferred from session-date gaps — rest days are not captured explicitly. */
export interface RestPattern {
  /** Mean days between consecutive sessions, 1 decimal. 0 with < 2 sessions. */
  avgGapDays: number;
  /** Longest gap between consecutive sessions, in days. */
  maxGapDays: number;
  /** Count of gaps strictly over {@link REST_THRESHOLD_DAYS} days — real rest. */
  gapsOver3d: number;
  /**
   * 'long_break' when any gap reaches {@link LONG_BREAK_DAYS} days,
   * 'variable' when more than a quarter of gaps are real rest, else
   * 'consistent'. 'insufficient_data' with fewer than 2 sessions (no gaps).
   */
  inference: "consistent" | "variable" | "long_break" | "insufficient_data";
}

/**
 * The pre-computed long-arc view the coach reasons over. Every field is
 * deterministic arithmetic over raw rows — the model voices these, never
 * re-derives them.
 */
export interface TemporalSummary {
  /** Actual span summarized: min(180, history). from/to are YYYY-MM-DD. */
  window: { daysSpanned: number; from: string; to: string };
  /**
   * Completed-session counts. `consistency` is a plain-language label the
   * coach can echo ("exceptional consistency" at 5+/week down to "variable").
   */
  frequency: { totalSessions: number; sessionsPerWeek: number; consistency: string };
  /**
   * Per workout type (the controlled `workout_types` vocabulary from daily
   * check-ins — never free-text session names): how often it was logged, mean
   * reported intensity (1-10), and whether intensity is trending up/down
   * (first-half vs. second-half average, {@link TREND_DELTA} threshold).
   * Types with fewer than 2 intensity samples are dropped.
   */
  typeBreakdown: Record<
    string,
    { count: number; avgIntensity: number; trend: "up" | "stable" | "down" }
  >;
  /** Tonnage per {@link BLOCK_SIZE_WEEKS}-week block, oldest first. */
  volumeArc: VolumeBlock[];
  /**
   * Overreach detector: reported intensity falling ≥ 1 point block-over-block
   * while that block's tonnage sits at or above the 75th percentile of all
   * blocks — effort dropping under a heavy load. `when` names the offending
   * block; severity scales with the size of the intensity drop
   * ({@link FATIGUE_SEVERITY_DELTAS}). Null when nothing detected.
   */
  fatigueSignal: {
    detected: boolean;
    when: string;
    severity: "mild" | "moderate" | "severe";
  } | null;
  /** Rest rhythm inferred from session-date gaps. */
  restRhythm: RestPattern;
  /**
   * Month-by-month one-liners keyed "YYYY-MM" (e.g. "avg intensity 7.4").
   * Null until the span reaches {@link SEASONALITY_MIN_SPAN_DAYS} days —
   * month-over-month comparison is noise before that.
   */
  seasonality: Record<string, string> | null;
}

const EMPTY_SUMMARY: TemporalSummary = {
  window: { daysSpanned: 0, from: "", to: "" },
  frequency: { totalSessions: 0, sessionsPerWeek: 0, consistency: "insufficient data" },
  typeBreakdown: {},
  volumeArc: [],
  fatigueSignal: null,
  restRhythm: { avgGapDays: 0, maxGapDays: 0, gapsOver3d: 0, inference: "insufficient_data" },
  seasonality: null,
};

function mean(nums: number[]): number {
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Parse YYYY-MM-DD as UTC midnight ms; NaN for empty/unparseable dates. */
function dayMs(date: string): number {
  return Date.parse(date + "T00:00:00Z");
}

/**
 * Build a span-aware temporal knowledge graph summary.
 *
 * Pure function: zero Supabase calls, no LLM arithmetic, no side effects —
 * same input always yields the same output. Rows dated before
 * `today - {@link TEMPORAL_WINDOW_DAYS}` days (or with unparseable dates) are
 * ignored, so the summary covers min(180, actual_history) days and grows into
 * its full form as the athlete accumulates time.
 *
 * @param sessions workout_sessions rows in any order (id, session_date,
 *                 status). Sessions drive frequency, rest rhythm, and the
 *                 volume-arc blocks; their ids join tonnage from `setLogs`.
 * @param setLogs  workout_set_logs rows (session_id, weight, reps) — tonnage
 *                 is weight × reps. Logs whose session isn't in `sessions`
 *                 are ignored.
 * @param checkins daily_checkins rows in any order (checkin_date,
 *                 workout_types[], workout_intensity). Check-ins drive the
 *                 type breakdown, all intensity math (including the fatigue
 *                 signal), and seasonality — the controlled workout_types
 *                 vocabulary lives here, not on sessions.
 * @param today    YYYY-MM-DD the summary is built for.
 * @returns The pre-computed {@link TemporalSummary}. Empty shape
 *          (daysSpanned 0) when there are no in-window sessions — never
 *          throws.
 */
export function buildTemporalSummary(
  sessions: Array<{ id: string; session_date: string; status: string }>,
  setLogs: Array<{ session_id: string; weight: number; reps: number }>,
  checkins: Array<{
    checkin_date: string;
    workout_types?: string[];
    workout_intensity?: number;
  }>,
  today: string,
): TemporalSummary {
  const todayMs = dayMs(today);
  if (!Number.isFinite(todayMs)) return EMPTY_SUMMARY;
  const cutoffMs = todayMs - TEMPORAL_WINDOW_DAYS * MS_PER_DAY;

  // Window filter — the 180-day cap is enforced by dropping older rows, not
  // just by capping the reported span. Unparseable dates are excluded rather
  // than NaN-compared (same guard as lib/coach-patterns.ts).
  const inWindow = sessions.filter((s) => {
    const t = dayMs(s.session_date);
    return Number.isFinite(t) && t >= cutoffMs && t <= todayMs;
  });
  if (inWindow.length === 0) return EMPTY_SUMMARY;

  // Input order is not guaranteed (lib/context.ts fetches newest first) —
  // sort ascending once and derive everything date-ordered from this.
  const ordered = [...inWindow].sort((a, b) =>
    a.session_date.localeCompare(b.session_date),
  );
  const oldestMs = dayMs(ordered[0].session_date);
  const daysSpanned = Math.floor((todayMs - oldestMs) / MS_PER_DAY);
  if (daysSpanned === 0) return EMPTY_SUMMARY;

  const inWindowCheckins = checkins
    .filter((c) => {
      const t = dayMs(c.checkin_date);
      return Number.isFinite(t) && t >= cutoffMs && t <= todayMs;
    })
    .sort((a, b) => a.checkin_date.localeCompare(b.checkin_date));

  // ── Frequency ───────────────────────────────────────────────────────────
  const totalSessions = ordered.filter((s) => s.status === "completed").length;
  const sessionsPerWeek = round1(totalSessions / (daysSpanned / 7));
  let consistency: string;
  if (sessionsPerWeek >= 5) consistency = "exceptional consistency";
  else if (sessionsPerWeek >= 4) consistency = "very consistent";
  else if (sessionsPerWeek >= 3) consistency = "consistent";
  else consistency = "variable";

  // ── Type breakdown (from check-ins — the controlled vocabulary) ─────────
  const typeMap = new Map<string, number[]>();
  for (const c of inWindowCheckins) {
    if (!c.workout_types || c.workout_types.length === 0) continue;
    if (typeof c.workout_intensity !== "number") continue;
    for (const type of c.workout_types) {
      const arr = typeMap.get(type);
      if (arr) arr.push(c.workout_intensity);
      else typeMap.set(type, [c.workout_intensity]);
    }
  }
  const typeBreakdown: TemporalSummary["typeBreakdown"] = {};
  for (const [type, intensities] of typeMap) {
    if (intensities.length < MIN_SAMPLES_PER_TYPE) continue;
    const mid = Math.ceil(intensities.length / 2);
    const firstAvg = mean(intensities.slice(0, mid));
    const secondAvg = mean(intensities.slice(mid));
    let trend: "up" | "stable" | "down" = "stable";
    if (secondAvg > firstAvg + TREND_DELTA) trend = "up";
    else if (secondAvg < firstAvg - TREND_DELTA) trend = "down";
    typeBreakdown[type] = {
      count: intensities.length,
      avgIntensity: round1(mean(intensities)),
      trend,
    };
  }

  // ── Volume arc: tonnage per 4-week block, anchored at the oldest session ─
  const tonnageBySession = new Map<string, number>();
  for (const log of setLogs) {
    tonnageBySession.set(
      log.session_id,
      (tonnageBySession.get(log.session_id) ?? 0) + log.weight * log.reps,
    );
  }
  const blockIndexOf = (ms: number) => Math.floor((ms - oldestMs) / BLOCK_MS);
  const blockCount = blockIndexOf(todayMs) + 1;

  const blockTonnages: number[] = new Array(blockCount).fill(0);
  for (const s of ordered) {
    const idx = blockIndexOf(dayMs(s.session_date));
    blockTonnages[idx] += tonnageBySession.get(s.id) ?? 0;
  }

  const volumeArc: VolumeBlock[] = blockTonnages.map((totalTonnage, i) => {
    let trend: VolumeBlock["trend"] = "insufficient_data";
    if (i > 0) {
      const prev = blockTonnages[i - 1];
      if (prev > 0) {
        const deltaPct = ((totalTonnage - prev) / prev) * 100;
        if (deltaPct > VOLUME_TREND_PCT) trend = "climbing";
        else if (deltaPct < -VOLUME_TREND_PCT) trend = "declining";
        else trend = "plateau";
      }
    }
    return {
      weekLabel: `Week ${i * BLOCK_SIZE_WEEKS + 1}-${(i + 1) * BLOCK_SIZE_WEEKS}`,
      totalTonnage: Math.round(totalTonnage),
      trend,
    };
  });

  // ── Fatigue signal: intensity dropping while block tonnage is high ──────
  // Per-block mean reported intensity from check-ins, compared block-over-
  // block. "High tonnage" = at or above the 75th percentile of all blocks.
  const blockIntensities: number[][] = Array.from(
    { length: blockCount },
    () => [],
  );
  for (const c of inWindowCheckins) {
    if (typeof c.workout_intensity !== "number") continue;
    const idx = blockIndexOf(dayMs(c.checkin_date));
    if (idx >= 0 && idx < blockCount) blockIntensities[idx].push(c.workout_intensity);
  }
  const sortedTonnages = [...blockTonnages].sort((a, b) => a - b);
  const p75 =
    sortedTonnages[Math.min(
      sortedTonnages.length - 1,
      Math.floor(sortedTonnages.length * 0.75),
    )];

  let fatigueSignal: TemporalSummary["fatigueSignal"] = null;
  for (let i = 1; i < blockCount; i++) {
    if (blockIntensities[i].length === 0 || blockIntensities[i - 1].length === 0)
      continue;
    const drop = mean(blockIntensities[i - 1]) - mean(blockIntensities[i]);
    if (drop >= FATIGUE_SEVERITY_DELTAS.mild && blockTonnages[i] >= p75) {
      let severity: "mild" | "moderate" | "severe" = "mild";
      if (drop >= FATIGUE_SEVERITY_DELTAS.severe) severity = "severe";
      else if (drop >= FATIGUE_SEVERITY_DELTAS.moderate) severity = "moderate";
      fatigueSignal = { detected: true, when: volumeArc[i].weekLabel, severity };
      break;
    }
  }

  // ── Rest rhythm from session-date gaps ──────────────────────────────────
  const gaps: number[] = [];
  for (let i = 1; i < ordered.length; i++) {
    gaps.push(
      Math.floor(
        (dayMs(ordered[i].session_date) - dayMs(ordered[i - 1].session_date)) /
          MS_PER_DAY,
      ),
    );
  }
  const gapsOver3d = gaps.filter((g) => g > REST_THRESHOLD_DAYS).length;
  const maxGapDays = gaps.length > 0 ? Math.max(...gaps) : 0;
  let inference: RestPattern["inference"];
  if (gaps.length === 0) inference = "insufficient_data";
  else if (maxGapDays >= LONG_BREAK_DAYS) inference = "long_break";
  else if (gapsOver3d > gaps.length * 0.25) inference = "variable";
  else inference = "consistent";
  const restRhythm: RestPattern = {
    avgGapDays: gaps.length > 0 ? round1(mean(gaps)) : 0,
    maxGapDays,
    gapsOver3d,
    inference,
  };

  // ── Seasonality (gated: month-over-month needs real history) ────────────
  let seasonality: Record<string, string> | null = null;
  if (daysSpanned >= SEASONALITY_MIN_SPAN_DAYS) {
    seasonality = {};
    const byMonth = new Map<string, number[]>();
    for (const c of inWindowCheckins) {
      if (typeof c.workout_intensity !== "number") continue;
      const month = c.checkin_date.slice(0, 7); // "YYYY-MM"
      const arr = byMonth.get(month);
      if (arr) arr.push(c.workout_intensity);
      else byMonth.set(month, [c.workout_intensity]);
    }
    for (const [month, intensities] of byMonth) {
      seasonality[month] = `avg intensity ${round1(mean(intensities)).toFixed(1)}`;
    }
  }

  return {
    window: {
      daysSpanned,
      from: ordered[0].session_date,
      to: today,
    },
    frequency: { totalSessions, sessionsPerWeek, consistency },
    typeBreakdown,
    volumeArc,
    fatigueSignal,
    restRhythm,
    seasonality,
  };
}
