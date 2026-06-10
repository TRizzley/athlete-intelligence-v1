import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageShell, BackLink } from "@/components/ui";
import { formatDateLong } from "@/lib/format";
import type { WorkoutSession, WorkoutSetLog } from "@/lib/types";

export const metadata = { title: "Logged workout — The Coach" };

export default async function WorkoutSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();

  const { data: sessionData } = await supabase
    .from("workout_sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!sessionData || (sessionData as WorkoutSession).user_id !== user.id) notFound();
  const session = sessionData as WorkoutSession;

  const { data: logData } = await supabase
    .from("workout_set_logs")
    .select("*")
    .eq("session_id", id)
    .order("position", { ascending: true });
  const logs = (logData as WorkoutSetLog[]) ?? [];

  const groups: {
    name: string;
    muscle: string | null;
    superset: string | null;
    sets: WorkoutSetLog[];
  }[] = [];
  for (const l of logs) {
    let g = groups.find((x) => x.name === l.exercise_name);
    if (!g) {
      g = { name: l.exercise_name, muscle: l.muscle_group, superset: l.superset_group, sets: [] };
      groups.push(g);
    }
    g.sets.push(l);
  }

  return (
    <PageShell width="content">
      <BackLink href="/workout">Back to workouts</BackLink>
      <div className="mb-6">
        <div className="eyebrow mb-1.5">Logged workout</div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {session.day_name ?? "Quick workout"}
        </h1>
        <p className="mt-1.5 text-sm text-muted">{formatDateLong(session.session_date)}</p>
      </div>

      {groups.length === 0 ? (
        <div className="card text-center text-sm text-muted">
          No sets were logged for this workout.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section
              key={g.name}
              className={`card space-y-3 ${g.superset ? "border-l-2 border-l-accent" : ""}`}
            >
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-2">
                  <h4 className="text-sm font-semibold text-foreground">{g.name}</h4>
                  {g.superset ? (
                    <span className="pill bg-accent/15 text-accent">Superset</span>
                  ) : null}
                </div>
                {g.muscle ? (
                  <span className="pill bg-surface-3 text-muted">{g.muscle}</span>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-2">
                  <span>Set</span>
                  <span>Weight</span>
                  <span>Reps</span>
                </div>
                {g.sets.map((s) => (
                  <div
                    key={s.id}
                    className="grid grid-cols-[2.5rem_1fr_1fr] gap-2 text-sm"
                  >
                    <span className="font-semibold tabular-nums text-muted">
                      {s.set_number}
                    </span>
                    <span className="tabular-nums text-foreground">
                      {s.weight != null ? `${s.weight} lb` : "—"}
                    </span>
                    <span className="tabular-nums text-foreground">
                      {s.reps != null ? s.reps : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {session.notes ? (
        <div className="card mt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
            Notes
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{session.notes}</p>
        </div>
      ) : null}
    </PageShell>
  );
}
