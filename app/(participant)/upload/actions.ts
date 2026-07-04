"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
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
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
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
  const captureDate = DATE_RE.test(captureDateRaw) ? captureDateRaw : null;

  if (!ALLOWED_SOURCES.includes(source))
    return { error: "Please choose which app these screenshots are from." };
  if (!captureDate)
    return { error: "Please set the date for these screenshots." };
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

    // Read the numbers off the screenshot and store them as a PENDING reading.
    // They are NOT written into the check-in here — the athlete reviews and
    // confirms first (see applyScreenshotReading), so a misread can't silently
    // reach the coach. Runs via after() so the upload responds immediately but
    // the serverless function isn't frozen mid-OCR (a bare `void` promise can
    // be killed when the response is sent). runOcr records its own
    // status/errors in the DB (parse_status, parse_error) and never throws.
    const screenshotId = inserted.id as string;
    const mimeType = file.type;
    after(() =>
      runOcr(supabase, {
        screenshotId,
        source: source as ScreenshotSource,
        note,
        bytes,
        mimeType,
      }),
    );

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
      ? `Uploaded ${succeeded} screenshot${succeeded === 1 ? "" : "s"}. Review the numbers we read below, then apply them.`
      : `Uploaded ${succeeded}, skipped ${failures.length}: ${failures.join("; ")}`;
  return { error: null, ok: true, message };
}

// ----------------------------------------------------------------------------
// OCR: extract metrics from the screenshot and store them as a PENDING reading.
// Nothing is written into the check-in here — the athlete confirms first. If the
// read found no usable values, mark it handled (applied_at) so it never sits in
// the review queue. Best-effort: records its own status/errors, never throws.
// ----------------------------------------------------------------------------

async function runOcr(
  supabase: DbClient,
  args: {
    screenshotId: string;
    source: ScreenshotSource;
    note: string | null;
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

    await supabase
      .from("uploaded_screenshots")
      .update({
        parse_status: "done",
        parsed_json: extracted,
        parsed_at: new Date().toISOString(),
        parse_error: null,
        // No values to confirm → mark handled so it skips the review queue.
        applied_at: hasAnyValue(extracted) ? null : new Date().toISOString(),
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

// ----------------------------------------------------------------------------
// Confirm a pending reading — the athlete reviewed (and possibly edited) the
// numbers and is applying them to their check-in. Coalesce: confirmed values
// only fill fields that are currently null in the check-in — they never
// overwrite a value the athlete entered manually. Subjective sliders
// (mood/energy/etc.) are never touched.
// ----------------------------------------------------------------------------
export async function applyScreenshotReading(
  screenshotId: string,
  values: Partial<Record<keyof ExtractedCheckin, number | null>>,
  // The browser passes the athlete's local date so we never use the UTC
  // server timestamp as a fallback. Falls back to capture_date on the row.
  clientDate?: string,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Please sign in again." };
  if (!screenshotId) return { error: "Missing screenshot." };

  const { data: shot } = await supabase
    .from("uploaded_screenshots")
    .select("id, user_id, capture_date, created_at")
    .eq("id", screenshotId)
    .maybeSingle();
  if (!shot || (shot as { user_id: string }).user_id !== user.id) {
    return { error: "That screenshot was not found." };
  }
  const s = shot as { capture_date: string | null; created_at: string };
  // Use capture_date from the row, or the browser-supplied local date as
  // fallback. Never use created_at (UTC server time) — it rolls over a day
  // early for US evening users and would write to the wrong check-in.
  const validClient = clientDate && DATE_RE.test(clientDate) ? clientDate : null;
  const date = s.capture_date ?? validClient;
  if (!date) return { error: "Could not determine which day's check-in to update. Please re-upload the screenshot with a date set." };

  // Keep only valid numbers the user confirmed; build the canonical reading too.
  const clean: Record<string, number> = {};
  const confirmed = {} as Record<string, number | null>;
  for (const k of EXTRACTED_FIELDS) {
    const v = values[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      clean[k] = v;
      confirmed[k] = v;
    } else {
      confirmed[k] = null;
    }
  }

  if (Object.keys(clean).length > 0) {
    const { data: existing } = await supabase
      .from("daily_checkins")
      .select(`id, ${EXTRACTED_FIELDS.join(", ")}`)
      .eq("user_id", user.id)
      .eq("checkin_date", date)
      .maybeSingle();
    if (existing) {
      // Coalesce: only fill fields the athlete hasn't already entered manually.
      // Any existing value in the DB (even 0) wins over the OCR reading so a
      // confirmed screenshot can never silently overwrite something they typed.
      const row = existing as unknown as Record<string, unknown>;
      const toWrite: Record<string, number> = {};
      for (const [k, v] of Object.entries(clean)) {
        if (row[k] === null || row[k] === undefined) toWrite[k] = v as number;
      }
      if (Object.keys(toWrite).length > 0) {
        await supabase
          .from("daily_checkins")
          .update(toWrite)
          .eq("id", row.id as string);
      }
    } else {
      // No existing row — insert with all confirmed values.
      await supabase
        .from("daily_checkins")
        .insert({ user_id: user.id, checkin_date: date, ...clean });
    }
  }

  // Mark handled + store what was actually applied (so history reflects reality).
  await supabase
    .from("uploaded_screenshots")
    .update({ applied_at: new Date().toISOString(), parsed_json: confirmed })
    .eq("id", screenshotId);

  revalidatePath("/upload");
  revalidatePath("/dashboard");
  revalidatePath("/admin");
  return { error: null, ok: true };
}

// Dismiss a pending reading without applying it (e.g. it misread). Marks it
// handled so it leaves the review queue; nothing is written to the check-in.
export async function dismissScreenshotReading(
  screenshotId: string,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired." };
  if (!screenshotId) return { error: "Missing screenshot." };

  const { data: shot } = await supabase
    .from("uploaded_screenshots")
    .select("id, user_id")
    .eq("id", screenshotId)
    .maybeSingle();
  if (!shot || (shot as { user_id: string }).user_id !== user.id) {
    return { error: "That screenshot was not found." };
  }

  await supabase
    .from("uploaded_screenshots")
    .update({ applied_at: new Date().toISOString() })
    .eq("id", screenshotId);

  revalidatePath("/upload");
  return { error: null, ok: true };
}

// Re-trigger OCR for a screenshot that previously errored. Resets parse_status
// to "pending" and fires runOcr again — same flow as the original upload.
export async function retryOcr(screenshotId: string): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired." };

  const { data: shot } = await supabase
    .from("uploaded_screenshots")
    .select("id, user_id, source, storage_path, file_name, note")
    .eq("id", screenshotId)
    .maybeSingle();
  if (!shot || (shot as { user_id: string }).user_id !== user.id) {
    return { error: "Screenshot not found." };
  }

  const s = shot as {
    source: string;
    storage_path: string;
    file_name: string | null;
    note: string | null;
  };

  // Download the original image from storage.
  const { data: fileData, error: dlErr } = await supabase.storage
    .from("screenshots")
    .download(s.storage_path);
  if (dlErr || !fileData) {
    return { error: "Could not retrieve the original image." };
  }

  const bytes = await fileData.arrayBuffer();
  const mimeType = fileData.type || "image/png";

  // Reset status so the UI shows "Reading numbers..." again.
  await supabase
    .from("uploaded_screenshots")
    .update({ parse_status: "pending", parse_error: null, parsed_json: null, applied_at: null })
    .eq("id", screenshotId);

  // after() keeps the OCR alive past the response instead of a killable
  // fire-and-forget promise (which left rows stuck in "processing").
  after(() =>
    runOcr(supabase, {
      screenshotId,
      source: s.source as ScreenshotSource,
      note: s.note,
      bytes,
      mimeType,
    }),
  );

  revalidatePath("/upload");
  return { error: null, ok: true, message: "Re-reading the screenshot — refresh in a moment." };
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
