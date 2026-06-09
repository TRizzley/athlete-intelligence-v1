"use client";

// "Here's what we read — confirm?" The OCR no longer auto-fills the check-in;
// each reading waits here until the athlete confirms (values WIN / overwrite) or
// dismisses it. This is the gate that stops a misread from silently reaching the
// coach. After applying, we kick the coach so the confirmed data is used.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyScreenshotReading, dismissScreenshotReading } from "./actions";
import { SOURCE_LABELS } from "@/lib/constants";
import { formatDate, todayISO } from "@/lib/format";

// The OCR field keys, in display order. Defined locally (not imported from
// lib/ocr) because that module loads the server-only Anthropic SDK, which must
// never be pulled into this browser component.
const READING_FIELDS = [
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
] as const;

type PendingReading = {
  id: string;
  source: string;
  capture_date: string | null;
  created_at: string;
  file_name: string | null;
  url: string | null;
  parsed: Record<string, number | null>;
};

const FIELD_LABELS: Record<string, string> = {
  sleep_hours: "Sleep (h)",
  sleep_quality: "Sleep quality (1–10)",
  recovery_score: "Recovery",
  hrv_ms: "HRV (ms)",
  resting_hr: "Resting HR",
  body_weight_lbs: "Weight (lb)",
  calories: "Calories",
  protein_g: "Protein (g)",
  carbs_g: "Carbs (g)",
  fat_g: "Fat (g)",
  water_oz: "Water (oz)",
};

export function ReviewReadings({ readings }: { readings: PendingReading[] }) {
  if (readings.length === 0) return null;
  return (
    <div className="mb-8 space-y-3">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
          Review what we read
        </h2>
        <p className="mt-1 text-sm text-muted">
          Check these numbers before they reach your coach. Fix anything that&apos;s off,
          then apply.
        </p>
      </div>
      {readings.map((r) => (
        <ReadingCard key={r.id} reading={r} />
      ))}
    </div>
  );
}

function ReadingCard({ reading }: { reading: PendingReading }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Only the fields the OCR actually read are shown — editable.
  const fields = READING_FIELDS.filter(
    (k) => reading.parsed[k] !== null && reading.parsed[k] !== undefined,
  );
  const [edited, setEdited] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const k of fields) init[k] = String(reading.parsed[k]);
    return init;
  });

  const dateLabel = formatDate(reading.capture_date ?? reading.created_at);

  function apply() {
    setError(null);
    const values: Record<string, number | null> = {};
    for (const k of fields) {
      const t = (edited[k] ?? "").trim();
      if (t === "") {
        values[k] = null;
        continue;
      }
      const n = Number(t);
      values[k] = Number.isFinite(n) ? n : null;
    }
    startTransition(async () => {
      const res = await applyScreenshotReading(reading.id, values);
      if (res.error) {
        setError(res.error);
        return;
      }
      // Confirmed data is now in the check-in — let the coach factor it in.
      try {
        await fetch("/api/coach/auto-respond", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ date: todayISO() }),
        });
      } catch {
        /* best-effort */
      }
      router.refresh();
    });
  }

  function dismiss() {
    setError(null);
    startTransition(async () => {
      const res = await dismissScreenshotReading(reading.id);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center gap-3">
        {reading.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={reading.url}
            alt={SOURCE_LABELS[reading.source] ?? reading.source}
            className="h-16 w-12 shrink-0 rounded-md border border-border object-cover"
          />
        ) : null}
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">
            {SOURCE_LABELS[reading.source] ?? reading.source}
          </div>
          <div className="text-xs text-muted-2">For {dateLabel}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {fields.map((k) => (
          <label key={k} className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-2">
              {FIELD_LABELS[k] ?? k}
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={edited[k] ?? ""}
              onChange={(e) =>
                setEdited((prev) => ({ ...prev, [k]: e.target.value }))
              }
              className="input mt-1"
            />
          </label>
        ))}
      </div>

      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={apply}
          disabled={pending}
          className="btn-accent text-sm disabled:opacity-60"
        >
          {pending ? "Applying…" : "Looks right — apply"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          disabled={pending}
          className="btn-ghost text-sm text-muted hover:text-danger disabled:opacity-60"
        >
          Discard reading
        </button>
        <span className="ml-auto text-[11px] text-muted-2">
          Confirmed values overwrite this day&apos;s check-in.
        </span>
      </div>
    </div>
  );
}
