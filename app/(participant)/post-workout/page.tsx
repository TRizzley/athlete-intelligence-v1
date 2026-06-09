import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/ui";
import { serverToday } from "@/lib/server-date";
import { PostWorkoutForm } from "./post-workout-form";
import type { DailyCheckin } from "@/lib/types";

export const metadata = { title: "Post-workout check-in — The Coach" };

export default async function PostWorkoutPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const date = await serverToday();

  const [{ data: existing }, { data: dayRows }] = await Promise.all([
    supabase
      .from("daily_checkins")
      .select("*")
      .eq("user_id", user.id)
      .eq("checkin_date", date)
      .maybeSingle(),
    supabase
      .from("workout_days")
      .select("name, label")
      .eq("user_id", user.id)
      .order("position", { ascending: true }),
  ]);

  const dayNames = ((dayRows as { name: string; label: string | null }[]) ?? [])
    .map((d) => d.name)
    .filter(Boolean);

  return (
    <PageShell width="content">
      <div className="mb-6">
        <div className="eyebrow mb-1.5">Post-workout check-in</div>
        <h1 className="text-2xl font-semibold tracking-tight">How did the session go?</h1>
        <p className="mt-1.5 text-sm text-muted">
          Log this after you train. Your coach compares how it actually went to the
          prediction it made this morning — that's how the predictions get sharper.
        </p>
      </div>

      <PostWorkoutForm
        existing={(existing as DailyCheckin) ?? null}
        dateISO={date}
        dayNames={dayNames}
      />
    </PageShell>
  );
}
