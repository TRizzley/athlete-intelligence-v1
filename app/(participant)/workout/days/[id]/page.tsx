import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageShell, BackLink } from "@/components/ui";
import { DayEditor } from "./day-editor";
import type { WorkoutDay, WorkoutExercise } from "@/lib/types";

export const metadata = { title: "Edit day — The Coach" };

export default async function WorkoutDayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();

  const { data: day } = await supabase
    .from("workout_days")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!day) notFound();

  const { data: exData } = await supabase
    .from("workout_exercises")
    .select("*")
    .eq("workout_day_id", id)
    .order("position", { ascending: true });

  const exercises = (exData as WorkoutExercise[]) ?? [];

  return (
    <PageShell width="content">
      <BackLink href="/workout/days">Back to your split</BackLink>
      <div className="mb-6">
        <div className="eyebrow mb-1.5">Edit day</div>
        <h1 className="text-2xl font-semibold tracking-tight">{(day as WorkoutDay).name}</h1>
        <p className="mt-1.5 text-sm text-muted">
          Add the exercises for this day with their target sets and reps.
        </p>
      </div>

      <DayEditor day={day as WorkoutDay} exercises={exercises} />
    </PageShell>
  );
}
