"use client";

import { useActionState } from "react";
import { saveFeedback, type FormState } from "./actions";
import { Field } from "@/components/ui";
import { RadioCards, SubmitButton } from "@/components/interactive";
import {
  YSN_OPTIONS,
  PREDICTION_FEEDBACK_OPTIONS,
  WOULD_PAY_OPTIONS,
} from "@/lib/constants";
import type { UserFeedback } from "@/lib/types";

const initial: FormState = { error: null };

export function FeedbackForm({
  responseId,
  existing,
}: {
  responseId: string;
  existing: UserFeedback | null;
}) {
  const [state, action] = useActionState(saveFeedback, initial);
  const f = existing;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="coach_response_id" value={responseId} />

      {/* Prediction rating first — the prediction text is displayed above the form
          so it's fresh in mind when the athlete hits this question. */}
      <Question label="Did the prediction come true?" hint="Compare against the prediction shown above.">
        <RadioCards name="prediction_came_true" options={PREDICTION_FEEDBACK_OPTIONS} defaultValue={f?.prediction_came_true ?? null} columns={4} />
      </Question>

      <Question label="Did this feel accurate?" hint="Did it match what your body was actually telling you?">
        <RadioCards name="felt_accurate" options={YSN_OPTIONS} defaultValue={f?.felt_accurate ?? null} columns={3} />
      </Question>

      <Question label="Did this feel personalized?" hint="Did it feel like it was about you — not generic advice?">
        <RadioCards name="felt_personalized" options={YSN_OPTIONS} defaultValue={f?.felt_personalized ?? null} columns={3} />
      </Question>

      <Question label="Was the recommendation useful?" hint="Did it actually help you decide how to train?">
        <RadioCards name="was_useful" options={YSN_OPTIONS} defaultValue={f?.was_useful ?? null} columns={3} />
      </Question>

      <Question label="Would you pay for this if it kept improving over time?">
        <RadioCards name="would_pay" options={WOULD_PAY_OPTIONS} defaultValue={f?.would_pay ?? null} columns={3} />
      </Question>

      <Field label="Anything else?" htmlFor="free_text" hint="What landed, what missed, what you wish it said.">
        <textarea id="free_text" name="free_text" defaultValue={f?.free_text ?? ""} className="input" placeholder="Tell your coach in your own words…" />
      </Field>

      {state.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {state.error}
        </div>
      ) : null}

      <div className="flex justify-end">
        <SubmitButton pendingText="Sending…">
          {f ? "Update feedback" : "Send feedback"}
        </SubmitButton>
      </div>
    </form>
  );
}

function Question({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card-tight">
      <div className="mb-2.5">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {hint ? <div className="mt-0.5 text-xs text-muted-2">{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}
