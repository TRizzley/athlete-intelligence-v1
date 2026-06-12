"use server";

import { createClient } from "@/lib/supabase/server";

export async function savePushToken(token: string): Promise<{ error: string | null }> {
  if (!token || typeof token !== "string" || token.length > 512) {
    return { error: "Invalid token." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expired." };

  const { error } = await supabase
    .from("users")
    .update({
      push_token: token,
      push_token_updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  return { error: error?.message ?? null };
}
