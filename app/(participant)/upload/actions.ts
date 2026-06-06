"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error: string | null; ok?: boolean };

const MAX_BYTES = 10 * 1024 * 1024; // ~10MB
const ALLOWED_SOURCES = [
  "whoop",
  "apple_health",
  "apple_fitness",
  "garmin",
  "oura",
  "nutrition",
  "other",
];

function extFor(file: File): string {
  const name = file.name || "screenshot";
  const dot = name.lastIndexOf(".");
  let ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (!ext || ext.length > 5) ext = (file.type.split("/")[1] || "png").toLowerCase();
  return ext.replace(/[^a-z0-9]/g, "") || "png";
}

export async function uploadScreenshot(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Please sign in again." };

  const file = formData.get("file");
  const source = String(formData.get("source") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  const captureDateRaw = String(formData.get("capture_date") ?? "").trim();
  const captureDate = captureDateRaw === "" ? null : captureDateRaw;

  if (!ALLOWED_SOURCES.includes(source))
    return { error: "Please choose which app this screenshot is from." };
  if (!(file instanceof File) || file.size === 0)
    return { error: "Please choose an image to upload." };
  if (file.size > MAX_BYTES)
    return { error: "That image is larger than 10MB. Please pick a smaller one." };
  if (!file.type.startsWith("image/"))
    return { error: "Please upload an image file (PNG or JPG)." };

  const path = `${user.id}/${crypto.randomUUID()}.${extFor(file)}`;
  const bytes = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from("screenshots")
    .upload(path, bytes, { contentType: file.type, upsert: false });

  if (uploadError) return { error: `Upload failed: ${uploadError.message}` };

  const { error: insertError } = await supabase.from("uploaded_screenshots").insert({
    user_id: user.id,
    source,
    storage_path: path,
    file_name: file.name,
    capture_date: captureDate,
    note,
  });

  if (insertError) {
    // Roll back the orphaned file if the row insert failed.
    await supabase.storage.from("screenshots").remove([path]);
    return { error: insertError.message };
  }

  revalidatePath("/upload");
  revalidatePath("/dashboard");
  return { error: null, ok: true };
}

export async function deleteScreenshot(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing screenshot id." };

  const { data: row } = await supabase
    .from("uploaded_screenshots")
    .select("storage_path, user_id")
    .eq("id", id)
    .maybeSingle();

  if (!row || row.user_id !== user.id) return { error: "Not found." };

  await supabase.storage.from("screenshots").remove([row.storage_path]);
  await supabase.from("uploaded_screenshots").delete().eq("id", id);

  revalidatePath("/upload");
  return { error: null, ok: true };
}
