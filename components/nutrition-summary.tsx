// ---------------------------------------------------------------------------
// NutritionSummary — daily macro snapshot.
//
// Presentational + server-renderable (no client hooks). Reused on the
// nutrition page and the dashboard card. Shows calories prominently, a P/C/F
// stat row, and a stacked bar of where the calories came from. If macro
// targets are supplied, calories shows goal progress.
// ---------------------------------------------------------------------------

export interface NutritionTotals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  meal_count?: number;
}

export interface MacroTargets {
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
}

function round(n: number): number {
  return Math.round(n);
}

export function NutritionSummary({
  totals,
  targets,
  compact = false,
}: {
  totals: NutritionTotals;
  targets?: MacroTargets;
  compact?: boolean;
}) {
  const { calories, protein_g, carbs_g, fat_g } = totals;

  // Calorie contribution of each macro (4/4/9 kcal per gram) for the split bar.
  const pCal = protein_g * 4;
  const cCal = carbs_g * 4;
  const fCal = fat_g * 9;
  const macroCal = pCal + cCal + fCal;
  const pPct = macroCal > 0 ? (pCal / macroCal) * 100 : 0;
  const cPct = macroCal > 0 ? (cCal / macroCal) * 100 : 0;
  const fPct = macroCal > 0 ? (fCal / macroCal) * 100 : 0;

  const calTarget = targets?.calories ?? null;
  const calPct =
    calTarget && calTarget > 0 ? Math.min(100, (calories / calTarget) * 100) : null;

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {/* Calories */}
      <div>
        <div className="flex items-baseline justify-between">
          <span className="stat-label">Calories</span>
          <span className="text-sm tabular-nums text-muted">
            {round(calories).toLocaleString()}
            {calTarget ? (
              <span className="text-muted-2"> / {round(calTarget).toLocaleString()} kcal</span>
            ) : (
              <span className="text-muted-2"> kcal</span>
            )}
          </span>
        </div>
        {calPct !== null ? (
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${calPct}%` }}
            />
          </div>
        ) : null}
      </div>

      {/* Macro split bar */}
      {macroCal > 0 ? (
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-3">
          <div className="h-full bg-success" style={{ width: `${pPct}%` }} title="Protein" />
          <div className="h-full bg-warning" style={{ width: `${cPct}%` }} title="Carbs" />
          <div className="h-full bg-accent" style={{ width: `${fPct}%` }} title="Fat" />
        </div>
      ) : null}

      {/* Macro stat row */}
      <div className="grid grid-cols-3 gap-2">
        <MacroStat label="Protein" grams={protein_g} target={targets?.protein_g} dot="bg-success" />
        <MacroStat label="Carbs" grams={carbs_g} target={targets?.carbs_g} dot="bg-warning" />
        <MacroStat label="Fat" grams={fat_g} target={targets?.fat_g} dot="bg-accent" />
      </div>

      {!compact && totals.meal_count !== undefined ? (
        <p className="text-xs text-muted-2">
          {totals.meal_count} {totals.meal_count === 1 ? "item" : "items"} logged today
        </p>
      ) : null}
    </div>
  );
}

function MacroStat({
  label,
  grams,
  target,
  dot,
}: {
  label: string;
  grams: number;
  target?: number | null;
  dot: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-2">
          {label}
        </span>
      </div>
      <div className="mt-1 text-sm font-semibold tabular-nums text-foreground">
        {round(grams)}g
        {target ? <span className="font-normal text-muted-2"> / {round(target)}g</span> : null}
      </div>
    </div>
  );
}
