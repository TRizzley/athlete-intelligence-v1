"use client";

import Link from "next/link";
import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  startSession,
  startAdhocSession,
  saveSession,
  discardSessionInline,
  autosaveSetLog,
  autosaveSessionNotes,
  addSetToExercise,
  addExerciseToSession,
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
      <div className="space-y-3">
        <div className="card text-center">
          <p className="font-medium text-foreground">No workout days yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            Build your split first — add your training days and the exercises in each.
          </p>
          <Link href="/workout/days" className="btn-accent mt-4 inline-flex">
            Build my split
          </Link>
        </div>
        <AdhocStart localToday={localToday} />
      </div>
    );
  }

  // If today's workout is already chosen, show the logger (unless changing).
  if (sessionIsToday && session && !changing) {
    return (
      <SessionLogger
        key={session.id}
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
   <div className="space-y-3">
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
    <AdhocStart localToday={localToday} />
   </div>
  );
}

// ---------------------------------------------------------------------------
// Start a workout "on the fly" — an empty, off-plan session you build live.
// ---------------------------------------------------------------------------
function AdhocStart({ localToday }: { localToday: string }) {
  const [state, action] = useActionState(startAdhocSession, initial);

  return (
    <form action={action} className="card space-y-3">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
          Or train off-plan
        </h3>
        <p className="mt-1 text-sm text-muted">
          Not one of your days? Start a quick workout and add exercises as you go.
        </p>
      </div>

      <input type="hidden" name="session_date" value={localToday} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Name (optional)" htmlFor="adhoc_name">
          <input
            id="adhoc_name"
            name="name"
            placeholder="Hotel gym, pickup session…"
            className="input sm:w-64"
          />
        </Field>
        <SubmitButton pendingText="Starting…">Start quick workout</SubmitButton>
      </div>

      {state.error ? (
        <p className="text-sm text-danger">{state.error}</p>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Log weight + reps for each set of today's chosen workout.
//
// Everything autosaves as you type (debounced), so an accidental close never
// loses what you entered. The session stays "in progress" until you press Save,
// which finalizes it. A progress bar + auto-focus on the first empty set let you
// pick up exactly where you left off.
// ---------------------------------------------------------------------------

type SetValue = { weight: string; reps: string };
const AUTOSAVE_MS = 700;

function toWeight(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function toReps(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

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

  // Live values, keyed by set-log id, seeded from what's already saved.
  const [values, setValues] = useState<Record<string, SetValue>>(() => {
    const init: Record<string, SetValue> = {};
    for (const l of logs) {
      init[l.id] = {
        weight: l.weight === null || l.weight === undefined ? "" : String(l.weight),
        reps: l.reps === null || l.reps === undefined ? "" : String(l.reps),
      };
    }
    return init;
  });
  const [notes, setNotes] = useState(session.notes ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  // In-session editing: add a set, add an exercise, pair as a superset.
  const [, startEdit] = useTransition();
  const [addingExercise, setAddingExercise] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMuscle, setNewMuscle] = useState("");
  const [supersetPrev, setSupersetPrev] = useState(false);

  function addSet(name: string, muscle: string | null, superset: string | null) {
    startEdit(async () => {
      await addSetToExercise(session.id, name, muscle, superset);
    });
  }

  function submitNewExercise() {
    const name = newName.trim();
    if (!name) return;
    const muscle = newMuscle.trim() || null;
    const pairing = supersetPrev;
    setNewName("");
    setNewMuscle("");
    setSupersetPrev(false);
    setAddingExercise(false);
    startEdit(async () => {
      await addExerciseToSession(session.id, name, muscle, pairing);
    });
  }

  // Per-id debounce timers; a ref so re-renders don't reset them.
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const weightRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Resume: on mount, jump to the first set without a weight logged.
  useEffect(() => {
    const firstEmpty = logs.find(
      (l) => (values[l.id]?.weight ?? "") === "",
    );
    if (firstEmpty) {
      const el = weightRefs.current[firstEmpty.id];
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.focus({ preventScroll: true });
    }
    // Only on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function scheduleSetSave(id: string, next: SetValue) {
    setSaveState("saving");
    if (timers.current[id]) clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(async () => {
      await autosaveSetLog(id, toWeight(next.weight), toReps(next.reps));
      setSaveState("saved");
    }, AUTOSAVE_MS);
  }

  function onField(id: string, field: keyof SetValue, v: string) {
    setValues((prev) => {
      const next = { ...(prev[id] ?? { weight: "", reps: "" }), [field]: v };
      scheduleSetSave(id, next);
      return { ...prev, [id]: next };
    });
  }

  function onNotes(v: string) {
    setNotes(v);
    setSaveState("saving");
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(async () => {
      await autosaveSessionNotes(session.id, v);
      setSaveState("saved");
    }, AUTOSAVE_MS);
  }

  // Group sets by exercise, preserving order.
  const groups = useMemo(() => {
    const out: {
      name: string;
      muscle: string | null;
      superset: string | null;
      sets: WorkoutSetLog[];
    }[] = [];
    for (const l of logs) {
      let g = out.find((x) => x.name === l.exercise_name);
      if (!g) {
        g = {
          name: l.exercise_name,
          muscle: l.muscle_group,
          superset: l.superset_group,
          sets: [],
        };
        out.push(g);
      }
      g.sets.push(l);
    }
    return out;
  }, [logs]);

  // Progress = sets with any weight or reps entered.
  const total = logs.length;
  const done = logs.filter((l) => {
    const v = values[l.id];
    return v && (v.weight.trim() !== "" || v.reps.trim() !== "");
  }).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const logIds = logs.map((l) => l.id).join(",");
  const isCompleted = session.status === "completed";

  return (
    <form action={action} className="space-y-4">
      <div className="card space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
              Today&apos;s workout
            </h3>
            <p className="mt-0.5 text-lg font-semibold text-foreground">
              {session.day_name ?? "Quick workout"}
            </p>
            <p className="text-sm text-muted">{formatDate(session.session_date)}</p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`pill ${
                isCompleted
                  ? "bg-success-soft text-success"
                  : "bg-accent/15 text-accent"
              }`}
            >
              {isCompleted ? "Saved" : "In progress"}
            </span>
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

        {/* Progress — pick up where you left off. */}
        {total > 0 ? (
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-muted-2">
              <span>{done} of {total} sets logged</span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

      <input type="hidden" name="session_id" value={session.id} />
      <input type="hidden" name="log_ids" value={logIds} />

      {total === 0 ? (
        <div className="card text-center text-sm text-muted">
          No exercises yet — add your first one below to start logging.
        </div>
      ) : null}

      {groups.map((g) => (
        <section
          key={g.name}
          className={`card space-y-3 ${
            g.superset ? "border-l-2 border-l-accent" : ""
          }`}
        >
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline gap-2">
              <h4 className="text-sm font-semibold text-foreground">{g.name}</h4>
              {g.superset ? (
                <span className="pill bg-accent/15 text-accent">Superset</span>
              ) : null}
            </div>
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
                  ref={(el) => {
                    weightRefs.current[s.id] = el;
                  }}
                  name={`weight_${s.id}`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0"
                  value={values[s.id]?.weight ?? ""}
                  onChange={(e) => onField(s.id, "weight", e.target.value)}
                  placeholder="—"
                  className="input"
                />
                <input
                  name={`reps_${s.id}`}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={values[s.id]?.reps ?? ""}
                  onChange={(e) => onField(s.id, "reps", e.target.value)}
                  placeholder={s.target_reps ?? "—"}
                  className="input"
                />
                <span className="text-right text-sm tabular-nums text-muted-2">
                  {s.target_reps ?? "—"}
                </span>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => addSet(g.name, g.muscle, g.superset)}
            className="text-sm font-medium text-accent hover:underline"
          >
            + Add set
          </button>
        </section>
      ))}

      {/* Add an exercise (or a superset) mid-workout. */}
      {addingExercise ? (
        <div className="card space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Exercise" htmlFor="new_exercise">
              <input
                id="new_exercise"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitNewExercise();
                  }
                }}
                placeholder="Incline DB press"
                className="input"
              />
            </Field>
            <Field label="Muscle (optional)" htmlFor="new_muscle">
              <input
                id="new_muscle"
                value={newMuscle}
                onChange={(e) => setNewMuscle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitNewExercise();
                  }
                }}
                placeholder="chest"
                className="input"
              />
            </Field>
          </div>
          {groups.length > 0 ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={supersetPrev}
                onChange={(e) => setSupersetPrev(e.target.checked)}
                className="h-4 w-4 accent-accent"
              />
              Pair as a superset with{" "}
              <span className="font-medium text-foreground">
                {groups[groups.length - 1].name}
              </span>
            </label>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitNewExercise}
              className="btn-accent text-sm"
            >
              Add exercise
            </button>
            <button
              type="button"
              onClick={() => {
                setAddingExercise(false);
                setNewName("");
                setNewMuscle("");
                setSupersetPrev(false);
              }}
              className="btn-ghost text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAddingExercise(true)}
          className="w-full rounded-2xl border border-dashed border-border-strong bg-surface/40 px-4 py-3 text-sm font-medium text-muted transition hover:border-accent hover:text-foreground"
        >
          + Add exercise
        </button>
      )}

      <section className="card space-y-3">
        <Field label="Session notes (optional)" htmlFor="notes">
          <textarea
            id="notes"
            name="notes"
            value={notes}
            onChange={(e) => onNotes(e.target.value)}
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
          Workout saved.
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-border bg-background/85 px-4 py-3 backdrop-blur">
        <p className="mr-auto text-xs text-muted-2">
          {saveState === "saving"
            ? "Autosaving…"
            : saveState === "saved"
              ? "All changes saved — nothing's lost if you close the app."
              : "Your entries autosave as you go."}
        </p>
        <SubmitButton pendingText="Saving…" variant="accent">
          {isCompleted ? "Update workout" : "Save workout"}
        </SubmitButton>
      </div>
    </form>
  );
}
