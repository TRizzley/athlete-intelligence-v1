"use client";

// ---------------------------------------------------------------------------
// FoodLogEntry — a single logged food row.
//
// Shows the food name, serving, calories, and P/C/F breakdown with a delete
// button. Deleting calls deleteFoodLogAction (RLS-guarded) and re-syncs the
// day's totals into daily_checkins.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";
import { deleteFoodLogAction } from "@/app/(participant)/nutrition/actions";

export interface FoodLogRow {
  id: string;
  food_name: string;
  brand_name: string | null;
  serving_qty: number;
  serving_unit: string;
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

function g(n: number | null): string {
  return n == null ? "—" : `${Math.round(n)}g`;
}

export function FoodLogEntry({ log, logDate }: { log: FoodLogRow; logDate: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteFoodLogAction(log.id, logDate);
      if (!res.success) setError(res.error ?? "Failed to delete.");
    });
  }

  const serving = `${+log.serving_qty.toFixed(2)} ${log.serving_unit}`;

  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5 transition ${
        pending ? "opacity-50" : ""
      }`}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">
          {log.food_name}
          {log.brand_name ? (
            <span className="ml-1.5 text-xs font-normal text-muted-2">{log.brand_name}</span>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
          <span className="capitalize">{serving}</span>
          <span className="tabular-nums text-foreground">
            {Math.round(log.calories)} kcal
          </span>
          <span className="tabular-nums">
            P {g(log.protein_g)} · C {g(log.carbs_g)} · F {g(log.fat_g)}
          </span>
        </div>
        {error ? <div className="mt-1 text-xs text-danger">{error}</div> : null}
      </div>

      <button
        type="button"
        onClick={handleDelete}
        disabled={pending}
        aria-label={`Delete ${log.food_name}`}
        className="btn-ghost shrink-0 px-2 py-1 text-muted transition hover:text-danger disabled:opacity-60"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 7h12M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-7 0v12a1 1 0 001 1h6a1 1 0 001-1V7"
          />
        </svg>
      </button>
    </div>
  );
}
