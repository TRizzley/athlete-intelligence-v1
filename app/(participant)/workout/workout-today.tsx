"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import {
  startSession,
  saveSession,
  discardSessionInline,
  type FormState,
} from "./actions";
import { Field } from "@/components/ui";
import { SubmitButton } from "@/components/interactive";
import { todayISO, formatDate } from "@/lib/format";
import type { WorkoutDay, WorkoutSession, WorkoutSetLog } from "@/lib/types";

const initial: FormState = { error: null };

type DayLite = Pick<WorkoutDay, "id" | "name" | "label">;

export function TodayWorkout({
  days,
  session,
  logs,
}: {
  days: DayLite[];
  session: WorkoutSession | null;
  logs: WorkoutSetLog[];
}) {
  // Determine the athlete's LOCAL today (server renders in UTC).
  const [localToday, setLocalToday] = useState(session?.session_date ?? "");
  useEffect(() => setLocalToday(todayISO()), []);

  const sessionIsToday = !!session && session.session_date === localToday;
  const [changing, setChanging] = useState(false);

  if (days.length === 0) {
    return (
      <div className="card text-center">
        <p className="font-medium text-foreground">No workout days yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
          Build your split first — add your training days and the exercises in each.
        </p>
        <Link href="/workout/days" className="btn-accent mt-4 inline-flex">
          Build my split
        </Link>
      </div>
    );
  }

  // If today's workout is already chosen, show the logger (unless changing).
  if (sessionIsToday && session && !changing) {
    return (
      <SessionLogger
        session={session}
        logs={logs}
        onChangeDay={() => setChanging(true)}
      />
    );
  }

  return (
    <DayPicker
      days={days}
      localToday={localToday}
      lastSession={session && !sessionIsToday ? session : null}
      onCancel={changing ? () => setChanging(false) : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// Pick a day to start today's workout.
// ---------------------------------------------------------------------------
function DayPicker({
  days,
  localToday,
  lastSession,
  onCancel,
}: {
  days: DayLite[];
  localToday: string;
  lastSession: WorkoutSession | null;
  onCancel?: () => void;
}) {
  const [state, action] = useActionState(startSession, initial);
  const [dayId, setDayId] = useState(days[0]?.id ?? "");

  return (
    <form action={action} className="card space-y-4">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
          Today&apos;s workout
        </h3>
        {lastSession ? (
          <p className="mt-1 text-sm text-muted">
            Last logged: <span className="text-foreground">{lastSession.day_name}</span> on{" "}
            {formatDate(lastSession.session_date)}. Pick today&apos;s day to start fresh.
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted">
            Pick the day you&apos;re training. We&apos;ll load its exercises so you just log your weights.
          </p>
        )}
      </div>

      <input type="hidden" name="session_date" value={localToday} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Workout day" htmlFor="workout_day_id">
          <select
            id="workout_day_id"
            name="workout_day_id"
            value={dayId}
            onChange={(e) => setDayId(e.target.value)}
            className="input sm:w-64"
          >
            {days.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.label ? ` — ${d.label}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex gap-2">
          <SubmitButton pendingText="Starting…" variant="accent">
            Start workout
          </SubmitButton>
          {onCancel ? (
            <button type="button" onClick={onCancel} className="btn-ghost">
              Cancel
            </button>
          ) : null}
        </div>
      </div>

      {state.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {state.error}
        </div>
      ) : null}

      <p className="text-xs text-muted-2">
        Need to change a day&apos;s exercises?{" "}
        <Link href="/workout/days" className="text-accent hover:underline">
          Edit your split
        </Link>
        .
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Log weight + reps for each set of today's chosen workout.
// ---------------------------------------------------------------------------
function SessionLogger({
  session,
  logs,
  onChangeDay,
}: {
  session: WorkoutSession;
  logs: WorkoutSetLog[];
  onChangeDay: () => void;
}) {
  const [state, action] = useActionState(saveSession, initial);

  // Group sets by exercise, preserving order.
  const groups = useMemo(() => {
    const out: { name: string; muscle: string | null; sets: WorkoutSetLog[] }[] = [];
    for (const l of logs) {
      let g = out.find((x) => x.name === l.exercise_name);
      if (!g) {
        g = { name: l.exercise_name, muscle: l.muscle_group, sets: [] };
        out.push(g);
      }
      g.sets.push(l);
    }
    return out;
  }, [logs]);

  const logIds = logs.map((l) => l.id).join(",");

  return (
    <form action={action} className="space-y-4">
      <div className="card space-y-1">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
              Today&apos;s workout
            </h3>
            <p className="mt-0.5 text-lg font-semibold text-foreground">
              {session.day_name ?? "Workout"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onChangeDay} className="btn-ghost text-sm">
              Change day
            </button>
            <button
              type="submit"
              formAction={discardSessionInline}
              formNoValidate
              className="btn-ghost text-sm text-muted hover:text-danger"
              title="Discard this workout"
            >
              Discard
            </button>
          </div>
        </div>
        <p className="text-sm text-muted">{formatDate(session.session_date)}</p>
      </div>

      <input type="hidden" name="session_id" value={session.id} />
      <input type="hidden" name="log_ids" value={logIds} />

      {groups.map((g) => (
        <section key={g.name} className="card space-y-3">
          <div className="flex items-baseline justify-between">
            <h4 className="text-sm font-semibold text-foreground">{g.name}</h4>
            {g.muscle ? (
              <span className="pill bg-surface-3 text-muted">{g.muscle}</span>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-[2.5rem_1fr_1fr_3rem] items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-2">
              <span>Set</span>
              <span>Weight (lbs)</span>
              <span>Reps</span>
              <span className="text-right">Target</span>
            </div>
            {g.sets.map((s) => (
              <div
                key={s.id}
                className="grid grid-cols-[2.5rem_1fr_1fr_3rem] items-center gap-2"
              >
                <span className="text-sm font-semibold tabular-nums text-muted">
                  {s.set_number}
                </span>
                <input
                  name={`weight_${s.id}`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  defaultValue={s.weight ?? ""}
                  placeholder="—"
                  className="input"
                />
                <input
                  name={`reps_${s.id}`}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  defaultValue={s.reps ?? ""}
                  placeholder={s.target_reps ?? "—"}
                  className="input"
                />
                <span className="text-right text-sm tabular-nums text-muted-2">
                  {s.target_reps ?? "—"}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="card space-y-3">
        <Field label="Session notes (optional)" htmlFor="notes">
          <textarea
            id="notes"
            name="notes"
            defaultValue={session.notes ?? ""}
            className="input min-h-[64px]"
            placeholder="Felt strong, bumped bench 5lbs, left elbow a little cranky…"
          />
        </Field>
      </section>

      {state.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {state.error}
        </div>
      ) : null}
      {state.ok ? (
        <div className="rounded-lg border border-success/30 bg-success-soft px-3.5 py-2.5 text-sm text-success">
          Saved.
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-border bg-background/85 px-4 py-3 backdrop-blur">
        <p className="mr-auto text-xs text-muted-2">
          Weights reset each day — this is what we track over time.
        </p>
        <SubmitButton pendingText="Saving…" variant="accent">
          Save workout
        </SubmitButton>
      </div>
    </form>
  );
}
