// POST /api/coach/workout/apply
//
// Applies a confirmed workout proposal (add_exercise, remove_exercise,
// update_exercise, create_day, create_program) to the athlete's saved program.
// Called by the chat UI after the athlete taps "Confirm" on a proposal card.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type ExerciseInput = {
  name: string;
  muscle_group?: string | null;
  target_sets?: number | null;
  target_reps?: string | null;
};

type DayInput = {
  name: string;
  label?: string | null;
  exercises?: ExerciseInput[];
};

type Proposal =
  | { action: "add_exercise"; workout_day_id: string; day_name: string; exercise: ExerciseInput }
  | { action: "remove_exercise"; exercise_id: string; exercise_name: string; day_name: string }
  | { action: "update_exercise"; exercise_id: string; day_name: string; name?: string; muscle_group?: string; target_sets?: number; target_reps?: string }
  | { action: "create_day"; name: string; label?: string; exercises?: ExerciseInput[] }
  | { action: "create_program"; days: DayInput[] };

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let proposal: Proposal;
  try {
    proposal = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const admin = createAdminClient();
  const userId = user.id;

  try {
    switch (proposal.action) {
      case "add_exercise": {
        // Verify the day belongs to this user.
        const { data: day } = await admin
          .from("workout_days")
          .select("id")
          .eq("id", proposal.workout_day_id)
          .eq("user_id", userId)
          .maybeSingle();
        if (!day) return NextResponse.json({ error: "Workout day not found" }, { status: 404 });

        // Find max position.
        const { data: existing } = await admin
          .from("workout_exercises")
          .select("position")
          .eq("workout_day_id", proposal.workout_day_id)
          .order("position", { ascending: false })
          .limit(1);
        const nextPos = ((existing?.[0] as { position: number } | undefined)?.position ?? 0) + 1;

        await admin.from("workout_exercises").insert({
          workout_day_id: proposal.workout_day_id,
          user_id: userId,
          name: proposal.exercise.name,
          muscle_group: proposal.exercise.muscle_group ?? null,
          target_sets: proposal.exercise.target_sets ?? null,
          target_reps: proposal.exercise.target_reps ?? null,
          position: nextPos,
        });
        return NextResponse.json({ ok: true, message: `Added ${proposal.exercise.name} to ${proposal.day_name}` });
      }

      case "remove_exercise": {
        const { data: ex } = await admin
          .from("workout_exercises")
          .select("id, workout_day_id")
          .eq("id", proposal.exercise_id)
          .eq("user_id", userId)
          .maybeSingle();
        if (!ex) return NextResponse.json({ error: "Exercise not found" }, { status: 404 });

        await admin.from("workout_exercises").delete().eq("id", proposal.exercise_id).eq("user_id", userId);
        return NextResponse.json({ ok: true, message: `Removed ${proposal.exercise_name} from ${proposal.day_name}` });
      }

      case "update_exercise": {
        const { data: ex } = await admin
          .from("workout_exercises")
          .select("id")
          .eq("id", proposal.exercise_id)
          .eq("user_id", userId)
          .maybeSingle();
        if (!ex) return NextResponse.json({ error: "Exercise not found" }, { status: 404 });

        const updates: Record<string, unknown> = {};
        if (proposal.name !== undefined) updates.name = proposal.name;
        if (proposal.muscle_group !== undefined) updates.muscle_group = proposal.muscle_group;
        if (proposal.target_sets !== undefined) updates.target_sets = proposal.target_sets;
        if (proposal.target_reps !== undefined) updates.target_reps = proposal.target_reps;

        await admin.from("workout_exercises").update(updates).eq("id", proposal.exercise_id).eq("user_id", userId);
        return NextResponse.json({ ok: true, message: `Updated exercise in ${proposal.day_name}` });
      }

      case "create_day": {
        const { data: existing } = await admin
          .from("workout_days")
          .select("position")
          .eq("user_id", userId)
          .order("position", { ascending: false })
          .limit(1);
        const nextPos = ((existing?.[0] as { position: number } | undefined)?.position ?? 0) + 1;

        const { data: newDay } = await admin.from("workout_days").insert({
          user_id: userId,
          name: proposal.name,
          label: proposal.label ?? null,
          position: nextPos,
        }).select("id").single();

        if (proposal.exercises && newDay) {
          const exRows = proposal.exercises.map((e, i) => ({
            workout_day_id: newDay.id,
            user_id: userId,
            name: e.name,
            muscle_group: e.muscle_group ?? null,
            target_sets: e.target_sets ?? null,
            target_reps: e.target_reps ?? null,
            position: i + 1,
          }));
          await admin.from("workout_exercises").insert(exRows);
        }

        return NextResponse.json({ ok: true, message: `Created ${proposal.name}` });
      }

      case "create_program": {
        const { data: existing } = await admin
          .from("workout_days")
          .select("position")
          .eq("user_id", userId)
          .order("position", { ascending: false })
          .limit(1);
        let nextPos = ((existing?.[0] as { position: number } | undefined)?.position ?? 0) + 1;

        for (const day of proposal.days) {
          const { data: newDay } = await admin.from("workout_days").insert({
            user_id: userId,
            name: day.name,
            label: day.label ?? null,
            position: nextPos++,
          }).select("id").single();

          if (day.exercises && newDay) {
            const exRows = day.exercises.map((e, i) => ({
              workout_day_id: newDay.id,
              user_id: userId,
              name: e.name,
              muscle_group: e.muscle_group ?? null,
              target_sets: e.target_sets ?? null,
              target_reps: e.target_reps ?? null,
              position: i + 1,
            }));
            await admin.from("workout_exercises").insert(exRows);
          }
        }

        return NextResponse.json({ ok: true, message: `Created ${proposal.days.length} workout days` });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    console.error("workout/apply error:", err);
    return NextResponse.json({ error: "Failed to apply change" }, { status: 500 });
  }
}
