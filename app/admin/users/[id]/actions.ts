"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { computeTrustMetrics } from "@/lib/metrics";
import type { PredictionOutcome, UserFeedback } from "@/lib/types";

export type FormState = { error: string | null; ok?: boolean };

const OK: FormState = { error: null, ok: true };

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

async function ensureAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null as null | { id: string } };
  const { data } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (data?.role !== "admin") return { supabase, user: null };
  return { supabase, user };
}

function refresh(userId: string) {
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin");
}

// The day after a YYYY-MM-DD date.
function nextDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// When a coach response is SENT, log its prediction as a tracked, scoreable
// prediction (feeds the accuracy metric). Idempotent: skips if this response
// already has one, or if there's no prediction text.
async function ensureTrackedPrediction(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: {
    coachResponseId: string;
    userId: string;
    predictionText: string | null;
    confidence: string | null;
    responseDate: string;
    createdBy: string;
  },
): Promise<void> {
  if (!args.predictionText) return;
  const { data: existing } = await supabase
    .from("predictions")
    .select("id")
    .eq("coach_response_id", args.coachResponseId)
    .limit(1);
  if (existing && existing.length > 0) return;
  await supabase.from("predictions").insert({
    user_id: args.userId,
    coach_response_id: args.coachResponseId,
    prediction_text: args.predictionText,
    horizon: "tomorrow",
    confidence: args.confidence,
    target_date: nextDay(args.responseDate),
    created_by: args.createdBy,
  });
}

// ---------------------------------------------------------------------------
// Coach responses
// ---------------------------------------------------------------------------
export async function saveCoachResponse(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await ensureAdmin();
  if (!user) return { error: "Not authorized." };

  const userId = str(formData, "user_id");
  if (!userId) return { error: "Missing athlete." };

  const responseId = str(formData, "response_id");
  const intent = str(formData, "intent") ?? "draft";
  const status = intent === "send" ? "sent" : "draft";

  const fields = {
    user_id: userId,
    response_date: str(formData, "response_date") ?? new Date().toISOString().slice(0, 10),
    what_noticed: str(formData, "what_noticed"),
    why_it_matters: str(formData, "why_it_matters"),
    recommendation: str(formData, "recommendation"),
    prediction: str(formData, "prediction"),
    confidence: str(formData, "confidence"),
    data_used: str(formData, "data_used"),
    athlete_question: str(formData, "athlete_question"),
    status,
  };

  if (responseId) {
    const update: Record<string, unknown> = { ...fields };
    if (status === "sent") update.sent_at = new Date().toISOString();
    const { error } = await supabase
      .from("coach_responses")
      .update(update)
      .eq("id", responseId);
    if (error) return { error: error.message };
    if (status === "sent") {
      await ensureTrackedPrediction(supabase, {
        coachResponseId: responseId,
        userId,
        predictionText: fields.prediction,
        confidence: fields.confidence,
        responseDate: fields.response_date,
        createdBy: user.id,
      });
    }
  } else {
    const insert: Record<string, unknown> = { ...fields, created_by: user.id };
    if (status === "sent") insert.sent_at = new Date().toISOString();
    const { data: created, error } = await supabase
      .from("coach_responses")
      .insert(insert)
      .select("id")
      .single();
    if (error) return { error: error.message };
    if (status === "sent" && created) {
      await ensureTrackedPrediction(supabase, {
        coachResponseId: created.id as string,
        userId,
        predictionText: fields.prediction,
        confidence: fields.confidence,
        responseDate: fields.response_date,
        createdBy: user.id,
      });
    }
  }

  refresh(userId);
  return OK;
}

export async function sendCoachResponse(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await ensureAdmin();
  if (!user) return { error: "Not authorized." };
  const id = str(formData, "response_id");
  const userId = str(formData, "user_id");
  if (!id || !userId) return { error: "Missing reference." };

  const { error } = await supabase
    .from("coach_responses")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  // Log the response's prediction as a tracked, scoreable prediction.
  const { data: row } = await supabase
    .from("coach_responses")
    .select("prediction, response_date, confidence")
    .eq("id", id)
    .maybeSingle();
  if (row) {
    const r = row as { prediction: string | null; response_date: string; confidence: string | null };
    await ensureTrackedPrediction(supabase, {
      coachResponseId: id,
      userId,
      predictionText: r.prediction,
      confidence: r.confidence,
      responseDate: r.response_date,
      createdBy: user.id,
    });
  }

  refresh(userId);
  return OK;
}

export async function deleteCoachResponse(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await ensureAdmin();
  if (!user) return { error: "Not authorized." };
  const id = str(formData, "response_id");
  const userId = str(formData, "user_id");
  if (!id || !userId) return { error: "Missing reference." };

  const { error } = await supabase.from("coach_responses").delete().eq("id", id);
  if (error) return { error: error.message };

  refresh(userId);
  return OK;
}

// ---------------------------------------------------------------------------
// Predictions + outcomes
// ---------------------------------------------------------------------------
export async function createPrediction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await ensureAdmin();
  if (!user) return { error: "Not authorized." };

  const userId = str(formData, "user_id");
  const text = str(formData, "prediction_text");
  if (!userId) return { error: "Missing athlete." };
  if (!text) return { error: "Enter a prediction." };

  const { error } = await supabase.from("predictions").insert({
    user_id: userId,
    prediction_text: text,
    horizon: str(formData, "horizon") ?? "tomorrow",
    confidence: str(formData, "confidence"),
    target_date: str(formData, "target_date"),
    coach_response_id: str(formData, "coach_response_id"),
    created_by: user.id,
  });
  if (error) return { error: error.message };

  refresh(userId);
  return OK;
}

export async function recordOutcome(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await ensureAdmin();
  if (!user) return { error: "Not authorized." };

  const userId = str(formData, "user_id");
  const predictionId = str(formData, "prediction_id");
  const outcome = str(formData, "outcome");
  if (!userId || !predictionId) return { error: "Missing reference." };
  if (!outcome) return { error: "Choose an outcome." };

  const { error } = await supabase.from("prediction_outcomes").upsert(
    {
      prediction_id: predictionId,
      outcome,
      notes: str(formData, "notes"),
      recorded_by: user.id,
      recorded_at: new Date().toISOString(),
    },
    { onConflict: "prediction_id" },
  );
  if (error) return { error: error.message };

  refresh(userId);
  return OK;
}

export async function deletePrediction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await ensureAdmin();
  if (!user) return { error: "Not authorized." };
  const userId = str(formData, "user_id");
  const id = str(formData, "prediction_id");
  if (!userId || !id) return { error: "Missing reference." };

  const { error } = await supabase.from("predictions").delete().eq("id", id);
  if (error) return { error: error.message };

  refresh(userId);
  return OK;
}

// ---------------------------------------------------------------------------
// Memory notes
// ---------------------------------------------------------------------------
export async function addMemoryNote(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await ensureAdmin();
  if (!user) return { error: "Not authorized." };

  const userId = str(formData, "user_id");
  const note = str(formData, "note");
  if (!userId) return { error: "Missing athlete." };
  if (!note) return { error: "Write a note." };

  const { error } = await supabase.from("athlete_memory_notes").insert({
    user_id: userId,
    category: str(formData, "category"),
    note,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  refresh(userId);
  return OK;
}

export async function deleteMemoryNote(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await ensureAdmin();
  if (!user) return { error: "Not authorized." };
  const userId = str(formData, "user_id");
  const id = str(formData, "note_id");
  if (!userId || !id) return { error: "Missing reference." };

  const { error } = await supabase.from("athlete_memory_notes").delete().eq("id", id);
  if (error) return { error: error.message };

  refresh(userId);
  return OK;
}

// ---------------------------------------------------------------------------
// Trust metric snapshot — recompute from current feedback + outcomes and save.
// ---------------------------------------------------------------------------
export async function saveTrustSnapshot(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { supabase, user } = await ensureAdmin();
  if (!user) return { error: "Not authorized." };
  const userId = str(formData, "user_id");
  if (!userId) return { error: "Missing athlete." };

  const [{ data: feedback }, { data: predictions }] = await Promise.all([
    supabase.from("user_feedback").select("*").eq("user_id", userId),
    supabase
      .from("predictions")
      .select("id, prediction_outcomes(*)")
      .eq("user_id", userId),
  ]);

  const fb = (feedback as UserFeedback[]) ?? [];
  const preds = (predictions as { prediction_outcomes: PredictionOutcome[] | PredictionOutcome | null }[]) ?? [];
  const outcomes: PredictionOutcome[] = [];
  for (const p of preds) {
    const po = p.prediction_outcomes;
    if (!po) continue;
    if (Array.isArray(po)) outcomes.push(...po);
    else outcomes.push(po);
  }

  const m = computeTrustMetrics(fb, outcomes, preds.length);

  const { count: responsesSent } = await supabase
    .from("coach_responses")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "sent");

  const { error } = await supabase.from("trust_metrics").insert({
    user_id: userId,
    responses_sent: responsesSent ?? 0,
    feedback_count: m.feedbackCount,
    aha_rate: m.ahaRate,
    accuracy_rate: m.accuracyRate,
    usefulness_rate: m.usefulnessRate,
    would_pay_rate: m.wouldPayRate,
    predictions_total: m.predictionsTotal,
    predictions_correct: m.predictionsCorrect,
    prediction_accuracy: m.predictionAccuracy,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  refresh(userId);
  return OK;
}
