import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageShell, BackLink, EmptyState } from "@/components/ui";
import { NewDayForm } from "./days-forms";
import type { WorkoutDay } from "@/lib/types";

export const metadata = { title: "Your split — The Coach" };

type DayWithCount = WorkoutDay & { workout_exercises: { id: string }[] };

export default async function WorkoutDaysPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from("workout_days")
    .select("*, workout_exercises(id)")
    .eq("user_id", user.id)
    .order("position", { ascending: true });

  const days = (data as DayWithCount[]) ?? [];

  return (
    <PageShell width="content">
      <BackLink href="/workout">Back to workout</BackLink>
      <div className="mb-6">
        <div className="eyebrow mb-1.5">Your split</div>
        <h1 className="text-2xl font-semibold tracking-tight">Build your training days</h1>
        <p className="mt-1.5 text-sm text-muted">
          Set up each day once — its exercises, target sets and reps. You&apos;ll log the
          weights you actually hit when you train.
        </p>
      </div>

      {days.length === 0 ? (
        <div className="mb-6">
          <EmptyState
            title="No workout days yet"
            body="Add your first training day below — like Push, Pull, or Upper 1."
          />
        </div>
      ) : (
        <div className="mb-6 space-y-2">
          {days.map((d) => (
            <Link
              key={d.id}
              href={`/workout/days/${d.id}`}
              className="card-tight block transition hover:border-border-strong"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="text-sm font-semibold text-foreground">{d.name}</span>
                  {d.label ? (
                    <span className="ml-2 pill bg-surface-3 text-muted">{d.label}</span>
                  ) : null}
                </div>
                <span className="text-xs text-muted-2">
                  {d.workout_exercises?.length ?? 0} exercise
                  {(d.workout_exercises?.length ?? 0) === 1 ? "" : "s"}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <NewDayForm />
    </PageShell>
  );
}
