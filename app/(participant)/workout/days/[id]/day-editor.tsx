"use client";

import { useActionState } from "react";
import {
  updateDay,
  deleteDay,
  addExercise,
  updateExercise,
  removeExerciseInline,
  type FormState,
} from "../../actions";
import { Field } from "@/components/ui";
import { SubmitButton } from "@/components/interactive";
import type { WorkoutDay, WorkoutExercise } from "@/lib/types";

const initial: FormState = { error: null };

export function DayEditor({
  day,
  exercises,
}: {
  day: WorkoutDay;
  exercises: WorkoutExercise[];
}) {
  return (
    <div className="space-y-6">
      <RenameDay day={day} />

      <section className="card space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
          Exercises
        </h3>

        {exercises.length === 0 ? (
          <p className="text-sm text-muted-2">No exercises yet — add your first below.</p>
        ) : (
          <div className="space-y-2">
            <div className="hidden grid-cols-[1fr_3.5rem_4.5rem_1fr_2rem] gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-2 sm:grid">
              <span>Exercise</span>
              <span>Sets</span>
              <span>Reps</span>
              <span>Muscle group</span>
              <span></span>
            </div>
            {exercises.map((ex) => (
              <ExerciseRow key={ex.id} ex={ex} />
            ))}
          </div>
        )}

        <AddExerciseForm dayId={day.id} />
      </section>

      <DeleteDay dayId={day.id} dayName={day.name} />
    </div>
  );
}

function RenameDay({ day }: { day: WorkoutDay }) {
  const [state, action] = useActionState(updateDay, initial);
  return (
    <form action={action} className="card space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
        Day
      </h3>
      <input type="hidden" name="id" value={day.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="name" required>
          <input id="name" name="name" required defaultValue={day.name} className="input" />
        </Field>
        <Field label="Group (optional)" htmlFor="label">
          <input id="label" name="label" defaultValue={day.label ?? ""} className="input" />
        </Field>
      </div>
      {state.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {state.error}
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-3">
        {state.ok ? <span className="text-xs text-success">Saved</span> : null}
        <SubmitButton pendingText="Saving…">Save day</SubmitButton>
      </div>
    </form>
  );
}

function ExerciseRow({ ex }: { ex: WorkoutExercise }) {
  const [state, action] = useActionState(updateExercise, initial);
  return (
    <form
      action={action}
      className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface-2 p-2 sm:grid-cols-[1fr_3.5rem_4.5rem_1fr_auto] sm:items-center sm:border-0 sm:bg-transparent sm:p-0"
    >
      <input type="hidden" name="id" value={ex.id} />
      <input type="hidden" name="workout_day_id" value={ex.workout_day_id} />
      <input
        name="name"
        required
        defaultValue={ex.name}
        className="input col-span-2 sm:col-span-1"
        placeholder="Exercise"
      />
      <input
        name="target_sets"
        type="number"
        inputMode="numeric"
        min="0"
        defaultValue={ex.target_sets ?? ""}
        className="input"
        placeholder="Sets"
      />
      <input
        name="target_reps"
        defaultValue={ex.target_reps ?? ""}
        className="input"
        placeholder="Reps"
      />
      <input
        name="muscle_group"
        defaultValue={ex.muscle_group ?? ""}
        className="input col-span-2 sm:col-span-1"
        placeholder="Muscle group"
      />
      <div className="col-span-2 flex items-center justify-end gap-2 sm:col-span-1">
        {state.ok ? <span className="text-xs text-success">Saved</span> : null}
        <button type="submit" className="btn-ghost px-2.5 py-1 text-xs" title="Save exercise">
          Save
        </button>
        <button
          type="submit"
          formAction={removeExerciseInline}
          formNoValidate
          className="rounded-md p-1.5 text-muted-2 transition hover:bg-danger/20 hover:text-danger"
          title="Remove exercise"
          aria-label="Remove exercise"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0v12a1 1 0 001 1h6a1 1 0 001-1V7" />
          </svg>
        </button>
      </div>
    </form>
  );
}

function AddExerciseForm({ dayId }: { dayId: string }) {
  const [state, action] = useActionState(addExercise, initial);
  return (
    <form
      action={action}
      className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-dashed border-border-strong p-2 sm:grid-cols-[1fr_3.5rem_4.5rem_1fr_auto] sm:items-center"
    >
      <input type="hidden" name="workout_day_id" value={dayId} />
      <input name="name" required className="input col-span-2 sm:col-span-1" placeholder="Add exercise…" />
      <input name="target_sets" type="number" inputMode="numeric" min="0" className="input" placeholder="Sets" />
      <input name="target_reps" className="input" placeholder="Reps" />
      <input name="muscle_group" className="input col-span-2 sm:col-span-1" placeholder="Muscle group" />
      <div className="col-span-2 flex justify-end sm:col-span-1">
        <SubmitButton pendingText="Adding…" variant="accent" className="px-3 py-1.5 text-sm">
          Add
        </SubmitButton>
      </div>
      {state.error ? (
        <div className="col-span-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger sm:col-span-5">
          {state.error}
        </div>
      ) : null}
    </form>
  );
}

function DeleteDay({ dayId, dayName }: { dayId: string; dayName: string }) {
  const [, action] = useActionState(deleteDay, initial);
  return (
    <form action={action} className="flex justify-end">
      <input type="hidden" name="id" value={dayId} />
      <button
        type="submit"
        className="btn-ghost text-sm text-muted hover:text-danger"
        title={`Delete ${dayName}`}
      >
        Delete this day
      </button>
    </form>
  );
}
