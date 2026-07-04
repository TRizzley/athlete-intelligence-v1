// ----------------------------------------------------------------------------
// WHOOP → daily_checkins sync service.
//
// Single source of truth for the fetch → transform → upsert pipeline that was
// previously duplicated across three routes (cron sync, manual sync button,
// OAuth callback backfill). Fixes two data bugs those copies shared:
//   1. hrv_ms was written with one decimal (e.g. 67.3) into an integer column,
//      failing the entire row upsert.
//   2. sleep_quality could round to 0, violating the 1–10 check constraint —
//      again failing the entire row.
// Adds explicit retry for transient WHOOP API failures: max 3 attempts,
// exponential backoff (1s base, 30s cap, ±1s jitter). Terminal errors
// (auth, validation) fail immediately and are never retried.
// ----------------------------------------------------------------------------

import { createAdminClient } from "../supabase/admin";
import {
  WhoopApiError,
  fetchWhoopRecoveries,
  fetchWhoopSleeps,
  fetchWhoopCycles,
  refreshWhoopToken as requestWhoopTokenRefresh,
  type WhoopRecovery,
  type WhoopSleep,
  type WhoopCycle,
} from "./client";

type AdminClient = ReturnType<typeof createAdminClient>;

// ── Retry machinery ──────────────────────────────────────────────────────────

/**
 * Exponential backoff with jitter for retry logic.
 * Starts at 1s, caps at 30s, adds ±1s random jitter.
 * @param attempt Zero-indexed attempt number (0, 1, 2, ...)
 * @returns Milliseconds to wait before the next retry (never below 1s)
 */
export function exponentialBackoff(attempt: number): number {
  const base = Math.min(1000 * Math.pow(2, attempt), 30000);
  const jitter = Math.random() * 2000 - 1000;
  return Math.max(base + jitter, 1000);
}

/** Sleep utility for retry delays. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Classify an error as transient (retriable) or terminal (fail immediately).
 * Transient: rate limit (429), server error (5xx), network failure
 * (ECONNREFUSED / ETIMEDOUT / ECONNRESET, socket hang up, fetch failed).
 * Terminal: auth failure (401/403), validation errors, anything else.
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof WhoopApiError) {
    return error.status === 429 || error.status >= 500;
  }
  const e = error as {
    code?: string;
    message?: string;
    cause?: { code?: string };
  } | null;
  const code = e?.code ?? e?.cause?.code;
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "ECONNRESET") {
    return true;
  }
  if (
    typeof e?.message === "string" &&
    (e.message.includes("socket hang up") || e.message.includes("fetch failed"))
  ) {
    return true;
  }
  return false;
}

/**
 * Run `fn`, retrying transient failures up to `maxRetries` total attempts with
 * exponential backoff. Terminal errors are rethrown immediately; the last
 * transient error is rethrown once attempts are exhausted.
 * @param fn The operation to run
 * @param opts.maxRetries Total attempts (default 3)
 * @param opts.sleepFn Delay implementation — injectable for tests
 * @param opts.label Prefix for retry log lines
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    maxRetries?: number;
    sleepFn?: (ms: number) => Promise<void>;
    label?: string;
  } = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const wait = opts.sleepFn ?? sleep;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransientError(err) || attempt === maxRetries - 1) throw err;
      const backoffMs = exponentialBackoff(attempt);
      console.log(
        `${opts.label ?? "whoop"}: transient error (attempt ${attempt + 1}/${maxRetries}), retrying in ${Math.round(backoffMs)}ms:`,
        err instanceof Error ? err.message : String(err),
      );
      await wait(backoffMs);
    }
  }

  throw lastError; // unreachable, but keeps TS happy
}

// ── Data transformation ──────────────────────────────────────────────────────

/** Per-date sleep metrics distilled from a scored, non-nap WHOOP sleep. */
export interface SleepEntry {
  hours: number;
  efficiency: number | null;
  light_hours: number | null;
  sws_hours: number | null;
  rem_hours: number | null;
  disturbances: number | null;
  respiratory_rate: number | null;
}

function msToHours(ms: number): number {
  return Math.round((ms / 3_600_000) * 10) / 10;
}

/**
 * Index scored, non-nap sleeps by their end date (YYYY-MM-DD).
 * @returns Map of date → sleep metrics ready for transformWhoopData
 */
export function buildSleepByDate(sleeps: WhoopSleep[]): Map<string, SleepEntry> {
  const byDate = new Map<string, SleepEntry>();
  for (const sleep of sleeps) {
    if (sleep.nap || sleep.score_state !== "SCORED" || !sleep.score) continue;
    const date = sleep.end.slice(0, 10);
    const ss = sleep.score.stage_summary;
    const totalMs =
      ss.total_light_sleep_time_milli +
      ss.total_slow_wave_sleep_time_milli +
      ss.total_rem_sleep_time_milli;
    byDate.set(date, {
      hours: msToHours(totalMs),
      efficiency: sleep.score.sleep_efficiency_percentage ?? null,
      light_hours: msToHours(ss.total_light_sleep_time_milli),
      sws_hours: msToHours(ss.total_slow_wave_sleep_time_milli),
      rem_hours: msToHours(ss.total_rem_sleep_time_milli),
      disturbances: ss.disturbance_count ?? null,
      respiratory_rate: sleep.score.respiratory_rate ?? null,
    });
  }
  return byDate;
}

/**
 * Index scored cycle strain (1 decimal) by cycle start date (YYYY-MM-DD).
 */
export function buildStrainByDate(cycles: WhoopCycle[]): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const cycle of cycles) {
    if (cycle.score_state !== "SCORED" || !cycle.score) continue;
    byDate.set(cycle.start.slice(0, 10), Math.round(cycle.score.strain * 10) / 10);
  }
  return byDate;
}

/**
 * Transform one scored WHOOP recovery (plus that date's sleep and strain, if
 * any) into a daily_checkins row fragment. Applies the two bug fixes:
 *   - hrv_ms: true integer (column is int4; a fractional value fails the row)
 *   - sleep_quality: clamped to [1, 10] (check constraint; used to hit 0)
 * Fields with no real source value are omitted — never fabricated as 0 or 1.
 * @returns Row fragment (no user_id) or null if the recovery isn't scored.
 */
export function transformWhoopData(
  rec: WhoopRecovery,
  checkinDate: string,
  sleepEntry?: SleepEntry,
  strain?: number,
): Record<string, unknown> | null {
  if (rec.score_state !== "SCORED" || !rec.score) return null;

  const row: Record<string, unknown> = {
    checkin_date: checkinDate,
    recovery_score: Math.round(rec.score.recovery_score),
    hrv_ms: Math.round(rec.score.hrv_rmssd_milli),
    resting_hr: Math.round(rec.score.resting_heart_rate),
    spo2_percentage: rec.score.spo2_percentage ?? null,
    skin_temp_celsius: rec.score.skin_temp_celsius ?? null,
    whoop_strain: strain ?? null,
  };

  if (sleepEntry) {
    row.sleep_hours = sleepEntry.hours;
    if (sleepEntry.efficiency !== null) {
      row.sleep_quality = Math.min(
        10,
        Math.max(1, Math.round(sleepEntry.efficiency / 10)),
      );
    }
    row.sleep_light_hours = sleepEntry.light_hours;
    row.sleep_sws_hours = sleepEntry.sws_hours;
    row.sleep_rem_hours = sleepEntry.rem_hours;
    row.sleep_disturbances = sleepEntry.disturbances;
    row.respiratory_rate = sleepEntry.respiratory_rate;
  }

  return row;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export interface SyncWhoopResult {
  success: boolean;
  itemsSynced: number;
  errors: string[];
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Main WHOOP sync orchestrator: fetch recoveries + sleeps + cycles, transform
 * (applying the hrv_ms / sleep_quality fixes), upsert into daily_checkins on
 * (user_id, checkin_date). The fetch phase retries transient failures (max 3
 * attempts, exponential backoff); terminal errors fail immediately. Per-row
 * upsert errors are collected, never silently dropped.
 * @param athleteId Athlete's UUID (daily_checkins.user_id)
 * @param accessToken Valid WHOOP access token (refresh beforehand via
 *   getValidWhoopToken or refreshWhoopToken)
 * @param options.daysBack How far back to sync (default 30)
 * @param options.maxRetries Max fetch attempts (default 3)
 * @param options.admin Injectable Supabase service-role client
 * @param options.sleepFn Injectable retry delay — tests only
 * @returns success (no errors), itemsSynced (rows upserted), errors (exact messages)
 */
export async function syncWhoop(
  athleteId: string,
  accessToken: string,
  options: {
    daysBack?: number;
    maxRetries?: number;
    admin?: AdminClient;
    sleepFn?: (ms: number) => Promise<void>;
  } = {},
): Promise<SyncWhoopResult> {
  const { daysBack = 30, maxRetries = 3 } = options;
  const admin = options.admin ?? createAdminClient();
  const start = daysAgoISO(daysBack);

  let recoveries: WhoopRecovery[];
  let sleeps: WhoopSleep[];
  let cycles: WhoopCycle[];
  try {
    [recoveries, sleeps, cycles] = await withRetry(
      () =>
        Promise.all([
          fetchWhoopRecoveries(accessToken, start),
          fetchWhoopSleeps(accessToken, start),
          fetchWhoopCycles(accessToken, start),
        ]),
      { maxRetries, sleepFn: options.sleepFn, label: `whoop-sync:${athleteId}` },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const kind = isTransientError(err)
      ? `exhausted ${maxRetries} attempts`
      : "terminal error, no retry";
    return {
      success: false,
      itemsSynced: 0,
      errors: [`WHOOP fetch failed (${kind}): ${message}`],
    };
  }

  const sleepByDate = buildSleepByDate(sleeps);
  const strainByDate = buildStrainByDate(cycles);

  let itemsSynced = 0;
  const errors: string[] = [];

  for (const rec of recoveries) {
    const date = rec.created_at.slice(0, 10);
    const row = transformWhoopData(
      rec,
      date,
      sleepByDate.get(date),
      strainByDate.get(date),
    );
    if (!row) continue; // not scored yet — nothing real to write

    const { error } = await admin
      .from("daily_checkins")
      .upsert(
        { user_id: athleteId, ...row },
        { onConflict: "user_id,checkin_date", ignoreDuplicates: false },
      );

    if (error) {
      errors.push(`Upsert failed for ${date}: ${error.message}`);
    } else {
      itemsSynced++;
    }
  }

  return { success: errors.length === 0, itemsSynced, errors };
}

// ── Token refresh (non-destructive) ──────────────────────────────────────────

/**
 * Refresh an athlete's WHOOP access token in place.
 * On any failure: logs the exact error and returns false — the whoop_tokens
 * row is NEVER deleted here. The caller decides whether to retry or skip
 * this sync cycle.
 * @param athleteId Athlete's UUID
 * @param adminClient Injectable Supabase service-role client
 * @returns true if a fresh token was stored, false otherwise
 */
export async function refreshWhoopToken(
  athleteId: string,
  adminClient?: AdminClient,
): Promise<boolean> {
  const admin = adminClient ?? createAdminClient();
  try {
    const { data: tokenRow, error: fetchError } = await admin
      .from("whoop_tokens")
      .select("id, refresh_token")
      .eq("user_id", athleteId)
      .maybeSingle<{ id: string; refresh_token: string }>();

    if (fetchError || !tokenRow?.refresh_token) {
      console.error(`No WHOOP refresh token found for athlete ${athleteId}`);
      return false;
    }

    const fresh = await requestWhoopTokenRefresh({
      refresh_token: tokenRow.refresh_token,
    });

    const { error: updateError } = await admin
      .from("whoop_tokens")
      .update({
        access_token: fresh.access_token,
        refresh_token: fresh.refresh_token,
        expires_at: fresh.expires_at,
      })
      .eq("id", tokenRow.id);

    if (updateError) {
      console.error(
        `Failed to store refreshed WHOOP token for ${athleteId}:`,
        updateError,
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      `WHOOP token refresh failed for ${athleteId} (row preserved):`,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}
