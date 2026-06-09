import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { TodayWorkout } from "./workout-today";
import type { WorkoutDay, WorkoutSession, WorkoutSetLog } from "@/lib/types";

export const metadata = { title: "Workout — The Coach" };

export default async function WorkoutPage() {
  const user = await requireUser();
  const supabase = await createClient();

  // Template days (for the picker), most recent session + its set logs, and
  // recent history — all in parallel.
  const [daysRes, sessionRes, historyRes] = await Promise.all([
    supabase
      .from("workout_days")
      .select("id, name, label, position")
      .eq("user_id", user.id)
      .order("position", { ascending: true }),
    supabase
      .from("workout_sessions")
      .select("*")
      .eq("user_id", user.id)
      .order("session_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("workout_sessions")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "completed")
      .order("session_date", { ascending: false })
      .limit(30),
  ]);

  const days = (daysRes.data as Pick<WorkoutDay, "id" | "name" | "label">[]) ?? [];
  const session = (sessionRes.data as WorkoutSession) ?? null;

  let logs: WorkoutSetLog[] = [];
  if (session) {
    const { data: logData } = await supabase
      .from("workout_set_logs")
      .select("*")
      .eq("session_id", session.id)
      .order("position", { ascending: true });
    logs = (logData as WorkoutSetLog[]) ?? [];
  }

  const history = (historyRes.data as WorkoutSession[]) ?? [];

  return (
    <PageShell width="content">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1.5">Workout</div>
          <h1 className="text-2xl font-semibold tracking-tight">Train &amp; log</h1>
          <p className="mt-1.5 text-sm text-muted">
            Pick today&apos;s day — or start a quick workout on the fly — and log the
            weight and reps for each set.
          </p>
        </div>
        <Link
          href="/workout/days"
          className="hidden shrink-0 rounded-full border border-border bg-surface/70 px-3.5 py-1.5 text-sm text-muted transition hover:text-foreground sm:inline-flex"
        >
          Edit split
        </Link>
      </div>

      <TodayWorkout days={days} session={session} logs={logs} />

      {/* Schedule / history — secondary to the workout itself. */}
      <div className="mt-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-2">
          History
        </h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted-2">No workouts logged yet.</p>
        ) : (
          <div className="space-y-2">
            {history.map((s) => (
              <div
                key={s.id}
                className="card-tight flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">
                    {s.day_name ?? "Workout"}
                  </div>
                  {s.notes ? (
                    <div className="mt-0.5 line-clamp-1 text-xs text-muted">{s.notes}</div>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs text-muted-2">
                  {formatDate(s.session_date)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
