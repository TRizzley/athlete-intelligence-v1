// ----------------------------------------------------------------------------
// Screenshot OCR / extraction via Claude vision.
//
// Takes the raw bytes of an uploaded health/nutrition screenshot and asks
// Claude to read the numbers off it, returning a strict JSON object whose
// keys map 1:1 onto public.daily_checkins columns. Any field that is not
// clearly visible is returned as null — we never guess.
//
// Server-only. Requires ANTHROPIC_API_KEY.
// ----------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import type { ScreenshotSource } from "./types";

// The numeric fields we know how to extract. Keys match daily_checkins columns.
export interface ExtractedCheckin {
  sleep_hours: number | null; // total sleep, in hours (e.g. 7.5)
  sleep_quality: number | null; // 1-10 if the app shows a comparable rating
  recovery_score: number | null; // 0-100 (Whoop recovery, Oura readiness, etc.)
  hrv_ms: number | null; // heart-rate variability, milliseconds
  resting_hr: number | null; // resting heart rate, bpm
  body_weight_lbs: number | null; // pounds
  calories: number | null; // total daily kcal
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  water_oz: number | null;
}

export const EXTRACTED_FIELDS: (keyof ExtractedCheckin)[] = [
  "sleep_hours",
  "sleep_quality",
  "recovery_score",
  "hrv_ms",
  "resting_hr",
  "body_weight_lbs",
  "calories",
  "protein_g",
  "carbs_g",
  "fat_g",
  "water_oz",
];

// Per-source hint so the model knows what it is looking at.
const SOURCE_HINTS: Record<ScreenshotSource, string> = {
  whoop:
    "A WHOOP app screenshot. Likely shows Recovery % (-> recovery_score), HRV in ms, Resting Heart Rate (RHR), and Sleep duration.",
  oura: "An Oura Ring screenshot. Likely shows Readiness (-> recovery_score), HRV, resting heart rate, and total sleep.",
  garmin:
    "A Garmin screenshot. May show Body Battery, HRV status, resting heart rate, and sleep duration.",
  apple_health:
    "An Apple Health screenshot. May show resting heart rate, HRV, sleep duration, body weight, or active calories.",
  apple_fitness:
    "An Apple Fitness screenshot. May show calories (move), workout data, or heart rate.",
  nutrition:
    "A nutrition / food-logging app screenshot (e.g. MyFitnessPal, Cronometer). Likely shows total Calories and macros: Protein, Carbs, Fat (grams). May show water intake.",
  other: "A health or fitness screenshot of unknown type.",
};

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

function buildPrompt(source: ScreenshotSource, note: string | null): string {
  return [
    `You are reading a health/fitness app screenshot to extract metrics.`,
    `Source type: ${source}. ${SOURCE_HINTS[source] ?? SOURCE_HINTS.other}`,
    note ? `The user added this note (use only as context, not as a data source): "${note}"` : "",
    ``,
    `Return ONLY a JSON object with EXACTLY these keys:`,
    `sleep_hours, sleep_quality, recovery_score, hrv_ms, resting_hr, body_weight_lbs, calories, protein_g, carbs_g, fat_g, water_oz`,
    ``,
    `Rules:`,
    `- Use numbers only (no units). sleep_hours is decimal hours (e.g. "7h 30m" -> 7.5).`,
    `- recovery_score and readiness are 0-100. hrv_ms in milliseconds. resting_hr in bpm.`,
    `- body_weight_lbs in pounds (convert kg if needed: kg * 2.20462).`,
    `- calories in kcal; protein_g/carbs_g/fat_g/water_oz in grams/ounces.`,
    `- sleep_quality: only fill if the app shows a clear 0-100 or comparable sleep score; rescale to 1-10. Otherwise null.`,
    `- If a value is not clearly visible, return null for it. NEVER guess or infer.`,
    `- Respond with the raw JSON object and nothing else.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function coerceNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// Defensive bounds so an OCR misread can't write absurd values into a check-in.
const BOUNDS: Partial<Record<keyof ExtractedCheckin, [number, number]>> = {
  sleep_hours: [0, 24],
  sleep_quality: [1, 10],
  recovery_score: [0, 100],
  hrv_ms: [1, 400],
  resting_hr: [25, 150],
  body_weight_lbs: [50, 800],
  calories: [0, 20000],
  protein_g: [0, 2000],
  carbs_g: [0, 3000],
  fat_g: [0, 2000],
  water_oz: [0, 500],
};

function sanitize(raw: Record<string, unknown>): ExtractedCheckin {
  const out = {} as ExtractedCheckin;
  for (const key of EXTRACTED_FIELDS) {
    let n = coerceNumber(raw[key]);
    const b = BOUNDS[key];
    if (n !== null && b && (n < b[0] || n > b[1])) n = null; // out of range -> drop
    out[key] = n;
  }
  return out;
}

// Which fields each kind of screenshot is allowed to fill. This prevents
// cross-contamination — e.g. a Whoop/Apple "calories burned" reading must never
// land in the food-intake `calories` field, and a nutrition app must never set
// biometrics. Anything not allowed for the source is forced back to null.
const NUTRITION_FIELDS: (keyof ExtractedCheckin)[] = [
  "calories",
  "protein_g",
  "carbs_g",
  "fat_g",
  "water_oz",
];
const BIOMETRIC_FIELDS: (keyof ExtractedCheckin)[] = [
  "sleep_hours",
  "sleep_quality",
  "recovery_score",
  "hrv_ms",
  "resting_hr",
];
const WEIGHT_FIELDS: (keyof ExtractedCheckin)[] = ["body_weight_lbs"];

const ALLOWED_BY_SOURCE: Record<ScreenshotSource, (keyof ExtractedCheckin)[]> = {
  // Wearables/recovery apps: biometrics + weight only (never nutrition).
  whoop: [...BIOMETRIC_FIELDS, ...WEIGHT_FIELDS],
  oura: [...BIOMETRIC_FIELDS, ...WEIGHT_FIELDS],
  garmin: [...BIOMETRIC_FIELDS, ...WEIGHT_FIELDS],
  apple_health: [...BIOMETRIC_FIELDS, ...WEIGHT_FIELDS],
  apple_fitness: [...BIOMETRIC_FIELDS, ...WEIGHT_FIELDS],
  // Food logs: nutrition + weight only (never biometrics).
  nutrition: [...NUTRITION_FIELDS, ...WEIGHT_FIELDS],
  // Unknown source: allow everything, best effort.
  other: EXTRACTED_FIELDS,
};

function restrictToSource(
  e: ExtractedCheckin,
  source: ScreenshotSource,
): ExtractedCheckin {
  const allowed = new Set(ALLOWED_BY_SOURCE[source] ?? EXTRACTED_FIELDS);
  const out = {} as ExtractedCheckin;
  for (const k of EXTRACTED_FIELDS) out[k] = allowed.has(k) ? e[k] : null;
  return out;
}

/**
 * Extract structured check-in fields from a screenshot using Claude vision.
 * Throws on API/parse failure so the caller can record parse_status = 'error'.
 */
export async function extractFromScreenshot(params: {
  bytes: ArrayBuffer | Uint8Array;
  mimeType: string;
  source: ScreenshotSource;
  note?: string | null;
}): Promise<ExtractedCheckin> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const mediaType = ALLOWED_MIME.has(params.mimeType) ? params.mimeType : "image/png";
  const buf =
    params.bytes instanceof Uint8Array ? params.bytes : new Uint8Array(params.bytes);
  const base64 = Buffer.from(buf).toString("base64");

  const client = new Anthropic({ apiKey });

  const msg = await client.messages.create({
    model: process.env.OCR_MODEL || "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType as never, data: base64 },
          },
          { type: "text", text: buildPrompt(params.source, params.note ?? null) },
        ],
      },
    ],
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  // Pull the first JSON object out of the response, tolerating code fences.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in model response: ${text.slice(0, 200)}`);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error(`Could not parse model JSON: ${match[0].slice(0, 200)}`);
  }

  return restrictToSource(sanitize(parsed), params.source);
}

/** True if the extraction produced at least one usable value. */
export function hasAnyValue(e: ExtractedCheckin): boolean {
  return EXTRACTED_FIELDS.some((k) => e[k] !== null);
}
