"use client";

import { useActionState } from "react";
import { saveProfile, type FormState } from "./actions";
import { Field } from "@/components/ui";
import { RadioCards, CheckPills, SubmitButton } from "@/components/interactive";
import {
  SPORTS,
  GOALS,
  SEXES,
  DEVICES,
  TRAINING_AGES,
  COACHING_TONES,
  FATIGUE_TENDENCIES,
} from "@/lib/constants";
import type { AthleteProfile } from "@/lib/types";

const initial: FormState = { error: null };

export function OnboardingForm({
  profile,
  defaultName,
}: {
  profile: AthleteProfile | null;
  defaultName: string;
}) {
  const [state, action] = useActionState(saveProfile, initial);
  const p = profile;

  return (
    <form action={action} className="space-y-8">
      {/* About you */}
      <section className="card space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
          About you
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="full_name" required>
            <input
              id="full_name"
              name="full_name"
              required
              defaultValue={p?.full_name ?? defaultName}
              className="input"
              placeholder="Jordan Athlete"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="Age" htmlFor="age">
            <input id="age" name="age" type="number" min={10} max={100} defaultValue={p?.age ?? ""} className="input" />
          </Field>
          <Field label="Sex" htmlFor="sex">
            <select id="sex" name="sex" defaultValue={p?.sex ?? ""} className="input">
              <option value="">—</option>
              {SEXES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Height (in)" htmlFor="height_in">
            <input id="height_in" name="height_in" type="number" inputMode="decimal" step="any" defaultValue={p?.height_in ?? ""} className="input" />
          </Field>
          <Field label="Weight (lbs)" htmlFor="body_weight_lbs">
            <input id="body_weight_lbs" name="body_weight_lbs" type="number" inputMode="decimal" step="any" defaultValue={p?.body_weight_lbs ?? ""} className="input" />
          </Field>
        </div>
      </section>

      {/* Your training */}
      <section className="card space-y-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
          Your training
        </h3>

        <Field label="Primary sport" required>
          <RadioCards name="primary_sport" options={SPORTS} defaultValue={p?.primary_sport ?? null} columns={4} />
        </Field>

        <div>
          <span className="label">Experience level</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {TRAINING_AGES.map((t) => (
              <label key={t.value} className="cursor-pointer">
                <input
                  type="radio"
                  name="training_age"
                  value={t.value}
                  defaultChecked={p?.training_age === t.value}
                  className="peer sr-only"
                />
                <div className="h-full rounded-lg border border-border bg-surface-2 p-3 transition hover:border-border-strong peer-checked:border-accent peer-checked:bg-accent/10">
                  <div className="text-sm font-semibold text-foreground">{t.label}</div>
                  <div className="mt-0.5 text-xs text-muted">{t.hint}</div>
                </div>
              </label>
            ))}
          </div>
          <p className="hint">
            This sets your coaching style — advisor (a second set of eyes on your
            own system) or guide (more structured direction).
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Primary goal" htmlFor="primary_goal">
            <select id="primary_goal" name="primary_goal" defaultValue={p?.primary_goal ?? ""} className="input">
              <option value="">—</option>
              {GOALS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Training days / week" htmlFor="training_days_per_week">
            <input id="training_days_per_week" name="training_days_per_week" type="number" min={0} max={14} defaultValue={p?.training_days_per_week ?? ""} className="input" />
          </Field>
        </div>

        <Field label="Specific goal" htmlFor="goal_detail" hint="e.g. “Sub-3:00 marathon in October” or “add 20kg to my total”">
          <input id="goal_detail" name="goal_detail" defaultValue={p?.goal_detail ?? ""} className="input" placeholder="What are you chasing right now?" />
        </Field>

        <Field label="Current program" htmlFor="current_program" hint="What you're running now, if anything.">
          <input id="current_program" name="current_program" defaultValue={p?.current_program ?? ""} className="input" placeholder="e.g. 5/3/1, Norwegian singles, self-programmed" />
        </Field>
      </section>

      {/* Devices & health */}
      <section className="card space-y-5">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
          Devices &amp; health
        </h3>

        <Field label="Which devices do you use?" hint="You'll upload screenshots from these.">
          <CheckPills name="devices" options={DEVICES} defaultValues={p?.devices ?? []} />
        </Field>

        <Field label="Nutrition app" htmlFor="nutrition_app" hint="Or log food right in the app: the Nutrition tab reads plain English and folds the macros into your coach view.">
          <input id="nutrition_app" name="nutrition_app" defaultValue={p?.nutrition_app ?? ""} className="input" placeholder="MyFitnessPal, Cronometer, log in-app, none" />
        </Field>

        <Field label="Injuries or limitations" htmlFor="injuries" hint="Anything your coach should know — old or active.">
          <textarea id="injuries" name="injuries" defaultValue={p?.injuries ?? ""} className="input" placeholder="e.g. left shoulder impingement, managing it with band work" />
        </Field>
      </section>

      {/* How you want to be coached */}
      <section className="card space-y-5">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
            How you want to be coached
          </h3>
          <p className="hint mt-1">
            This is what makes the coaching feel like yours from day one — before
            it has weeks of your data to learn from.
          </p>
        </div>

        <div>
          <span className="label">Coaching tone</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {COACHING_TONES.map((t) => (
              <label key={t.value} className="cursor-pointer">
                <input
                  type="radio"
                  name="coaching_tone"
                  value={t.value}
                  defaultChecked={p?.coaching_tone === t.value}
                  className="peer sr-only"
                />
                <div className="h-full rounded-lg border border-border bg-surface-2 p-3 transition hover:border-border-strong peer-checked:border-accent peer-checked:bg-accent/10">
                  <div className="text-sm font-semibold text-foreground">{t.label}</div>
                  <div className="mt-0.5 text-xs text-muted">{t.hint}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div>
          <span className="label">When you're run down, you tend to…</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {FATIGUE_TENDENCIES.map((t) => (
              <label key={t.value} className="cursor-pointer">
                <input
                  type="radio"
                  name="fatigue_tendency"
                  value={t.value}
                  defaultChecked={p?.fatigue_tendency === t.value}
                  className="peer sr-only"
                />
                <div className="h-full rounded-lg border border-border bg-surface-2 p-3 transition hover:border-border-strong peer-checked:border-accent peer-checked:bg-accent/10">
                  <div className="text-sm font-semibold text-foreground">{t.label}</div>
                  <div className="mt-0.5 text-xs text-muted">{t.hint}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <Field label="Why does this goal matter to you?" htmlFor="motivation" hint="The deeper why — it helps the coach push the right buttons.">
          <textarea id="motivation" name="motivation" defaultValue={p?.motivation ?? ""} className="input" placeholder="e.g. first powerlifting meet this fall; want to prove to myself I can stay consistent" />
        </Field>

        <Field label="What makes coaching click for you?" htmlFor="coaching_wants" hint="What's worked or fallen flat with coaches/apps before.">
          <textarea id="coaching_wants" name="coaching_wants" defaultValue={p?.coaching_wants ?? ""} className="input" placeholder="e.g. tell me exactly what to do today; don't bury it in caveats" />
        </Field>

        <Field label="Life context" htmlFor="life_context" hint="Schedule, work/school, sleep, stress, anything that shapes your week.">
          <textarea id="life_context" name="life_context" defaultValue={p?.life_context ?? ""} className="input" placeholder="e.g. full-time student, train evenings, sleep slips during exam weeks" />
        </Field>

        <Field label="Training background" htmlFor="background" hint="Where you're coming from — history, best lifts/times, what you've tried.">
          <textarea id="background" name="background" defaultValue={p?.background ?? ""} className="input" placeholder="e.g. 4 years lifting, best total 1100; also box and play golf" />
        </Field>
      </section>

      {state.error ? (
        <div className="rounded-lg border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          {state.error}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        <SubmitButton pendingText="Saving…">
          {p ? "Save profile" : "Finish setup →"}
        </SubmitButton>
      </div>
    </form>
  );
}
