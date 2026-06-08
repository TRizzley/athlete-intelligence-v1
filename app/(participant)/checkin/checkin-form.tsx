"use client";

import { useActionState, useEffect, useState } from "react";
import { saveCheckin, type FormState } from "./actions";
import { Field } from "@/components/ui";
import { Slider, RadioCards, CheckPills, SubmitButton } from "@/components/interactive";
import { WORKOUT_TYPES, WORKOUT_SPLITS } from "@/lib/constants";
import { todayISO } from "@/lib/format";
import type { DailyCheckin } from "@/lib/types";

const initial: FormState = { error: null };

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No / rest" },
];

export function CheckinForm({
  existing,
  dateISO,
}: {
  existing: DailyCheckin | null;
  dateISO: string;
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

      {/* Recovery & sleep */}
      <section className="card space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
          Recovery &amp; sleep
        </h3>
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

      {/* Training */}
      <section className="card space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
          Today's training
        </h3>
        <Field label="Did you train (or plan to)?">
          <RadioCards name="workout_completed" options={YES_NO} defaultValue={c?.workout_completed === null || c?.workout_completed === undefined ? null : c.workout_completed ? "yes" : "no"} columns={2} />
        </Field>
        <Field label="Workout type" hint="Pick all that apply.">
          <CheckPills
            name="workout_types"
            options={WORKOUT_TYPES}
            defaultValues={c?.workout_types ?? (c?.workout_type ? [c.workout_type] : [])}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Split" htmlFor="workout_split" hint="What you trained today">
            <select id="workout_split" name="workout_split" defaultValue={c?.workout_split ?? ""} className="input">
              <option value="">—</option>
              {WORKOUT_SPLITS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Slider name="workout_intensity" label="Intensity / effort (RPE)" low="Easy" high="All-out" defaultValue={c?.workout_intensity ?? 5} />
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

      {/* Fuel */}
      <section className="card space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
          Fuel
        </h3>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Field label="Calories" htmlFor="calories">
            <input id="calories" name="calories" type="number" min="0" defaultValue={c?.calories ?? ""} className="input" />
          </Field>
          <Field label="Protein (g)" htmlFor="protein_g">
            <input id="protein_g" name="protein_g" type="number" min="0" defaultValue={c?.protein_g ?? ""} className="input" />
          </Field>
          <Field label="Carbs (g)" htmlFor="carbs_g">
            <input id="carbs_g" name="carbs_g" type="number" min="0" defaultValue={c?.carbs_g ?? ""} className="input" />
          </Field>
          <Field label="Fat (g)" htmlFor="fat_g">
            <input id="fat_g" name="fat_g" type="number" min="0" defaultValue={c?.fat_g ?? ""} className="input" />
          </Field>
          <Field label="Water (oz)" htmlFor="water_oz">
            <input id="water_oz" name="water_oz" type="number" inputMode="decimal" step="any" min="0" defaultValue={c?.water_oz ?? ""} className="input" />
          </Field>
        </div>
      </section>

      {/* How you feel */}
      <section className="card space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
          How you feel
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Slider name="energy" label="Energy" low="Exhausted" high="Energized" defaultValue={c?.energy ?? 5} />
          <Slider name="mood" label="Mood" low="Terrible" high="Excellent" defaultValue={c?.mood ?? 5} />
          <Slider name="soreness" label="Muscle soreness" low="None" high="Severe" defaultValue={c?.soreness ?? 3} />
          <Slider name="stress" label="Stress" low="Calm" high="Very stressed" defaultValue={c?.stress ?? 4} />
          <Slider name="motivation" label="Motivation to train" low="None" high="High" defaultValue={c?.motivation ?? 6} />
          <Slider name="sleep_quality" label="Sleep quality (felt)" low="Terrible" high="Great" defaultValue={c?.sleep_quality ?? 6} />
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
          {c ? "Update check-in" : "Submit check-in"}
        </SubmitButton>
      </div>
    </form>
  );
}
