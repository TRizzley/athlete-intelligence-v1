"use client";

// Shown to athletes who onboarded before we collected a mobile number. They type
// it once and the prompt clears itself — the dashboard stops rendering it as soon
// as a number is on file (the save revalidates the page).

import { useActionState } from "react";
import { savePhone, type FormState } from "@/app/onboarding/actions";
import { SubmitButton } from "@/components/interactive";

const initial: FormState = { error: null };

export function AddPhonePrompt() {
  const [state, action] = useActionState(savePhone, initial);

  return (
    <form
      action={action}
      className="mb-5 rounded-2xl border border-accent/30 bg-accent/5 p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium text-foreground">Add your mobile number</p>
          <p className="mt-0.5 text-sm text-muted">
            So we can text you check-in reminders. Used only for that — reply STOP
            anytime to opt out.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            required
            placeholder="(555) 123-4567"
            className="input sm:w-48"
          />
          <SubmitButton pendingText="Saving…" variant="accent">
            Save
          </SubmitButton>
        </div>
      </div>
      {state.error ? (
        <p className="mt-2 text-sm text-danger">{state.error}</p>
      ) : null}
    </form>
  );
}
