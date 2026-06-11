// ----------------------------------------------------------------------------
// POST /api/admin/generate-coach-response
//
// Admin-only. Gathers everything we know about one athlete, asks Claude to draft
// a daily coaching decision, and saves it as a DRAFT coach_response. The draft is
// NOT visible to the athlete — the admin reviews, edits, and approves it first
// (RLS only shows status = 'sent' responses to athletes).
//
// The ANTHROPIC_API_KEY never leaves the server: the browser only calls this
// route, which calls Claude server-side.
//
// Body: { user_id: string, response_date?: "YYYY-MM-DD" }
// Returns: { ok: true, id } | { ok: false, error }
// ----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateCoachDraft, type CoachContext, type ChatTurn } from "@/lib/coach-ai";
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

// Drafting can take 10–20s on a larger model; give it room.
export const maxDuration = 60;

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  const supabase = await createClient();

  // 1. Authenticate + authorize: must be a signed-in admin.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return bad("Not signed in.", 401);

  const { data: me } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (me?.role !== "admin") return bad("Admins only.", 403);

  // Service-role client for all athlete data access — bypasses RLS so a gap
  // in an admin policy can never silently return partial context to Claude.
  const admin = createAdminClient();

  // 2. Parse input.
  let body: { user_id?: string; response_date?: string };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request body.");
  }
  const userId = typeof body.user_id === "string" ? body.user_id : "";
  if (!userId) return bad("Missing user_id.");
  const responseDate =
    typeof body.response_date === "string" && DATE_RE.test(body.response_date)
      ? body.response_date
      : todayISO();

  // 3. Gather the athlete's full context (service role — bypasses RLS).
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
  if (!userRec) return bad("Athlete not found.", 404);

  const profile = (profileRes.data as AthleteProfile) ?? null;
  const checkins = (checkinsRes.data as DailyCheckin[]) ?? [];

  // Nothing to reason about — don't waste an API call or invent data.
  if (!profile && checkins.length === 0) {
    return bad(
      "This athlete has no profile or check-ins yet — there's nothing to draft from.",
    );
  }

  // Recent chat (last ~7 days) so the draft reflects what the athlete told the
  // coach between daily reports.
  const chatSince = new Date(
    Date.parse(responseDate + "T00:00:00Z") - 7 * 86400000,
  ).toISOString();
  const { data: messageRows } = await admin
    .from("coach_messages")
    .select("role, body, created_at")
    .eq("user_id", userId)
    .gte("created_at", chatSince)
    .order("created_at", { ascending: true })
    .limit(40);
  const recentMessages: ChatTurn[] = (
    (messageRows as { role: "athlete" | "coach"; body: string }[]) ?? []
  ).map((m) => ({ role: m.role, body: m.body }));

  const ctx: CoachContext = {
    athleteName: userRec.full_name || profile?.full_name || userRec.email || null,
    today: responseDate,
    profile,
    latestCheckin: checkins[0] ?? null,
    recentCheckins: checkins,
    screenshots: (shotsRes.data as UploadedScreenshot[]) ?? [],
    memoryNotes: (memoryRes.data as AthleteMemoryNote[]) ?? [],
    previousResponses: (responsesRes.data as CoachResponse[]) ?? [],
    predictions: (predictionsRes.data as PredictionWithOutcome[]) ?? [],
    feedback: (feedbackRes.data as UserFeedback[]) ?? [],
    recentMessages,
  };

  // 4. Ask Claude for the draft.
  let draft;
  try {
    draft = await generateCoachDraft(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error generating draft.";
    return bad(message, 502);
  }

  // 5. Replace any existing AI draft for this day (keeps "regenerate" clean),
  //    then save the fresh draft. Sent responses and hand-written drafts are
  //    never touched.
  await admin
    .from("coach_responses")
    .delete()
    .eq("user_id", userId)
    .eq("response_date", responseDate)
    .eq("status", "draft")
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
      status: "draft",
      ai_generated: true,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    return bad(insertError?.message ?? "Could not save the draft.", 500);
  }

  return NextResponse.json({ ok: true, id: inserted.id as string });
}
