"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  uploadScreenshot,
  deleteScreenshot,
  type FormState,
} from "./actions";
import { Field } from "@/components/ui";
import { FileField, SubmitButton } from "@/components/interactive";
import { SCREENSHOT_SOURCES } from "@/lib/constants";
import { todayISO } from "@/lib/format";

const initial: FormState = { error: null };

export function UploadForm({ dateISO }: { dateISO: string }) {
  const [state, action] = useActionState(uploadScreenshot, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const [resetKey, setResetKey] = useState(0);

  // Re-anchor the date to the browser's local "today" (server renders in UTC).
  const [localToday, setLocalToday] = useState(dateISO);
  const [captureDate, setCaptureDate] = useState(dateISO);
  useEffect(() => {
    const t = todayISO();
    setLocalToday(t);
    setCaptureDate(t);
  }, []);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setResetKey((k) => k + 1);
      // NOTE: we intentionally do NOT trigger the coach here anymore. The OCR
      // reading is pending review — it isn't in the check-in yet. The coach is
      // kicked after the athlete confirms the reading (see review-readings.tsx).
    }
  }, [state]);

  return (
    <form ref={formRef} action={action} className="card space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Which app is this from?" htmlFor="source" required>
          <select id="source" name="source" required defaultValue="" className="input">
            <option value="" disabled>
              Choose a source…
            </option>
            {SCREENSHOT_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label} — {s.hint}
              </option>
            ))}
          </select>
        </Field>
        <Field label="What day is this data for?" htmlFor="capture_date">
          <input
            id="capture_date"
            name="capture_date"
            type="date"
            value={captureDate}
            onChange={(e) => setCaptureDate(e.target.value)}
            max={localToday}
            className="input"
          />
        </Field>
      </div>

      <Field label="Screenshots" required hint="Add one or several at once — they all use the source and date above.">
        <FileField key={resetKey} name="file" required multiple />
      </Field>

      <Field label="Note (optional)" htmlFor="note">
        <input id="note" name="note" className="input" placeholder="Anything notable in this screen?" />
      </Field>

      {state.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {state.error}
        </div>
      ) : null}
      {state.ok ? (
        <div className="rounded-lg border border-success/30 bg-success-soft px-3.5 py-2.5 text-sm text-success">
          {state.message ?? "Uploaded. Add more below if you like."}
        </div>
      ) : null}

      <div className="flex justify-end">
        <SubmitButton pendingText="Uploading…" variant="accent">
          Upload screenshots
        </SubmitButton>
      </div>
    </form>
  );
}

export function DeleteScreenshotButton({ id }: { id: string }) {
  const [, action] = useActionState(deleteScreenshot, initial);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        className="rounded-md bg-background/70 p-1.5 text-muted-2 backdrop-blur transition hover:bg-danger/20 hover:text-danger"
        title="Delete"
        aria-label="Delete screenshot"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0v12a1 1 0 001 1h6a1 1 0 001-1V7" />
        </svg>
      </button>
    </form>
  );
}
