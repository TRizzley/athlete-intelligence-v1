// ----------------------------------------------------------------------------
// POST /api/coach/auto-respond
//
// Fully-automatic daily coaching decision for the SIGNED-IN athlete.
//
// Flow: the athlete checks in and uploads their screenshots; the dashboard and
// the upload form ping this route. It gathers everything we know about them,
// asks Claude for a decision, and SENDS it straight to the athlete (status =
// 'sent') with no human review step.
//
// It is idempotent and cheap to call repeatedly: it only (re)generates when
// there is genuinely new data since the last auto response, so calling it on
// every dashboard load is safe.
//
// Auth: the caller is authenticated via their session; the actual data access
// and write use the service-role client (RLS forbids athletes from inserting
// coach_responses), always scoped to the caller's own user_id.
// ----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateCoachDraft, type CoachContext } from "@/lib/coach-ai";
import { todayISO } from "@/lib/format";
import type {
  AthleteProfile,
  DailyCheckin,
  UploadedScreenshot,
  CoachResponse,
  PredictionWithOutcome,
  UserFeedback,
  AthleteMemoryNote,
} from "@/lib/types";

// Drafting can take 10-20s; give it room.
export const maxDuration = 60;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function tsOf(s: string | null | undefined): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

export async function POST(request: Request) {
  // 1. Who is calling (must be signed in). We act only on their own data.
  const session = await createClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return json({ ok: false, error: "Not signed in." }, 401);

  let body: { date?: string } = {};
  try {
    body = await request.json();
  } catch {
    /* body is optional */
  }
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const responseDate =
    typeof body.date === "string" && DATE_RE.test(body.date) ? body.date : todayISO();

  const userId = user.id;
  const admin = createAdminClient();

  // 2. Gather the athlete's full context (service role bypasses RLS).
  const [
    userRes,
    profileRes,
    checkinsRes,
    shotsRes,
    responsesRes,
    predictionsRes,
    feedbackRes,
    memoryRes,
  ] = await Promise.all([
    admin.from("users").select("full_name, email").eq("id", userId).maybeSingle(),
    admin.from("athlete_profiles").select("*").eq("user_id", userId).maybeSingle(),
    admin
      .from("daily_checkins")
      .select("*")
      .eq("user_id", userId)
      .order("checkin_date", { ascending: false })
      .limit(8),
    admin
      .from("uploaded_screenshots")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(12),
    admin
      .from("coach_responses")
      .select("*")
      .eq("user_id", userId)
      .order("response_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(10),
    admin
      .from("predictions")
      .select("*, prediction_outcomes(*)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(12),
    admin
      .from("user_feedback")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(12),
    admin
      .from("athlete_memory_notes")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  const userRec = userRes.data as { full_name: string | null; email: string | null } | null;
  const profile = (profileRes.data as AthleteProfile) ?? null;
  const checkins = (checkinsRes.data as DailyCheckin[]) ?? [];
  const screenshots = (shotsRes.data as UploadedScreenshot[]) ?? [];
  const previousResponses = (responsesRes.data as CoachResponse[]) ?? [];

  // 3. Guard: need something to reason from.
  if (!profile && checkins.length === 0) {
    return json({ ok: true, skipped: "no data yet" });
  }
  // Require a check-in for the target day so we don't send a decision before
  // the athlete has actually checked in.
  const todaysCheckin = checkins.find((c) => c.checkin_date === responseDate) ?? null;
  if (!todaysCheckin) {
    return json({ ok: true, skipped: "no check-in for today yet" });
  }

  // 4. Idempotency: only regenerate when data is newer than the last auto send.
  const dataTs = Math.max(
    tsOf(todaysCheckin.updated_at),
    ...screenshots
      .filter((s) => !s.capture_date || s.capture_date === responseDate)
      .map((s) => tsOf(s.created_at)),
    0,
  );
  const existingAuto = previousResponses.find(
    (r) => r.response_date === responseDate && r.ai_generated,
  );
  if (existingAuto && tsOf(existingAuto.created_at) >= dataTs) {
    return json({ ok: true, skipped: "already up to date", id: existingAuto.id });
  }

  // 5. Build context and ask Claude for the decision.
  const ctx: CoachContext = {
    athleteName: userRec?.full_name || profile?.full_name || userRec?.email || null,
    today: responseDate,
    profile,
    latestCheckin: checkins[0] ?? null,
    recentCheckins: checkins,
    screenshots,
    memoryNotes: (memoryRes.data as AthleteMemoryNote[]) ?? [],
    previousResponses,
    predictions: (predictionsRes.data as PredictionWithOutcome[]) ?? [],
    feedback: (feedbackRes.data as UserFeedback[]) ?? [],
  };

  let draft;
  try {
    draft = await generateCoachDraft(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error generating decision.";
    return json({ ok: false, error: message }, 502);
  }

  // 6. Replace any prior auto response for the day, then SEND the fresh one.
  await admin
    .from("coach_responses")
    .delete()
    .eq("user_id", userId)
    .eq("response_date", responseDate)
    .eq("ai_generated", true);

  const { data: inserted, error: insertError } = await admin
    .from("coach_responses")
    .insert({
      user_id: userId,
      response_date: responseDate,
      what_noticed: draft.what_noticed || null,
      why_it_matters: draft.why_it_matters || null,
      recommendation: draft.recommendation || null,
      prediction: draft.prediction || null,
      confidence: draft.confidence,
      data_used: draft.data_used || null,
      athlete_question: draft.athlete_question || null,
      status: "sent",
      ai_generated: true,
      created_by: userId,
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return json({ ok: false, error: insertError?.message ?? "Could not save the response." }, 500);
  }

  return json({ ok: true, id: inserted.id as string, sent: true });
}
