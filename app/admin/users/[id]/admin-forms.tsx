"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  saveCoachResponse,
  deleteCoachResponse,
  createPrediction,
  recordOutcome,
  deletePrediction,
  addMemoryNote,
  deleteMemoryNote,
  saveTrustSnapshot,
  type FormState,
} from "./actions";
import { Field } from "@/components/ui";
import {
  CONFIDENCE_OPTIONS,
  HORIZON_OPTIONS,
  OUTCOME_OPTIONS,
} from "@/lib/constants";
import type { CoachResponse, Prediction, PredictionOutcome } from "@/lib/types";

const initial: FormState = { error: null };

function ErrorLine({ state }: { state: FormState }) {
  if (!state.error) return null;
  return (
    <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
      {state.error}
    </div>
  );
}

// Submit button carrying an `intent` value (draft vs send).
function IntentButton({
  value,
  children,
  variant,
}: {
  value: string;
  children: React.ReactNode;
  variant: "ghost" | "accent" | "primary";
}) {
  const { pending } = useFormStatus();
  const cls =
    variant === "accent" ? "btn-accent" : variant === "primary" ? "btn-primary" : "btn-ghost";
  return (
    <button type="submit" name="intent" value={value} disabled={pending} className={`${cls} btn-sm`}>
      {pending ? "Saving…" : children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Generic action button (used for destructive / one-click actions).
// ---------------------------------------------------------------------------
export function ActionButton({
  action,
  hidden,
  children,
  variant = "ghost",
  confirm,
  title,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  hidden: Record<string, string>;
  children: React.ReactNode;
  variant?: "ghost" | "danger" | "accent" | "primary";
  confirm?: string;
  title?: string;
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  const ref = useRef<HTMLFormElement>(null);
  const cls =
    variant === "danger"
      ? "btn-danger"
      : variant === "accent"
        ? "btn-accent"
        : variant === "primary"
          ? "btn-primary"
          : "btn-ghost";
  return (
    <form ref={ref} action={formAction} className="inline-flex flex-col items-end gap-1">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button
        type="button"
        disabled={pending}
        title={title}
        onClick={() => {
          if (!confirm || window.confirm(confirm)) ref.current?.requestSubmit();
        }}
        className={`${cls} btn-sm`}
      >
        {pending ? "…" : children}
      </button>
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Coach response composer (create or edit a daily decision).
// ---------------------------------------------------------------------------
export function ResponseComposer({
  userId,
  editing,
  dateISO,
}: {
  userId: string;
  editing?: CoachResponse;
  dateISO: string;
}) {
  const [state, formAction] = useActionState(saveCoachResponse, initial);
  const ref = useRef<HTMLFormElement>(null);
  const isCreate = !editing;

  useEffect(() => {
    if (state.ok && isCreate) ref.current?.reset();
  }, [state, isCreate]);

  const r = editing;

  return (
    <form ref={ref} action={formAction} className="space-y-3.5">
      <input type="hidden" name="user_id" value={userId} />
      {editing ? <input type="hidden" name="response_id" value={editing.id} /> : null}

      <div className="grid gap-3.5 sm:grid-cols-[1fr_180px]">
        <Field label="What your coach noticed" htmlFor={`wn-${r?.id ?? "new"}`}>
          <textarea
            id={`wn-${r?.id ?? "new"}`}
            name="what_noticed"
            defaultValue={r?.what_noticed ?? ""}
            className="input min-h-[72px]"
            placeholder="The specific, non-obvious observation. Be concrete and personal."
          />
        </Field>
        <div className="space-y-3.5">
          <Field label="Date" htmlFor={`rd-${r?.id ?? "new"}`}>
            <input
              id={`rd-${r?.id ?? "new"}`}
              name="response_date"
              type="date"
              defaultValue={r?.response_date ?? dateISO}
              className="input"
            />
          </Field>
          <Field label="Confidence" htmlFor={`cf-${r?.id ?? "new"}`}>
            <select id={`cf-${r?.id ?? "new"}`} name="confidence" defaultValue={r?.confidence ?? ""} className="input">
              <option value="">—</option>
              {CONFIDENCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <Field label="Why it matters" htmlFor={`wm-${r?.id ?? "new"}`}>
        <textarea id={`wm-${r?.id ?? "new"}`} name="why_it_matters" defaultValue={r?.why_it_matters ?? ""} className="input min-h-[60px]" placeholder="Why this observation matters for their goal today." />
      </Field>

      <Field label="Today's recommendation" htmlFor={`rc-${r?.id ?? "new"}`}>
        <textarea id={`rc-${r?.id ?? "new"}`} name="recommendation" defaultValue={r?.recommendation ?? ""} className="input min-h-[60px]" placeholder="The single clear call: push, hold, or back off — and exactly how." />
      </Field>

      <Field label="Prediction for tomorrow" htmlFor={`pr-${r?.id ?? "new"}`}>
        <textarea id={`pr-${r?.id ?? "new"}`} name="prediction" defaultValue={r?.prediction ?? ""} className="input min-h-[52px]" placeholder="A specific, verifiable call they can check tomorrow." />
      </Field>

      <Field label="What data you used" htmlFor={`du-${r?.id ?? "new"}`}>
        <textarea id={`du-${r?.id ?? "new"}`} name="data_used" defaultValue={r?.data_used ?? ""} className="input min-h-[52px]" placeholder="HRV trend, sleep, soreness, the WHOOP screenshot, their note about work stress…" />
      </Field>

      <ErrorLine state={state} />

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-2">
          {editing
            ? editing.status === "sent"
              ? "This response is live for the athlete."
              : "Draft — not visible to the athlete yet."
            : "New response — saves as a draft until you send it."}
        </span>
        <div className="flex gap-2">
          <IntentButton value="draft" variant="ghost">
            {editing ? "Save draft" : "Save draft"}
          </IntentButton>
          <IntentButton value="send" variant="accent">
            {editing?.status === "sent" ? "Re-send" : "Save & send"}
          </IntentButton>
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Prediction creation
// ---------------------------------------------------------------------------
export function PredictionForm({
  userId,
  dateISO,
}: {
  userId: string;
  dateISO: string;
}) {
  const [state, formAction] = useActionState(createPrediction, initial);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={formAction} className="space-y-3">
      <input type="hidden" name="user_id" value={userId} />
      <Field label="New prediction" htmlFor="prediction_text">
        <textarea id="prediction_text" name="prediction_text" className="input min-h-[52px]" placeholder="e.g. “Your readiness will dip tomorrow after today's load.”" />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Horizon" htmlFor="horizon">
          <select id="horizon" name="horizon" defaultValue="tomorrow" className="input">
            {HORIZON_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Confidence" htmlFor="pred_conf">
          <select id="pred_conf" name="confidence" defaultValue="" className="input">
            <option value="">—</option>
            {CONFIDENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Target date" htmlFor="target_date">
          <input id="target_date" name="target_date" type="date" defaultValue={dateISO} className="input" />
        </Field>
      </div>
      <ErrorLine state={state} />
      <div className="flex justify-end">
        <SubmitInline>Add prediction</SubmitInline>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Outcome recording (inline, per prediction)
// ---------------------------------------------------------------------------
export function OutcomeForm({
  userId,
  prediction,
  outcome,
}: {
  userId: string;
  prediction: Prediction;
  outcome: PredictionOutcome | null;
}) {
  const [state, formAction] = useActionState(recordOutcome, initial);
  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="prediction_id" value={prediction.id} />
      <select name="outcome" defaultValue={outcome?.outcome ?? ""} className="input h-9 w-auto py-1 text-xs">
        <option value="">Set outcome…</option>
        {OUTCOME_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <input name="notes" defaultValue={outcome?.notes ?? ""} placeholder="note (optional)" className="input h-9 w-auto flex-1 py-1 text-xs" />
      <SubmitInline small>Save</SubmitInline>
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Memory note
// ---------------------------------------------------------------------------
export function MemoryNoteForm({ userId }: { userId: string }) {
  const [state, formAction] = useActionState(addMemoryNote, initial);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={formAction} className="space-y-2">
      <input type="hidden" name="user_id" value={userId} />
      <div className="flex gap-2">
        <input name="category" placeholder="tag (e.g. pattern)" className="input h-9 w-32 py-1 text-xs" />
        <input name="note" placeholder="Something to remember about this athlete…" className="input h-9 flex-1 py-1 text-sm" />
      </div>
      <ErrorLine state={state} />
      <div className="flex justify-end">
        <SubmitInline small>Add note</SubmitInline>
      </div>
    </form>
  );
}

export function TrustSnapshotButton({ userId }: { userId: string }) {
  return (
    <ActionButton action={saveTrustSnapshot} hidden={{ user_id: userId }} variant="ghost">
      Save snapshot
    </ActionButton>
  );
}

export function DeleteResponseButton({
  userId,
  responseId,
}: {
  userId: string;
  responseId: string;
}) {
  return (
    <ActionButton
      action={deleteCoachResponse}
      hidden={{ user_id: userId, response_id: responseId }}
      variant="danger"
      confirm="Delete this coaching response?"
    >
      Delete
    </ActionButton>
  );
}

export function DeletePredictionButton({
  userId,
  predictionId,
}: {
  userId: string;
  predictionId: string;
}) {
  return (
    <ActionButton
      action={deletePrediction}
      hidden={{ user_id: userId, prediction_id: predictionId }}
      variant="danger"
      confirm="Delete this prediction?"
    >
      Delete
    </ActionButton>
  );
}

export function DeleteMemoryNoteButton({
  userId,
  noteId,
}: {
  userId: string;
  noteId: string;
}) {
  return (
    <ActionButton
      action={deleteMemoryNote}
      hidden={{ user_id: userId, note_id: noteId }}
      variant="ghost"
      confirm="Delete this note?"
      title="Delete note"
    >
      ✕
    </ActionButton>
  );
}

// A plain submit button that reflects pending state (for forms above).
function SubmitInline({
  children,
  small,
}: {
  children: React.ReactNode;
  small?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={`btn-primary ${small ? "btn-sm" : "btn-sm"}`}>
      {pending ? "Saving…" : children}
    </button>
  );
}
