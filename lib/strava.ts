// Strava API client utilities — token refresh, activity fetch, and mapping
// to the local workout_sessions schema. Server-only.

import type { createAdminClient } from "./supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StravaTokenRow {
  id: string;
  user_id: string;
  strava_athlete_id: number;
  access_token: string;
  refresh_token: string;
  expires_at: string; // ISO
  scope: string | null;
}

// Subset of Strava's DetailedActivity we actually use.
export interface StravaActivity {
  id: number;
  name: string;
  sport_type: string;
  type: string; // legacy fallback
  start_date: string; // UTC ISO 8601
  start_date_local: string; // local time, no tz offset ("2024-01-15T08:30:00Z")
  elapsed_time: number; // seconds
  moving_time: number; // seconds
  distance: number; // meters
  total_elevation_gain: number; // meters
  average_speed: number; // m/s
  average_heartrate?: number;
  max_heartrate?: number;
  average_watts?: number; // cycling
  kilojoules?: number; // cycling
  suffer_score?: number;
  perceived_exertion?: number; // 0–10
  calories?: number;
  description?: string | null;
  athlete: { id: number };
}

// What we write to workout_sessions.
export interface SessionRow {
  user_id: string;
  strava_activity_id: number;
  source: "strava";
  day_name: string;
  session_date: string; // YYYY-MM-DD
  notes: string;
  status: "completed";
  completed_at: string; // ISO
  source_meta: StravaActivity;
}

// ── Token management ──────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  scope?: string;
  athlete?: { id: number };
}

export async function refreshStravaToken(
  token: Pick<StravaTokenRow, "refresh_token">,
): Promise<{ access_token: string; refresh_token: string; expires_at: string }> {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: token.refresh_token,
    }),
  });

  if (!res.ok) {
    throw new Error(`Strava token refresh failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as TokenResponse;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: new Date(data.expires_at * 1000).toISOString(),
  };
}

// Returns a valid access token, refreshing if the stored one has expired.
// Pass the admin Supabase client so we can write the new tokens back.
export async function getValidAccessToken(
  tokenRow: StravaTokenRow,
  admin: AdminClient,
): Promise<string> {
  const expiresAt = new Date(tokenRow.expires_at).getTime();
  // Refresh if expired or within 5 minutes.
  if (Date.now() < expiresAt - 5 * 60 * 1000) {
    return tokenRow.access_token;
  }

  const fresh = await refreshStravaToken(tokenRow);

  // Persist fresh tokens.
  await admin
    .from("strava_tokens")
    .update({
      access_token: fresh.access_token,
      refresh_token: fresh.refresh_token,
      expires_at: fresh.expires_at,
    })
    .eq("id", tokenRow.id);

  return fresh.access_token;
}

// ── Strava API calls ──────────────────────────────────────────────────────────

export async function fetchStravaActivity(
  accessToken: string,
  activityId: number,
): Promise<StravaActivity> {
  const res = await fetch(
    `https://www.strava.com/api/v3/activities/${activityId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (!res.ok) {
    throw new Error(`Strava activity fetch failed: ${res.status} ${await res.text()}`);
  }

  return res.json() as Promise<StravaActivity>;
}

// ── Activity → session mapping ────────────────────────────────────────────────

function fmtSeconds(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function fmtDistance(meters: number, sportType: string): string {
  const isSwim = sportType.toLowerCase().includes("swim");
  if (isSwim) {
    return meters >= 1000
      ? `${(meters / 1000).toFixed(2)} km`
      : `${Math.round(meters)} m`;
  }
  // km for running/cycling
  return `${(meters / 1000).toFixed(2)} km`;
}

function buildNotes(a: StravaActivity): string {
  const parts: string[] = [a.sport_type || a.type];

  if (a.distance > 0) parts.push(fmtDistance(a.distance, a.sport_type));
  parts.push(`${fmtSeconds(a.elapsed_time)} elapsed`);
  if (a.moving_time && a.moving_time !== a.elapsed_time) {
    parts.push(`${fmtSeconds(a.moving_time)} moving`);
  }
  if (a.average_heartrate) parts.push(`avg HR ${Math.round(a.average_heartrate)} bpm`);
  if (a.max_heartrate) parts.push(`max HR ${Math.round(a.max_heartrate)} bpm`);
  if (a.total_elevation_gain > 0) {
    parts.push(`${Math.round(a.total_elevation_gain)} m gain`);
  }
  if (a.average_watts) parts.push(`${Math.round(a.average_watts)} W avg`);
  if (a.kilojoules) parts.push(`${Math.round(a.kilojoules)} kJ`);
  if (a.calories) parts.push(`${Math.round(a.calories)} kcal`);
  if (a.perceived_exertion) parts.push(`RPE ${a.perceived_exertion}/10`);
  if (a.description?.trim()) parts.push(`"${a.description.trim()}"`);

  return `[Strava] ${parts.join(" | ")}`;
}

export function mapActivityToSession(
  activity: StravaActivity,
  userId: string,
): SessionRow {
  const sessionDate = activity.start_date_local.slice(0, 10);
  const completedAt = new Date(
    new Date(activity.start_date_local.replace("Z", "")).getTime() +
      activity.elapsed_time * 1000,
  ).toISOString();

  return {
    user_id: userId,
    strava_activity_id: activity.id,
    source: "strava",
    day_name: activity.name,
    session_date: sessionDate,
    notes: buildNotes(activity),
    status: "completed",
    completed_at: completedAt,
    source_meta: activity,
  };
}

// ── OAuth helpers ─────────────────────────────────────────────────────────────

export function stravaAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: "activity:read_all",
    state,
  });
  return `https://www.strava.com/oauth/authorize?${params}`;
}

export async function exchangeStravaCode(
  code: string,
  redirectUri: string,
): Promise<TokenResponse & { athlete: { id: number } }> {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    throw new Error(`Strava code exchange failed: ${res.status} ${await res.text()}`);
  }

  return res.json() as Promise<TokenResponse & { athlete: { id: number } }>;
}
