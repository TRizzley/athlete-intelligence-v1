import type { DailyCheckin } from "@/lib/types";
import { DataPoint, Prose } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { labelFor, WORKOUT_TYPES } from "@/lib/constants";

// Renders a single check-in's full data set — the raw material the coach reads
// before writing a response.
export function CheckinDetail({ checkin }: { checkin: DailyCheckin }) {
  const c = checkin;
  const sub = (v: number | null) => (v === null || v === undefined ? "—" : `${v}/10`);

  return (
    <div className="space-y-4">
      <Group title="Recovery & sleep">
        <DataPoint label="Sleep" value={c.sleep_hours ? `${c.sleep_hours} h` : "—"} />
        <DataPoint label="Recovery" value={c.recovery_score ?? "—"} accent />
        <DataPoint label="HRV" value={c.hrv_ms ? `${c.hrv_ms} ms` : "—"} />
        <DataPoint label="Resting HR" value={c.resting_hr ? `${c.resting_hr} bpm` : "—"} />
        <DataPoint label="Weight" value={c.body_weight_lbs ? `${c.body_weight_lbs} lb` : "—"} />
        <DataPoint label="Sleep quality" value={sub(c.sleep_quality)} />
      </Group>

      <Group title="Training">
        <DataPoint label="Trained" value={c.workout_completed === null ? "—" : c.workout_completed ? "Yes" : "No / rest"} />
        <DataPoint label="Type" value={c.workout_type ? labelFor(WORKOUT_TYPES, c.workout_type) : "—"} />
        <DataPoint label="Intensity" value={sub(c.workout_intensity)} />
      </Group>

      <Group title="Fuel">
        <DataPoint label="Calories" value={c.calories ?? "—"} />
        <DataPoint label="Protein" value={c.protein_g ? `${c.protein_g} g` : "—"} />
        <DataPoint label="Carbs" value={c.carbs_g ? `${c.carbs_g} g` : "—"} />
        <DataPoint label="Fat" value={c.fat_g ? `${c.fat_g} g` : "—"} />
        <DataPoint label="Water" value={c.water_oz ? `${c.water_oz} oz` : "—"} />
      </Group>

      <Group title="How they feel">
        <DataPoint label="Energy" value={sub(c.energy)} />
        <DataPoint label="Mood" value={sub(c.mood)} />
        <DataPoint label="Soreness" value={sub(c.soreness)} />
        <DataPoint label="Stress" value={sub(c.stress)} />
        <DataPoint label="Motivation" value={sub(c.motivation)} />
      </Group>

      {(c.pain_injury_note || c.open_comments) ? (
        <div className="space-y-2">
          {c.pain_injury_note ? (
            <div className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-warning">
                Pain / injury
              </div>
              <div className="mt-0.5 text-sm text-foreground">
                <Prose text={c.pain_injury_note} />
              </div>
            </div>
          ) : null}
          {c.open_comments ? (
            <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                Their comments
              </div>
              <div className="mt-0.5 text-sm text-foreground">
                <Prose text={c.open_comments} />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
        {title}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</div>
    </div>
  );
}

export function CheckinHistoryRow({ checkin }: { checkin: Partial<DailyCheckin> }) {
  const c = checkin;
  return (
    <div className="flex items-center justify-between gap-2 py-2 text-sm first:pt-0 last:pb-0">
      <span className="font-medium text-foreground">{formatDate(c.checkin_date)}</span>
      <div className="flex gap-3 text-xs text-muted tabular-nums">
        <span title="Recovery">R {c.recovery_score ?? "—"}</span>
        <span title="Sleep hours">S {c.sleep_hours ?? "—"}</span>
        <span title="HRV">HRV {c.hrv_ms ?? "—"}</span>
        <span title="Energy">E {c.energy ?? "—"}</span>
        <span title="Soreness">So {c.soreness ?? "—"}</span>
      </div>
    </div>
  );
}
