"use client";

import { useActionState, useEffect, useState } from "react";
import { savePostWorkout, type FormState } from "./actions";
import { Field } from "@/components/ui";
import { Slider, RadioCards, CheckPills, SubmitButton } from "@/components/interactive";
import { WORKOUT_TYPES } from "@/lib/constants";
import { todayISO } from "@/lib/format";
import type { DailyCheckin } from "@/lib/types";

const initial: FormState = { error: null };

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No / rest" },
];

export function PostWorkoutForm({
  existing,
  dateISO,
  dayNames = [],
}: {
  existing: DailyCheckin | null;
  dateISO: string;
  dayNames?: string[];
}) {
  const [state, action] = useActionState(savePostWorkout, initial);
  const c = existing;

  // The split options are the athlete's own named workout days. If a previously
  // saved split isn't in that list (e.g. an old value, or a since-renamed day),
  // keep it as an option so the saved value still shows and isn't silently lost.
  const splitOptions = [...dayNames];
  if (c?.workout_split && !splitOptions.includes(c.workout_split)) {
    splitOptions.unshift(c.workout_split);
  }

  // Re-anchor the default date to the browser's local "today" once mounted, so
  // it matches the morning check-in's date even if the server's UTC day differs.
  const [localToday, setLocalToday] = useState(dateISO);
  const [checkinDate, setCheckinDate] = useState(c?.checkin_date ?? dateISO);
  useEffect(() => {
    const t = todayISO();
    setLocalToday(t);
    if (!c?.checkin_date) setCheckinDate(t);
  }, [c?.checkin_date]);

  // Has the training already been logged for this row?
  const alreadyLogged =
    c?.workout_completed !== null && c?.workout_completed !== undefined;

  return (
    <form action={action} className="space-y-6">
      <section className="card space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
          Date
        </h3>
        <Field label="Session date" htmlFor="checkin_date">
          <input
            id="checkin_date"
            name="checkin_date"
            type="date"
            value={checkinDate}
            onChange={(e) => setCheckinDate(e.target.value)}
            max={localToday}
            className="input max-w-[200px]"
          />
        </Field>
      </section>

      {/* Training */}
      <section className="card space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
          Today's training
        </h3>
        <Field label="Did you train?">
          <RadioCards
            name="workout_completed"
            options={YES_NO}
            defaultValue={
              c?.workout_completed === null || c?.workout_completed === undefined
                ? null
                : c.workout_completed
                  ? "yes"
                  : "no"
            }
            columns={2}
          />
        </Field>
        <Field label="Workout type" hint="Pick all that apply.">
          <CheckPills
            name="workout_types"
            options={WORKOUT_TYPES}
            defaultValues={c?.workout_types ?? (c?.workout_type ? [c.workout_type] : [])}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Split" htmlFor="workout_split" hint="Which of your workout days">
            <select id="workout_split" name="workout_split" defaultValue={c?.workout_split ?? ""} className="input">
              <option value="">—</option>
              {splitOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            {dayNames.length === 0 ? (
              <p className="mt-1.5 text-xs text-muted-2">
                No workout days yet — build your split under Workout to see them here.
              </p>
            ) : null}
          </Field>
          <Slider name="workout_intensity" label="Intensity / effort (RPE)" low="Easy" high="All-out" defaultValue={c?.workout_intensity ?? null} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Load / key lifts" htmlFor="training_load" hint='Free text — e.g. "Squat 225x5, 245x3"'>
            <input id="training_load" name="training_load" defaultValue={c?.training_load ?? ""} className="input" placeholder="225x5, 245x3" />
          </Field>
          <Field label="Top set (lbs)" htmlFor="top_set_lbs" hint="Optional — your heaviest set today">
            <input id="top_set_lbs" name="top_set_lbs" type="number" inputMode="decimal" step="any" min="0" defaultValue={c?.top_set_lbs ?? ""} className="input" placeholder="245" />
          </Field>
        </div>
      </section>

      {state.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {state.error}
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t border-border bg-background/85 px-4 py-3 backdrop-blur">
        <p className="mr-auto text-xs text-muted-2">
          {alreadyLogged ? "Editing today's session" : "Log this once you've trained"}
        </p>
        <SubmitButton pendingText="Saving…">
          {alreadyLogged ? "Update session" : "Log session"}
        </SubmitButton>
      </div>
    </form>
  );
}
