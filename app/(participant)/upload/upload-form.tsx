"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  uploadScreenshot,
  deleteScreenshot,
  retryOcr,
  type FormState,
} from "./actions";
import { Field } from "@/components/ui";
import { FileField, SubmitButton } from "@/components/interactive";
import { SCREENSHOT_SOURCES } from "@/lib/constants";
import { todayISO } from "@/lib/format";
import { isNativeApp, pickNativeImages, takeNativePhoto } from "@/lib/native";

const initial: FormState = { error: null };

export function UploadForm({ dateISO }: { dateISO: string }) {
  const [state, action] = useActionState(uploadScreenshot, initial);
  const formRef = useRef<HTMLFormElement>(null);
  const [resetKey, setResetKey] = useState(0);

  // Inside the iOS app we use the native camera/photo picker; in a browser we
  // keep the standard file input. Default to web for SSR/first paint, then swap
  // after mount (window.Capacitor only exists at runtime in the app shell).
  const [native, setNative] = useState(false);
  useEffect(() => setNative(isNativeApp()), []);

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
        {native ? (
          <NativePicker key={resetKey} />
        ) : (
          <FileField key={resetKey} name="file" required multiple />
        )}
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

// Native (in-app) image picker. Renders Camera / Library buttons and keeps the
// chosen files on a hidden <input name="file"> via DataTransfer, so the parent
// form submits them through the exact same server action as the web file input.
type PickedItem = { file: File; url: string };

function NativePicker() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<PickedItem[]>([]);
  const [busy, setBusy] = useState(false);

  // Revoke object URLs on unmount to avoid leaks.
  useEffect(() => {
    return () => items.forEach((it) => URL.revokeObjectURL(it.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commit(next: PickedItem[]) {
    setItems(next);
    const el = inputRef.current;
    if (el) {
      const dt = new DataTransfer();
      next.forEach((it) => dt.items.add(it.file));
      el.files = dt.files;
    }
  }

  function addFiles(files: File[]) {
    if (files.length === 0) return;
    const added = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    commit([...items, ...added]);
  }

  async function fromCamera() {
    setBusy(true);
    try {
      const photo = await takeNativePhoto();
      if (photo) addFiles([photo]);
    } finally {
      setBusy(false);
    }
  }

  async function fromLibrary() {
    setBusy(true);
    try {
      addFiles(await pickNativeImages());
    } finally {
      setBusy(false);
    }
  }

  function removeAt(i: number) {
    URL.revokeObjectURL(items[i].url);
    commit(items.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      {/* Hidden input the parent form submits. Populated via DataTransfer. */}
      <input ref={inputRef} type="file" name="file" accept="image/*" multiple hidden />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={fromCamera}
          disabled={busy}
          className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm font-medium transition hover:bg-surface-2 disabled:opacity-50"
        >
          Take photo
        </button>
        <button
          type="button"
          onClick={fromLibrary}
          disabled={busy}
          className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm font-medium transition hover:bg-surface-2 disabled:opacity-50"
        >
          Choose from library
        </button>
      </div>

      {items.length > 0 ? (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {items.map((it, i) => (
            <div key={it.url} className="group relative overflow-hidden rounded-lg border border-border bg-surface-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.url} alt="" className="aspect-square w-full object-cover" />
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="absolute right-1 top-1 rounded-md bg-background/80 px-1.5 py-0.5 text-[11px] text-muted-2 backdrop-blur transition hover:text-danger"
                aria-label="Remove image"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-2">No images added yet.</p>
      )}
    </div>
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

export function RetryOcrButton({ id }: { id: string }) {
  const [state, action] = useActionState(
    (_prev: { error: string | null }, _fd: FormData) => retryOcr(id),
    { error: null },
  );
  if (state.ok) return <span className="text-[11px] text-muted-2">Retrying…</span>;
  return (
    <form action={action} className="inline">
      <button
        type="submit"
        className="text-[11px] text-accent underline underline-offset-2 hover:no-underline"
      >
        Try again
      </button>
    </form>
  );
}
