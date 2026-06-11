"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

// ---------------------------------------------------------------------------
// Submit button that reflects the enclosing form's pending state. Works for
// both plain `action={fn}` forms and useActionState forms.
// ---------------------------------------------------------------------------
export function SubmitButton({
  children,
  pendingText,
  variant = "primary",
  className,
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: "primary" | "accent" | "ghost";
  className?: string;
}) {
  const { pending } = useFormStatus();
  const base =
    variant === "accent" ? "btn-accent" : variant === "ghost" ? "btn-ghost" : "btn-primary";
  return (
    <button type="submit" disabled={pending} className={`${base} ${className ?? ""}`}>
      {pending ? (
        <>
          <Spinner /> {pendingText ?? "Saving…"}
        </>
      ) : (
        children
      )}
    </button>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 1–10 subjective slider with a live value readout and low/high anchors.
// Supports defaultValue=null — the slider starts in an "unset" state and the
// form field is omitted entirely until the athlete taps to activate it. This
// prevents phantom data from hardcoded defaults polluting the coach's signal.
// ---------------------------------------------------------------------------
export function Slider({
  name,
  label,
  low,
  high,
  defaultValue = null,
  min = 1,
  max = 10,
}: {
  name: string;
  label: string;
  low?: string;
  high?: string;
  defaultValue?: number | null;
  min?: number;
  max?: number;
}) {
  const [value, setValue] = useState<number | null>(defaultValue ?? null);
  const mid = Math.round((min + max) / 2);

  function activate() {
    setValue(mid);
  }

  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3.5 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {value !== null ? (
          <span className="flex h-7 min-w-[2rem] items-center justify-center rounded-md bg-surface-3 px-2 text-sm font-semibold tabular-nums text-accent">
            {value}
          </span>
        ) : (
          <button
            type="button"
            onClick={activate}
            className="flex h-7 items-center rounded-md border border-dashed border-border-strong px-2 text-xs text-muted-2 transition hover:border-accent hover:text-accent"
          >
            tap to rate
          </button>
        )}
      </div>

      {value !== null ? (
        <>
          {/* Field is only rendered (and submitted) once the athlete activates. */}
          <input
            type="range"
            name={name}
            min={min}
            max={max}
            step={1}
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
          />
          {low || high ? (
            <div className="mt-1.5 flex justify-between text-[11px] text-muted-2">
              <span>{low}</span>
              <span>{high}</span>
            </div>
          ) : null}
        </>
      ) : (
        <button
          type="button"
          onClick={activate}
          className="w-full rounded-md border border-dashed border-border bg-surface-3/50 py-2.5 text-center text-xs text-muted-2 transition hover:border-accent hover:text-accent"
        >
          Not rated — tap to set
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Radio cards (single choice). Uses native radios so it works without JS and
// submits as a normal form field.
// ---------------------------------------------------------------------------
export function RadioCards({
  name,
  options,
  defaultValue,
  columns = 3,
  required,
}: {
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string | null;
  columns?: 2 | 3 | 4;
  required?: boolean;
}) {
  const cols =
    columns === 2 ? "grid-cols-2" : columns === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3";
  return (
    <div className={`grid ${cols} gap-2`}>
      {options.map((o) => (
        <label key={o.value} className="cursor-pointer">
          <input
            type="radio"
            name={name}
            value={o.value}
            defaultChecked={defaultValue === o.value}
            required={required}
            className="peer sr-only"
          />
          <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-center text-sm text-muted transition hover:border-border-strong peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40">
            {o.label}
          </div>
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Multi-select pills (e.g. devices owned). Submits repeated form fields.
// ---------------------------------------------------------------------------
export function CheckPills({
  name,
  options,
  defaultValues = [],
}: {
  name: string;
  options: { value: string; label: string }[];
  defaultValues?: string[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label key={o.value} className="cursor-pointer">
          <input
            type="checkbox"
            name={name}
            value={o.value}
            defaultChecked={defaultValues.includes(o.value)}
            className="peer sr-only"
          />
          <span className="inline-flex items-center rounded-full border border-border bg-surface-2 px-3.5 py-1.5 text-sm text-muted transition hover:border-border-strong peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:text-foreground">
            {o.label}
          </span>
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// File picker with a lightweight preview (name + size + thumbnail).
// ---------------------------------------------------------------------------
export function FileField({
  name,
  required,
  multiple,
}: {
  name: string;
  required?: boolean;
  multiple?: boolean;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<string | null>(null);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    setFiles(list);
    if (preview) URL.revokeObjectURL(preview);
    const first = list[0] ?? null;
    setPreview(
      first && first.type.startsWith("image/") ? URL.createObjectURL(first) : null,
    );
  }

  const count = files.length;
  const totalKb = files.reduce((sum, f) => sum + f.size, 0) / 1024;

  return (
    <label className="block cursor-pointer">
      <input
        type="file"
        name={name}
        accept="image/*"
        required={required}
        multiple={multiple}
        onChange={onChange}
        className="sr-only"
      />
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface-2 px-4 py-4 transition hover:border-accent">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="preview" className="h-14 w-14 rounded-md object-cover" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-md border border-border bg-surface-3 text-muted">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.6-4.6a2 2 0 012.8 0L16 16m-2-2l1.6-1.6a2 2 0 012.8 0L20 14M14 8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {count === 0
              ? multiple
                ? "Choose screenshots"
                : "Choose a screenshot"
              : count === 1
                ? files[0].name
                : `${count} screenshots selected`}
          </div>
          <div className="text-xs text-muted-2">
            {count === 0
              ? multiple
                ? "PNG or JPG — pick one or several, up to ~10MB each"
                : "PNG or JPG, up to ~10MB"
              : `${totalKb.toFixed(0)} KB total`}
          </div>
        </div>
      </div>
    </label>
  );
}
