// ----------------------------------------------------------------------------
// POST /api/athlete/workouts/:workoutId/eval
//
// The athlete's post-workout SELF-EVALUATION: RPE (1-10, required) plus an
// optional one-liner ("felt strong", "hit plateau"). This is the raw signal
// the coach layer reads to personalize future suggestions (Milestone A).
//
// One eval per workout session: re-submitting upserts on workout_id, so the
// latest submission wins and no duplicate rows accumulate.
//
// Auth: the caller's own session via the user-scoped client. RLS enforces
// ownership (an athlete can only read/write rows where user_id = auth.uid()),
// and we also verify the workout session belongs to the caller before writing
// so a foreign workoutId returns 404 rather than an opaque RLS error.
// ----------------------------------------------------------------------------

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Max length for the optional free-text feedback (mirrors the DB CHECK). */
const FEEDBACK_MAX_CHARS = 200;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

/**
 * Handles an athlete's post-workout self-eval submission.
 *
 * Request body: `{ rpe: number, feedback?: string }`
 *   - `rpe` — integer 1-10 (Rate of Perceived Exertion), required
 *   - `feedback` — optional one-liner, max 200 characters
 *
 * Responses:
 *   - 200 `{ ok: true, eval }` — saved (insert or overwrite)
 *   - 400 — malformed workoutId, unparseable body, or invalid rpe/feedback
 *   - 401 — not signed in
 *   - 404 — workout session not found or owned by another athlete
 *   - 500 — unexpected database failure
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workoutId: string }> },
) {
  const { workoutId } = await params;
  if (!UUID_RE.test(workoutId)) {
    return json({ ok: false, error: "Invalid workout id." }, 400);
  }

  // 1. Who is calling (must be signed in). We act only on their own data.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json({ ok: false, error: "Not signed in." }, 401);

  // 2. Parse + validate the body.
  let body: { rpe?: unknown; feedback?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const { rpe, feedback } = body;

  if (typeof rpe !== "number" || !Number.isInteger(rpe) || rpe < 1 || rpe > 10) {
    return json(
      { ok: false, error: "RPE must be an integer between 1 and 10." },
      400,
    );
  }

  if (feedback !== undefined && feedback !== null) {
    if (typeof feedback !== "string") {
      return json({ ok: false, error: "Feedback must be text." }, 400);
    }
    if (feedback.length > FEEDBACK_MAX_CHARS) {
      return json(
        {
          ok: false,
          error: `Feedback must be under ${FEEDBACK_MAX_CHARS} characters.`,
        },
        400,
      );
    }
  }

  const feedbackText =
    typeof feedback === "string" && feedback.trim() !== ""
      ? feedback.trim()
      : null;

  // 3. The workout session must exist and belong to the caller. RLS already
  //    hides other athletes' sessions, so a foreign id looks identical to a
  //    missing one: both 404.
  const { data: workout, error: workoutError } = await supabase
    .from("workout_sessions")
    .select("id, user_id")
    .eq("id", workoutId)
    .maybeSingle();

  if (workoutError) {
    console.error(
      `[self-eval] workout lookup failed for user=${user.id} workout=${workoutId}:`,
      workoutError.message,
    );
    return json({ ok: false, error: "Could not look up workout." }, 500);
  }
  if (!workout || workout.user_id !== user.id) {
    return json({ ok: false, error: "Workout not found." }, 404);
  }

  // 4. Upsert: one eval per workout, latest submission wins.
  const { data: evalRow, error: upsertError } = await supabase
    .from("workout_self_evals")
    .upsert(
      {
        user_id: user.id,
        workout_id: workoutId,
        rpe,
        feedback: feedbackText,
      },
      { onConflict: "workout_id" },
    )
    .select()
    .single();

  if (upsertError) {
    console.error(
      `[self-eval] upsert failed for user=${user.id} workout=${workoutId}:`,
      upsertError.message,
    );
    return json({ ok: false, error: "Failed to save evaluation." }, 500);
  }

  console.log(`[self-eval] saved for user=${user.id} workout=${workoutId} rpe=${rpe}`);

  return json({ ok: true, eval: evalRow });
}
