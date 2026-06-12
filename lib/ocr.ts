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

// Per-source hint so the model knows what it is looking at — including the
// specific "read THIS, not THAT" traps that cause most misreads.
const SOURCE_HINTS: Record<ScreenshotSource, string> = {
  whoop:
    "A WHOOP screenshot. recovery_score = the big Recovery percentage (0-100, green/yellow/red). Do NOT use Strain (a 0-21 scale) or Sleep Performance %. hrv_ms = HRV in milliseconds; resting_hr = RHR in bpm. sleep_hours = hours ASLEEP, not time in bed.",
  oura:
    "An Oura Ring screenshot. recovery_score = the Readiness score (0-100). Do NOT confuse it with the Sleep score or Activity score. hrv_ms = average HRV (ms); resting_hr = resting heart rate (bpm); sleep_hours = total sleep time (hours), not time in bed.",
  garmin:
    "A Garmin screenshot. resting_hr = RHR (bpm); sleep_hours = sleep duration. Body Battery is 0-100 but is a charge gauge, not a recovery score — only map it to recovery_score if there is no dedicated recovery/readiness number. HRV status is often a label, not a number; only fill hrv_ms if an actual millisecond value is shown.",
  apple_health:
    "An Apple Health screenshot. Read resting_hr (bpm), hrv_ms (HRV SDNN in ms), sleep_hours (Time Asleep), and body_weight_lbs if shown. Any calories here are ENERGY BURNED — never put them in calories (that field is food intake only).",
  apple_fitness:
    "An Apple Fitness screenshot. Move/Active calories are ENERGY BURNED — never food intake, so leave calories null. You may read heart-rate values if clearly labeled.",
  nutrition:
    "A nutrition / food-log screenshot (MyFitnessPal, Cronometer, Lose It, etc.). Read the CONSUMED/EATEN totals for the day. CRITICAL TRAP - CALORIES: Many apps show a large bold number that is NOT food consumed. MyFitnessPal: the large centered number is 'Calories Remaining' (Goal minus Food) -- use the smaller 'Food' or 'Consumed' number instead. Cronometer: read 'Consumed' not 'Burned'. Lose It: use the direct consumed total, not goal minus remaining. If you cannot identify a clear consumed/eaten calorie number with confidence, return null -- a wrong calorie is worse than a blank. protein_g/carbs_g/fat_g are GRAMS EATEN (daily totals row only), never goals or remaining amounts. Ignore per-meal breakdowns unless they sum to a labeled daily total.",
  other:
    "A health or fitness screenshot of unknown type. Read only values whose meaning is unambiguous from a clear label.",
};

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

// System prompt: how to read carefully and the unit/value rules that apply to
// every screenshot. Source-specific traps are injected per request.
const OCR_SYSTEM_PROMPT = [
  "You extract numeric health/fitness metrics from a single app screenshot. Accuracy matters more than completeness — a wrong number is worse than a blank one, because it silently corrupts the athlete's coaching.",
  "",
  "HOW TO READ:",
  "- Read each digit precisely. Distinguish easily-confused digits (1 vs 7, 3 vs 8, 5 vs 6, 0 vs 8, 4 vs 9).",
  "- Match every number to its LABEL on screen — never grab a nearby number just because it's big or bold.",
  "- If a value is blurry, cropped, partially hidden, ambiguous, or you are not sure which metric it belongs to, return null for that field. Do NOT guess, infer, average, or compute a value that isn't shown.",
  "",
  "UNITS & NORMALIZATION:",
  "- Numbers only, no units. sleep_hours is decimal hours (7h 30m -> 7.5; read time ASLEEP, not time in bed).",
  "- recovery_score / readiness are 0-100. hrv_ms in milliseconds. resting_hr in bpm.",
  "- body_weight_lbs in pounds (convert kg: kg * 2.20462).",
  "- calories is FOOD INTAKE in kcal (never energy burned/active calories). protein_g/carbs_g/fat_g in grams; water_oz in fluid ounces.",
  "- sleep_quality: only fill if the app shows a clear numeric sleep score (0-100). Return the RAW value as shown (e.g. 78, not 7.8). We rescale to 1-10 in code. If the score is not shown or is only a label, return null.",
  "",
  "Record your reading ONLY by calling record_metrics. Omit (or null) any field you cannot read with confidence.",
].join("\n");

// Forced structured output — far more reliable than parsing free-text JSON.
const FIELD_DESCRIPTIONS: Record<keyof ExtractedCheckin, string> = {
  sleep_hours: "Total time asleep, decimal hours. Null if not shown.",
  sleep_quality: "Raw 0-100 sleep score as shown on screen. Do not rescale. Null if not shown.",
  recovery_score: "Recovery/Readiness, 0-100. Null if not shown.",
  hrv_ms: "HRV in milliseconds. Null if only a label (no number) is shown.",
  resting_hr: "Resting heart rate in bpm. Null if not shown.",
  body_weight_lbs: "Body weight in pounds (convert kg). Null if not shown.",
  calories: "Food calories CONSUMED (kcal), not remaining/goal/burned. Null if unclear.",
  protein_g: "Protein grams eaten (daily total). Null if not shown.",
  carbs_g: "Carbohydrate grams eaten (daily total). Null if not shown.",
  fat_g: "Fat grams eaten (daily total). Null if not shown.",
  water_oz: "Water intake in fluid ounces. Null if not shown.",
};

const EXTRACT_TOOL: Anthropic.Tool = {
  name: "record_metrics",
  description:
    "Record the numeric metrics read from the screenshot. Use null for any value not clearly and unambiguously visible.",
  input_schema: {
    type: "object",
    properties: Object.fromEntries(
      EXTRACTED_FIELDS.map((k) => [
        k,
        { type: ["number", "null"], description: FIELD_DESCRIPTIONS[k] },
      ]),
    ) as Record<string, unknown>,
    required: [...EXTRACTED_FIELDS],
  },
};

function buildUserText(source: ScreenshotSource, note: string | null): string {
  return [
    `Source type: ${source}. ${SOURCE_HINTS[source] ?? SOURCE_HINTS.other}`,
    note
      ? `The user added this note (context only, not a data source): "${note}"`
      : "",
    `Read the screenshot and call record_metrics. Leave any field you cannot read with confidence as null.`,
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
  sleep_hours: [0.5, 24],
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
  // sleep_quality: model returns raw 0-100; rescale to 1-10 deterministically.
  // Anything already in [1,10] is left as-is (model may have already rescaled);
  // values in (10,100] are divided by 10 and rounded.
  if (out.sleep_quality !== null) {
    if (out.sleep_quality > 10) {
      out.sleep_quality = Math.round(out.sleep_quality / 10);
    }
    // Clamp to [1,10] after rescale.
    out.sleep_quality = Math.max(1, Math.min(10, Math.round(out.sleep_quality)));
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
    // Haiku is plenty for deterministic metric extraction and ~10x cheaper than
    // Sonnet on the image input. Override with OCR_MODEL if accuracy ever needs it.
    model: process.env.OCR_MODEL || "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    // Deterministic: OCR should read the same screenshot the same way every time.
    temperature: 0,
    system: OCR_SYSTEM_PROMPT,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "record_metrics" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType as never, data: base64 },
          },
          { type: "text", text: buildUserText(params.source, params.note ?? null) },
        ],
      },
    ],
  });

  const toolUse = msg.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    throw new Error("OCR model did not return structured metrics. Try re-uploading.");
  }

  const parsed = (toolUse.input ?? {}) as Record<string, unknown>;
  return restrictToSource(sanitize(parsed), params.source);
}

/** True if at least one field in the extracted result has a non-null value. */
export function hasAnyValue(e: ExtractedCheckin): boolean {
  return EXTRACTED_FIELDS.some((k) => e[k] !== null);
}
