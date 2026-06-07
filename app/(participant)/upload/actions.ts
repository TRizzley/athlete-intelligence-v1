"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  extractFromScreenshot,
  hasAnyValue,
  EXTRACTED_FIELDS,
  type ExtractedCheckin,
} from "@/lib/ocr";
import type { ScreenshotSource } from "@/lib/types";

export type FormState = { error: string | null; ok?: boolean };

type DbClient = Awaited<ReturnType<typeof createClient>>;

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

  const { data: inserted, error: insertError } = await supabase
    .from("uploaded_screenshots")
    .insert({
      user_id: user.id,
      source,
      storage_path: path,
      file_name: file.name,
      capture_date: captureDate,
      note,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    // Roll back the orphaned file if the row insert failed.
    await supabase.storage.from("screenshots").remove([path]);
    return { error: insertError?.message ?? "Could not save the upload." };
  }

  // Read the numbers off the screenshot and fill the day's check-in. Run it
  // synchronously (awaited) so it reliably executes and any failure is recorded
  // on the row where we can see it. It uses the logged-in user's session — RLS
  // lets a user update their own rows — so it does NOT depend on the service
  // role key or a background runtime. It never throws, so a parse failure can't
  // break the upload itself.
  await runOcrAndFill(supabase, {
    screenshotId: inserted.id as string,
    userId: user.id,
    source: source as ScreenshotSource,
    note,
    captureDate,
    bytes,
    mimeType: file.type,
  });

  revalidatePath("/upload");
  revalidatePath("/dashboard");
  revalidatePath("/admin");
  return { error: null, ok: true };
}

// ----------------------------------------------------------------------------
// OCR: extract metrics from the screenshot and fill blank check-in fields for
// the relevant date. Best-effort — records its own status/errors and never
// throws to the caller.
// ----------------------------------------------------------------------------

async function runOcrAndFill(
  supabase: DbClient,
  args: {
    screenshotId: string;
    userId: string;
    source: ScreenshotSource;
    note: string | null;
    captureDate: string | null;
    bytes: ArrayBuffer;
    mimeType: string;
  },
): Promise<void> {
  try {
    await supabase
      .from("uploaded_screenshots")
      .update({ parse_status: "processing" })
      .eq("id", args.screenshotId);

    const extracted = await extractFromScreenshot({
      bytes: args.bytes,
      mimeType: args.mimeType,
      source: args.source,
      note: args.note,
    });

    if (hasAnyValue(extracted)) {
      await applyExtractionToCheckin(supabase, args.userId, args.captureDate, extracted);
    }

    await supabase
      .from("uploaded_screenshots")
      .update({
        parse_status: "done",
        parsed_json: extracted,
        parsed_at: new Date().toISOString(),
        parse_error: null,
      })
      .eq("id", args.screenshotId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown OCR error";
    console.error(`[ocr] failed for screenshot=${args.screenshotId}:`, message);
    try {
      await supabase
        .from("uploaded_screenshots")
        .update({
          parse_status: "error",
          parse_error: message.slice(0, 500),
          parsed_at: new Date().toISOString(),
        })
        .eq("id", args.screenshotId);
    } catch {
      // If even the error write fails, there's nothing more we can do here.
    }
  }
}

// Screenshot wins: an OCR-read value overwrites whatever is in the check-in for
// that field (manual entries included). Only the objective fields the OCR can
// read are touched; subjective sliders (mood/energy/etc.) are never in scope.
async function applyExtractionToCheckin(
  supabase: DbClient,
  userId: string,
  captureDate: string | null,
  extracted: ExtractedCheckin,
): Promise<void> {
  const date = captureDate ?? new Date().toISOString().slice(0, 10);

  const { data: existing } = await supabase
    .from("daily_checkins")
    .select("*")
    .eq("user_id", userId)
    .eq("checkin_date", date)
    .maybeSingle();

  if (!existing) {
    const row: Record<string, unknown> = { user_id: userId, checkin_date: date };
    for (const k of EXTRACTED_FIELDS) {
      if (extracted[k] !== null) row[k] = extracted[k];
    }
    await supabase.from("daily_checkins").insert(row);
    return;
  }

  const patch: Record<string, unknown> = {};
  for (const k of EXTRACTED_FIELDS) {
    // Screenshot wins: overwrite whatever is there with any value the OCR read.
    if (extracted[k] !== null) {
      patch[k] = extracted[k];
    }
  }

  if (Object.keys(patch).length > 0) {
    await supabase.from("daily_checkins").update(patch).eq("id", (existing as { id: string }).id);
  }
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
