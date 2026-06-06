"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
    .select("id, user_id, status")
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

  revalidatePath(`/coach/${responseId}`);
  revalidatePath("/dashboard");
  redirect(`/coach/${responseId}?thanks=1`);
}
