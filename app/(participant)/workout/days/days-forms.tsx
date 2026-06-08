"use client";

import { useActionState } from "react";
import { createDay, type FormState } from "../actions";
import { Field } from "@/components/ui";
import { SubmitButton } from "@/components/interactive";

const initial: FormState = { error: null };

export function NewDayForm() {
  const [state, action] = useActionState(createDay, initial);
  return (
    <form action={action} className="card space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
        Add a workout day
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="name" required hint="e.g. Push, Pull, Legs, Upper 1">
          <input id="name" name="name" required className="input" placeholder="Push" />
        </Field>
        <Field label="Group (optional)" htmlFor="label" hint="e.g. Push / Pull / Legs">
          <input id="label" name="label" className="input" placeholder="Push" />
        </Field>
      </div>
      {state.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {state.error}
        </div>
      ) : null}
      <div className="flex justify-end">
        <SubmitButton pendingText="Creating…" variant="accent">
          Create day →
        </SubmitButton>
      </div>
    </form>
  );
}
