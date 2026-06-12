// ----------------------------------------------------------------------------
// GET  /api/strava/webhook  — Strava subscription verification challenge
// POST /api/strava/webhook  — Strava event delivery (activity create/update/delete)
//
// Registration (one-time CLI step):
//   curl -X POST https://www.strava.com/api/v3/push_subscriptions \
//     -F client_id=$STRAVA_CLIENT_ID \
//     -F client_secret=$STRAVA_CLIENT_SECRET \
//     -F callback_url=https://your-domain/api/strava/webhook \
//     -F verify_token=$STRAVA_WEBHOOK_VERIFY_TOKEN
//
// ENV:
//   STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET  — Strava app credentials
//   STRAVA_WEBHOOK_VERIFY_TOKEN             — arbitrary secret you chose above
// ----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchStravaActivity,
  getValidAccessToken,
  mapActivityToSession,
  type StravaTokenRow,
} from "@/lib/strava";

// ── GET: subscription verification ───────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const challenge = searchParams.get("hub.challenge");
  const verifyToken = searchParams.get("hub.verify_token");

  if (mode !== "subscribe" || !challenge) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const expected = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  if (!expected || verifyToken !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Strava requires this exact response shape.
  return NextResponse.json({ "hub.challenge": challenge });
}

// ── POST: event delivery ──────────────────────────────────────────────────────

interface StravaEvent {
  object_type: string; // "activity" | "athlete"
  object_id: number; // activity ID or athlete ID
  aspect_type: string; // "create" | "update" | "delete"
  owner_id: number; // Strava athlete ID
  subscription_id: number;
  event_time: number; // unix seconds
  updates?: Record<string, string>; // on update: changed fields
}

export async function POST(request: Request) {
  let event: StravaEvent;
  try {
    event = (await request.json()) as StravaEvent;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // We only care about activity events.
  if (event.object_type !== "activity") {
    return NextResponse.json({ ok: true, skipped: "non_activity_event" });
  }

  const admin = createAdminClient();

  // Look up which user owns this Strava athlete.
  const { data: tokenRow, error: tokenErr } = await admin
    .from("strava_tokens")
    .select("*")
    .eq("strava_athlete_id", event.owner_id)
    .maybeSingle<StravaTokenRow>();

  if (tokenErr || !tokenRow) {
    // Athlete not connected to this app — nothing to do.
    return NextResponse.json({ ok: true, skipped: "athlete_not_found" });
  }

  if (event.aspect_type === "delete") {
    await admin
      .from("workout_sessions")
      .delete()
      .eq("strava_activity_id", event.object_id)
      .eq("user_id", tokenRow.user_id);
    return NextResponse.json({ ok: true, action: "deleted" });
  }

  // create or update — fetch full activity from Strava.
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(tokenRow, admin);
  } catch (err) {
    console.error("Strava token refresh failed", err);
    return NextResponse.json({ error: "token_refresh_failed" }, { status: 500 });
  }

  let activity;
  try {
    activity = await fetchStravaActivity(accessToken, event.object_id);
  } catch (err) {
    console.error("Strava activity fetch failed", err);
    return NextResponse.json({ error: "activity_fetch_failed" }, { status: 502 });
  }

  const sessionRow = mapActivityToSession(activity, tokenRow.user_id);

  // Check if this activity is already stored (idempotent update path).
  const { data: existing } = await admin
    .from("workout_sessions")
    .select("id")
    .eq("strava_activity_id", event.object_id)
    .eq("user_id", tokenRow.user_id)
    .maybeSingle<{ id: string }>();

  if (existing) {
    await admin
      .from("workout_sessions")
      .update({
        day_name: sessionRow.day_name,
        notes: sessionRow.notes,
        completed_at: sessionRow.completed_at,
        source_meta: sessionRow.source_meta,
      })
      .eq("id", existing.id);
    return NextResponse.json({ ok: true, action: "updated", id: existing.id });
  }

  // New activity — insert, skipping silently if that date already has a session.
  const { data: inserted, error: insertErr } = await admin
    .from("workout_sessions")
    .insert(sessionRow)
    .select("id")
    .single<{ id: string }>();

  if (insertErr) {
    // 23505 = unique_violation (date conflict with an existing manual session)
    if (insertErr.code === "23505") {
      return NextResponse.json({
        ok: true,
        skipped: "date_conflict",
        note: "A session already exists for this date; Strava import skipped.",
      });
    }
    console.error("workout_sessions insert failed", insertErr);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, action: "created", id: inserted?.id });
}
