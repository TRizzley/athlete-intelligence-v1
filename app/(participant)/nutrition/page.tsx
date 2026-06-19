import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { serverToday } from "@/lib/server-date";
import { PageShell } from "@/components/ui";
import { NutritionSummary } from "@/components/nutrition-summary";
import { FoodLogEntry, type FoodLogRow } from "@/components/food-log-entry";
import { NutritionLogger } from "./nutrition-logger";
import { formatDateLong } from "@/lib/format";

export const metadata = { title: "Nutrition — The Coach" };

type MealType = "breakfast" | "lunch" | "dinner" | "snack";

const MEAL_ORDER: { key: MealType; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
  { key: "snack", label: "Snacks" },
];

interface NutritionLogRecord extends FoodLogRow {
  meal_type: MealType | null;
}

export default async function NutritionPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const date = await serverToday();

  const { data } = await supabase
    .from("nutrition_logs")
    .select(
      "id, food_name, brand_name, serving_qty, serving_unit, calories, protein_g, carbs_g, fat_g, meal_type",
    )
    .eq("user_id", user.id)
    .eq("log_date", date)
    .order("created_at", { ascending: true });

  const logs = (data as NutritionLogRecord[]) ?? [];

  const totals = logs.reduce(
    (acc, l) => {
      acc.calories += Number(l.calories) || 0;
      acc.protein_g += Number(l.protein_g) || 0;
      acc.carbs_g += Number(l.carbs_g) || 0;
      acc.fat_g += Number(l.fat_g) || 0;
      return acc;
    },
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, meal_count: logs.length },
  );

  const byMeal = (meal: MealType) => logs.filter((l) => l.meal_type === meal);

  return (
    <PageShell width="content">
      <div className="mb-6">
        <div className="eyebrow mb-1.5">Nutrition</div>
        <h1 className="text-2xl font-semibold tracking-tight">What did you eat?</h1>
        <p className="mt-1.5 text-sm text-muted">
          Log food in plain English — your coach reads the totals alongside your
          sleep, recovery, and training to spot fueling patterns. {formatDateLong(date)}.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left: logger + grouped log */}
        <div className="space-y-6">
          <NutritionLogger dateISO={date} />

          {logs.length === 0 ? (
            <div className="card text-center text-sm text-muted">
              Nothing logged yet today. Add your first meal above.
            </div>
          ) : (
            <div className="space-y-5">
              {MEAL_ORDER.map(({ key, label }) => {
                const items = byMeal(key);
                if (items.length === 0) return null;
                const mealCals = items.reduce((s, i) => s + (Number(i.calories) || 0), 0);
                return (
                  <div key={key}>
                    <div className="mb-2 flex items-baseline justify-between">
                      <h2 className="text-sm font-semibold tracking-tight text-foreground">
                        {label}
                      </h2>
                      <span className="text-xs tabular-nums text-muted-2">
                        {Math.round(mealCals)} kcal
                      </span>
                    </div>
                    <div className="space-y-2">
                      {items.map((l) => (
                        <FoodLogEntry key={l.id} log={l} logDate={date} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: daily totals */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="card">
            <div className="stat-label mb-3">Today&apos;s totals</div>
            <NutritionSummary totals={totals} />
          </div>
        </aside>
      </div>

      <p className="mt-8 text-center text-xs text-muted-2">
        Food data{" "}
        <a
          href="https://www.nutritionix.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-muted"
        >
          Powered by Nutritionix
        </a>
        . Values are estimates and may not be exact — use them as a guide, not
        medical advice.
      </p>
    </PageShell>
  );
}
