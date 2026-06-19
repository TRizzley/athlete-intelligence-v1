"use client";

// ---------------------------------------------------------------------------
// NutritionLogger — natural-language food entry.
//
// User picks a meal + date, types what they ate ("3 eggs, 1 cup oats,
// banana"), and hits Log Food. logFoodAction parses it via Nutritionix,
// inserts the rows, and syncs the day's totals into daily_checkins. On success
// we show what was parsed, clear the input, and refresh the log below.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { logFoodAction, type MealType, type ParsedFoodItem } from "./actions";

const MEALS: { value: MealType; label: string }[] = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "dinner", label: "Dinner" },
  { value: "snack", label: "Snack" },
];

const MAX_LEN = 500;

export function NutritionLogger({ dateISO }: { dateISO: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [logDate, setLogDate] = useState(dateISO);
  const [mealType, setMealType] = useState<MealType>(defaultMeal());
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<ParsedFoodItem[] | null>(null);

  function handleSubmit() {
    const trimmed = text.trim();
    setError(null);
    setJustAdded(null);
    if (!trimmed) {
      setError("Enter what you ate first.");
      return;
    }
    startTransition(async () => {
      const res = await logFoodAction(trimmed, logDate, mealType);
      if (!res.success) {
        setError(res.error ?? "Could not log food.");
        return;
      }
      setJustAdded(res.parsed ?? []);
      setText("");
      router.refresh();
    });
  }

  return (
    <div className="card space-y-4">
      {/* Meal + date */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-full border border-border bg-surface/70 p-1">
          {MEALS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMealType(m.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                mealType === m.value
                  ? "bg-surface-3 text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <input
          type="date"
          value={logDate}
          max={dateISO}
          onChange={(e) => setLogDate(e.target.value)}
          className="input max-w-[170px] text-sm"
        />
      </div>

      {/* Natural language input */}
      <div>
        <textarea
          value={text}
          maxLength={MAX_LEN}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleSubmit();
          }}
          placeholder="3 eggs, 1 cup oats, a banana"
          className="input min-h-[64px]"
          disabled={pending}
        />
        <div className="mt-1 flex items-center justify-between">
          <p className="hint">Describe it in plain English — ⌘/Ctrl+Enter to log.</p>
          <span className="text-xs text-muted-2 tabular-nums">
            {text.length}/{MAX_LEN}
          </span>
        </div>
      </div>

      {error ? <div className="text-sm text-danger">{error}</div> : null}

      {justAdded ? (
        <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2.5">
          <div className="text-sm font-medium text-success">
            Logged {justAdded.length} {justAdded.length === 1 ? "item" : "items"}
          </div>
          <ul className="mt-1 space-y-0.5 text-xs text-muted">
            {justAdded.map((f, i) => (
              <li key={i} className="tabular-nums">
                {f.food_name} — {Math.round(f.calories)} kcal
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={pending || !text.trim()}
        className="btn-accent text-sm disabled:opacity-60"
      >
        {pending ? "Logging…" : "Log Food"}
      </button>
    </div>
  );
}

// Pick a sensible default meal based on the local hour.
function defaultMeal(): MealType {
  const h = new Date().getHours();
  if (h < 11) return "breakfast";
  if (h < 15) return "lunch";
  if (h < 21) return "dinner";
  return "snack";
}
