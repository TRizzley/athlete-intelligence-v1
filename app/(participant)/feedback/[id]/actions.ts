"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type FormState = { error: string | null };

function val(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string" || v.trim() === "") return null;
  return v.trim();
}

export async function saveFeedback(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Please sign in again." };

  const responseId = val(formData, "coach_response_id");
  if (!responseId) return { error: "Missing response reference." };

  // Confirm the response exists, is sent, and belongs to this user.
  const { data: resp } = await supabase
    .from("coach_responses")
    .select("id, user_id, status, response_date")
    .eq("id", responseId)
    .maybeSingle();

  if (!resp || resp.user_id !== user.id) {
    return { error: "That coaching response could not be found." };
  }

  const payload = {
    user_id: user.id,
    coach_response_id: responseId,
    felt_accurate: val(formData, "felt_accurate"),
    felt_personalized: val(formData, "felt_personalized"),
    was_useful: val(formData, "was_useful"),
    prediction_came_true: val(formData, "prediction_came_true"),
    would_pay: val(formData, "would_pay"),
    free_text: val(formData, "free_text"),
  };

  const { error } = await supabase
    .from("user_feedback")
    .upsert(payload, { onConflict: "coach_response_id" });

  if (error) return { error: error.message };

  // Persist the qualitative signal to coach memory so the correction actually
  // carries into future decisions — not just this one response. We record when
  // the athlete typed something, or when any core rating was negative. Best
  // effort: a failure here must never block the feedback from being saved.
  try {
    const shortfalls: string[] = [];
    if (payload.felt_personalized === "no") shortfalls.push("did not feel personalized");
    else if (payload.felt_personalized === "somewhat")
      shortfalls.push("felt only somewhat personalized");
    if (payload.felt_accurate === "no") shortfalls.push("did not feel accurate");
    if (payload.was_useful === "no") shortfalls.push("was not useful");

    if (payload.free_text || shortfalls.length > 0) {
      const dateStr = (resp as { response_date?: string }).response_date ?? "a recent";
      const parts = [`Feedback on the ${dateStr} coach response:`];
      if (shortfalls.length > 0) parts.push(`${shortfalls.join("; ")}.`);
      if (payload.free_text) parts.push(`Athlete's words: "${payload.free_text}".`);

      const admin = createAdminClient();
      // Replace any prior feedback note for this same response (feedback is
      // upserted, so a resubmission should refresh, not duplicate, the note).
      const tag = `[fb:${responseId}]`;
      await admin
        .from("athlete_memory_notes")
        .delete()
        .eq("user_id", user.id)
        .eq("category", "feedback")
        .like("note", `${tag}%`);
      await admin.from("athlete_memory_notes").insert({
        user_id: user.id,
        category: "feedback",
        note: `${tag} ${parts.join(" ")}`,
        created_by: user.id,
      });
    }
  } catch {
    /* best-effort; feedback is already saved */
  }

  revalidatePath(`/coach/${responseId}`);
  revalidatePath("/dashboard");
  redirect(`/coach/${responseId}?thanks=1`);
}
