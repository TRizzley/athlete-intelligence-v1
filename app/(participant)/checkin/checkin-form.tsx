"use client";

import { useActionState, useEffect, useState } from "react";
import { saveCheckin, type FormState } from "./actions";
import { Field } from "@/components/ui";
import { Slider, SubmitButton } from "@/components/interactive";
import { todayISO } from "@/lib/format";
import type { DailyCheckin, WorkoutDay } from "@/lib/types";

const initial: FormState = { error: null };

type DayLite = Pick<WorkoutDay, "id" | "name" | "label">;

export function CheckinForm({
  existing,
  dateISO,
  workoutDays,
  whoopPrefilled = false,
}: {
  existing: DailyCheckin | null;
  dateISO: string;
  workoutDays: DayLite[];
  whoopPrefilled?: boolean;
}) {
  const [state, action] = useActionState(saveCheckin, initial);
  const c = existing;

  // The date defaults are computed on the server (UTC), which can be a day
  // ahead/behind the athlete's local calendar day. Re-anchor to the browser's
  // local "today" once mounted so the default date and the max are correct.
  const [localToday, setLocalToday] = useState(dateISO);
  const [checkinDate, setCheckinDate] = useState(c?.checkin_date ?? dateISO);
  useEffect(() => {
    const t = todayISO();
    setLocalToday(t);
    if (!c?.checkin_date) setCheckinDate(t);
  }, [c?.checkin_date]);

  return (
    <form action={action} className="space-y-6">
      <section className="card space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
            Date
          </h3>
        </div>
        <Field label="Check-in date" htmlFor="checkin_date">
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

      {/* This morning's recovery & sleep */}
      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
            This morning's recovery &amp; sleep
          </h3>
          {whoopPrefilled && (
            <span className="shrink-0 rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">
              Synced from WHOOP
            </span>
          )}
        </div>
        <p className="-mt-1 text-xs text-muted-2">
          The scores you woke up with today — last night's sleep and the recovery /
          HRV / resting HR your wearable gave you this morning. Not yesterday's.
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="Bed time" htmlFor="bed_time" hint="When you went to bed">
            <input id="bed_time" name="bed_time" type="time" defaultValue={c?.bed_time ?? ""} className="input" />
          </Field>
          <Field label="Wake time" htmlFor="wake_time" hint="When you woke up">
            <input id="wake_time" name="wake_time" type="time" defaultValue={c?.wake_time ?? ""} className="input" />
          </Field>
          <Field label="Sleep (hours)" htmlFor="sleep_hours" hint="Auto-fills from bed/wake if left blank">
            <input id="sleep_hours" name="sleep_hours" type="number" inputMode="decimal" step="any" min="0" max="16" defaultValue={c?.sleep_hours ?? ""} className="input" placeholder="7.5" />
          </Field>
          <Field label="Recovery score" htmlFor="recovery_score" hint="0–100 (WHOOP/Oura)">
            <input id="recovery_score" name="recovery_score" type="number" min="0" max="100" defaultValue={c?.recovery_score ?? ""} className="input" placeholder="68" />
          </Field>
          <Field label="HRV (ms)" htmlFor="hrv_ms">
            <input id="hrv_ms" name="hrv_ms" type="number" min="0" defaultValue={c?.hrv_ms ?? ""} className="input" placeholder="65" />
          </Field>
          <Field label="Resting HR" htmlFor="resting_hr">
            <input id="resting_hr" name="resting_hr" type="number" min="0" defaultValue={c?.resting_hr ?? ""} className="input" placeholder="52" />
          </Field>
          <Field label="Body weight (lbs)" htmlFor="body_weight_lbs">
            <input id="body_weight_lbs" name="body_weight_lbs" type="number" inputMode="decimal" step="any" defaultValue={c?.body_weight_lbs ?? ""} className="input" placeholder="185" />
          </Field>
        </div>
      </section>

      {/* Yesterday's macros (completed nutrition) */}
      <section className="card space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
          Yesterday's macros
        </h3>
        <p className="-mt-1 text-xs text-muted-2">
          Your completed nutrition from yesterday. You'll log today's training
          after you finish in the Post-workout check-in.
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Field label="Calories" htmlFor="calories">
            <input id="calories" name="calories" type="number" inputMode="decimal" step="any" min="0" defaultValue={c?.calories ?? ""} className="input" />
          </Field>
          <Field label="Protein (g)" htmlFor="protein_g">
            <input id="protein_g" name="protein_g" type="number" inputMode="decimal" step="any" min="0" defaultValue={c?.protein_g ?? ""} className="input" />
          </Field>
          <Field label="Carbs (g)" htmlFor="carbs_g">
            <input id="carbs_g" name="carbs_g" type="number" inputMode="decimal" step="any" min="0" defaultValue={c?.carbs_g ?? ""} className="input" />
          </Field>
          <Field label="Fat (g)" htmlFor="fat_g">
            <input id="fat_g" name="fat_g" type="number" inputMode="decimal" step="any" min="0" defaultValue={c?.fat_g ?? ""} className="input" />
          </Field>
          <Field label="Water (oz)" htmlFor="water_oz">
            <input id="water_oz" name="water_oz" type="number" inputMode="decimal" step="any" min="0" defaultValue={c?.water_oz ?? ""} className="input" />
          </Field>
        </div>
      </section>

      {/* Planned workout */}
      <section className="card space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
          Today&apos;s plan
        </h3>
        <p className="-mt-1 text-xs text-muted-2">
          What are you planning to train today? This is just for your coach&apos;s context — you&apos;re not locked in.
        </p>
        <Field label="Planned workout" htmlFor="workout_split">
          {workoutDays.length > 0 ? (
            <select
              id="workout_split"
              name="workout_split"
              defaultValue={existing?.workout_split ?? ""}
              className="input"
            >
              <option value="">— Not sure yet —</option>
              {workoutDays.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}{d.label ? ` — ${d.label}` : ""}
                </option>
              ))}
              <option value="Rest">Rest day</option>
              <option value="Other">Other / freestyle</option>
            </select>
          ) : (
            <input
              id="workout_split"
              name="workout_split"
              type="text"
              defaultValue={existing?.workout_split ?? ""}
              className="input"
              placeholder="e.g. Upper body, Legs, Rest day…"
            />
          )}
        </Field>
      </section>

      {/* How you feel */}
      <section className="card space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
          How you feel
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Slider name="energy" label="Energy" low="Exhausted" high="Energized" defaultValue={c?.energy ?? null} />
          <Slider name="mood" label="Mood" low="Terrible" high="Excellent" defaultValue={c?.mood ?? null} />
          <Slider name="soreness" label="Muscle soreness" low="None" high="Severe" defaultValue={c?.soreness ?? null} />
          <Slider name="stress" label="Stress" low="Calm" high="Very stressed" defaultValue={c?.stress ?? null} />
          <Slider name="motivation" label="Motivation to train" low="None" high="High" defaultValue={c?.motivation ?? null} />
          <Slider name="sleep_quality" label="Sleep quality (felt)" low="Terrible" high="Great" defaultValue={c?.sleep_quality ?? null} />
        </div>
      </section>

      {/* Notes */}
      <section className="card space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
          Anything else
        </h3>
        <Field label="Pain or injury note" htmlFor="pain_injury_note" hint="Leave blank if nothing's bothering you.">
          <textarea id="pain_injury_note" name="pain_injury_note" defaultValue={c?.pain_injury_note ?? ""} className="input min-h-[64px]" placeholder="e.g. left knee a little cranky on stairs" />
        </Field>
        <Field label="Open comments" htmlFor="open_comments" hint="Context your coach should know about today.">
          <textarea id="open_comments" name="open_comments" defaultValue={c?.open_comments ?? ""} className="input" placeholder="Big work deadline, slept badly, traveling, feeling strong…" />
        </Field>
      </section>

      {state.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {state.error}
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t border-border bg-background/85 px-4 py-3 backdrop-blur">
        <p className="mr-auto text-xs text-muted-2">
          {c ? "Editing today's check-in" : "Takes about 60 seconds"}
        </p>
        <SubmitButton pendingText="Saving…">
          {c ? "Update check-in" : "Check in & talk to your coach"}
        </SubmitButton>
      </div>
    </form>
  );
}
