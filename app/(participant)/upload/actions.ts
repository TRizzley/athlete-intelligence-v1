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

export type FormState = { error: string | null; ok?: boolean; message?: string };

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

  // Accept one OR several files under the same "file" field (multi-select).
  const files = formData
    .getAll("file")
    .filter((f): f is File => f instanceof File && f.size > 0);
  const source = String(formData.get("source") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  const captureDateRaw = String(formData.get("capture_date") ?? "").trim();
  const captureDate = captureDateRaw === "" ? null : captureDateRaw;

  if (!ALLOWED_SOURCES.includes(source))
    return { error: "Please choose which app these screenshots are from." };
  if (files.length === 0)
    return { error: "Please choose at least one image to upload." };

  let succeeded = 0;
  const failures: string[] = [];

  // Process each file independently so one bad file doesn't sink the batch.
  for (const file of files) {
    const label = file.name || "screenshot";
    if (file.size > MAX_BYTES) {
      failures.push(`${label} is larger than 10MB`);
      continue;
    }
    if (!file.type.startsWith("image/")) {
      failures.push(`${label} isn't an image`);
      continue;
    }

    const path = `${user.id}/${crypto.randomUUID()}.${extFor(file)}`;
    const bytes = await file.arrayBuffer();

    const { error: uploadError } = await supabase.storage
      .from("screenshots")
      .upload(path, bytes, { contentType: file.type, upsert: false });

    if (uploadError) {
      failures.push(`${label}: ${uploadError.message}`);
      continue;
    }

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
      failures.push(`${label}: ${insertError?.message ?? "could not save"}`);
      continue;
    }

    // Read the numbers off the screenshot and fill the day's check-in. Awaited
    // so it reliably runs and any failure is recorded on the row. It never
    // throws, so a parse failure can't break the upload itself.
    await runOcrAndFill(supabase, {
      screenshotId: inserted.id as string,
      userId: user.id,
      source: source as ScreenshotSource,
      note,
      captureDate,
      bytes,
      mimeType: file.type,
    });

    succeeded += 1;
  }

  if (succeeded === 0) {
    return { error: failures[0] ?? "None of the files could be uploaded." };
  }

  revalidatePath("/upload");
  revalidatePath("/dashboard");
  revalidatePath("/admin");

  const message =
    failures.length === 0
      ? `Uploaded ${succeeded} screenshot${succeeded === 1 ? "" : "s"}. Add more below if you like.`
      : `Uploaded ${succeeded}, skipped ${failures.length}: ${failures.join("; ")}`;
  return { error: null, ok: true, message };
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

// Fill only BLANK check-in fields from the screenshot — never clobber a value
// the athlete typed (or a value an earlier screenshot already provided). Only
// the objective fields the OCR can read are touched; subjective sliders
// (mood/energy/etc.) are never in scope.
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

  const current = existing as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of EXTRACTED_FIELDS) {
    const cur = current[k];
    const isBlank = cur === null || cur === undefined || cur === "";
    // Coalesce: only fill fields that are still blank. Manual entries win.
    if (isBlank && extracted[k] !== null) {
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
