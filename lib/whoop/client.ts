// WHOOP API client — OAuth helpers, token refresh, and data fetching.
// Server-only.

import type { createAdminClient } from "../supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WhoopTokenRow {
  id: string;
  user_id: string;
  whoop_user_id: number;
  access_token: string;
  refresh_token: string;
  expires_at: string; // ISO
  scope: string | null;
}

// WHOOP Recovery score (0–100)
export interface WhoopRecovery {
  cycle_id: number;
  sleep_id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  score_state: string; // "SCORED" | "PENDING_SLEEP" | "UNSCORABLE"
  score: {
    user_calibrating: boolean;
    recovery_score: number; // 0–100
    resting_heart_rate: number;
    hrv_rmssd_milli: number;
    spo2_percentage: number | null;
    skin_temp_celsius: number | null;
  } | null;
}

// WHOOP Sleep record
export interface WhoopSleep {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string; // ISO
  end: string; // ISO
  timezone_offset: string;
  nap: boolean;
  score_state: string;
  score: {
    stage_summary: {
      total_in_bed_time_milli: number;
      total_awake_time_milli: number;
      total_no_data_time_milli: number;
      total_light_sleep_time_milli: number;
      total_slow_wave_sleep_time_milli: number;
      total_rem_sleep_time_milli: number;
      sleep_cycle_count: number;
      disturbance_count: number;
    };
    sleep_needed: {
      baseline_milli: number;
      need_from_sleep_debt_milli: number;
      need_from_recent_strain_milli: number;
      need_from_recent_nap_milli: number;
    };
    respiratory_rate: number;
    sleep_performance_percentage: number;
    sleep_consistency_percentage: number;
    sleep_efficiency_percentage: number;
  } | null;
}

// WHOOP Workout
export interface WhoopWorkout {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string;
  timezone_offset: string;
  sport_id: number; // WHOOP sport enum
  score_state: string;
  score: {
    strain: number; // 0–21
    average_heart_rate: number;
    max_heart_rate: number;
    kilojoule: number;
    percent_recorded: number;
    distance_meter: number | null;
    altitude_gain_meter: number | null;
    altitude_change_meter: number | null;
    zone_duration: {
      zone_zero_milli: number;
      zone_one_milli: number;
      zone_two_milli: number;
      zone_three_milli: number;
      zone_four_milli: number;
      zone_five_milli: number;
    };
  } | null;
}

// WHOOP Cycle (daily strain)
export interface WhoopCycle {
  id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  start: string;
  end: string | null;
  timezone_offset: string;
  score_state: string;
  score: {
    strain: number;
    kilojoule: number;
    average_heart_rate: number;
    max_heart_rate: number;
  } | null;
}

// WHOOP Body Measurement
export interface WhoopBodyMeasurement {
  height_meter: number;
  weight_kilogram: number;
  max_heart_rate: number;
}

// ── Errors ────────────────────────────────────────────────────────────────────

// Error carrying the WHOOP HTTP status so callers can classify it:
// 429/5xx are transient (retriable), 401/403 are terminal (auth is dead).
export class WhoopApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "WhoopApiError";
  }
}

// ── Token management ──────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds from now
  token_type: string;
  scope: string;
}

export async function refreshWhoopToken(
  token: Pick<WhoopTokenRow, "refresh_token">,
): Promise<{ access_token: string; refresh_token: string; expires_at: string }> {
  const res = await fetch("https://api.prod.whoop.com/oauth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.WHOOP_CLIENT_ID ?? "",
      client_secret: process.env.WHOOP_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
      scope: "read:recovery read:sleep read:workout read:cycles read:body_measurement read:profile",
    }),
  });

  if (!res.ok) {
    throw new WhoopApiError(
      `WHOOP token refresh failed: ${res.status} ${await res.text()}`,
      res.status,
    );
  }

  const data = (await res.json()) as TokenResponse;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

// Returns a valid access token, refreshing if near expiry.
// Handles the WHOOP single-use refresh token race condition: if multiple
// concurrent requests all try to refresh the same token, only one wins.
// Losers re-read the DB to pick up the winner's fresh token.
// On refresh failure the token row is PRESERVED — a transient WHOOP outage
// must never force the athlete to reconnect. The error propagates so the
// caller logs it and skips this sync cycle.
export async function getValidWhoopToken(
  tokenRow: WhoopTokenRow,
  admin: AdminClient,
): Promise<string> {
  const expiresAt = new Date(tokenRow.expires_at).getTime();
  if (Date.now() < expiresAt - 5 * 60 * 1000) {
    return tokenRow.access_token;
  }

  try {
    const fresh = await refreshWhoopToken(tokenRow);
    await admin
      .from("whoop_tokens")
      .update({
        access_token: fresh.access_token,
        refresh_token: fresh.refresh_token,
        expires_at: fresh.expires_at,
      })
      .eq("id", tokenRow.id);
    return fresh.access_token;
  } catch (refreshErr) {
    // Refresh failed. WHOOP tokens are single-use — a concurrent request may
    // have already refreshed and stored a new token. Re-read the DB to check.
    const { data: latestRow } = await admin
      .from("whoop_tokens")
      .select("access_token, refresh_token, expires_at")
      .eq("id", tokenRow.id)
      .maybeSingle();

    if (latestRow && latestRow.expires_at !== tokenRow.expires_at) {
      // Another request won the race — use the token it stored.
      return latestRow.access_token;
    }

    // Refresh failed and nobody else refreshed either. Keep the row (deleting
    // it on a transient failure would force a pointless reconnect) and let the
    // caller skip this sync cycle.
    console.error(
      `WHOOP token refresh failed for user ${tokenRow.user_id}; row preserved, skipping this sync cycle.`,
      refreshErr,
    );
    throw new Error(`WHOOP token refresh failed; skipping sync. Cause: ${refreshErr}`);
  }
}

// ── WHOOP API calls ───────────────────────────────────────────────────────────

const WHOOP_BASE = "https://api.prod.whoop.com/developer/v2";

async function whoopGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${WHOOP_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new WhoopApiError(
      `WHOOP API error ${path}: ${res.status} ${await res.text()}`,
      res.status,
    );
  }

  return res.json() as Promise<T>;
}

// Paginated list helper — WHOOP uses cursor-based pagination
async function whoopGetAll<T>(
  accessToken: string,
  path: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const results: T[] = [];
  let nextToken: string | undefined;

  do {
    const query = new URLSearchParams({ limit: "25", ...params });
    if (nextToken) query.set("nextToken", nextToken);

    const data = (await whoopGet<{ records: T[]; next_token?: string }>(
      accessToken,
      `${path}?${query}`,
    ));

    results.push(...data.records);
    nextToken = data.next_token;
  } while (nextToken);

  return results;
}

export async function fetchWhoopProfile(
  accessToken: string,
): Promise<{ user_id: number; email: string; first_name: string; last_name: string }> {
  return whoopGet(accessToken, "/user/profile/basic");
}

export async function fetchWhoopBodyMeasurement(
  accessToken: string,
): Promise<WhoopBodyMeasurement> {
  return whoopGet(accessToken, "/user/measurement/body");
}

export async function fetchWhoopRecoveries(
  accessToken: string,
  start?: string,
  end?: string,
): Promise<WhoopRecovery[]> {
  const params: Record<string, string> = {};
  if (start) params.start = start;
  if (end) params.end = end;
  return whoopGetAll<WhoopRecovery>(accessToken, "/recovery", params);
}

export async function fetchWhoopSleeps(
  accessToken: string,
  start?: string,
  end?: string,
): Promise<WhoopSleep[]> {
  const params: Record<string, string> = {};
  if (start) params.start = start;
  if (end) params.end = end;
  return whoopGetAll<WhoopSleep>(accessToken, "/activity/sleep", params);
}

export async function fetchWhoopWorkouts(
  accessToken: string,
  start?: string,
  end?: string,
): Promise<WhoopWorkout[]> {
  const params: Record<string, string> = {};
  if (start) params.start = start;
  if (end) params.end = end;
  return whoopGetAll<WhoopWorkout>(accessToken, "/activity/workout", params);
}

export async function fetchWhoopCycles(
  accessToken: string,
  start?: string,
  end?: string,
): Promise<WhoopCycle[]> {
  const params: Record<string, string> = {};
  if (start) params.start = start;
  if (end) params.end = end;
  return whoopGetAll<WhoopCycle>(accessToken, "/cycle", params);
}

// ── OAuth helpers ─────────────────────────────────────────────────────────────

const WHOOP_SCOPES = [
  "read:recovery",
  "read:sleep",
  "read:workout",
  "read:cycles",
  "read:body_measurement",
  "read:profile",
].join(" ");

export function whoopAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.WHOOP_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: WHOOP_SCOPES,
    state,
  });
  return `https://api.prod.whoop.com/oauth/oauth2/auth?${params}`;
}

export async function exchangeWhoopCode(
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const res = await fetch("https://api.prod.whoop.com/oauth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.WHOOP_CLIENT_ID ?? "",
      client_secret: process.env.WHOOP_CLIENT_SECRET ?? "",
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    throw new Error(`WHOOP code exchange failed: ${res.status} ${await res.text()}`);
  }

  return res.json() as Promise<TokenResponse>;
}
