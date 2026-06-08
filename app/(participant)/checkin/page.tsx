import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/ui";
import { todayISO } from "@/lib/format";
import { CheckinForm } from "./checkin-form";
import type { DailyCheckin } from "@/lib/types";

export const metadata = { title: "Daily check-in — The Coach" };

export default async function CheckinPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const date = todayISO();

  const { data: existing } = await supabase
    .from("daily_checkins")
    .select("*")
    .eq("user_id", user.id)
    .eq("checkin_date", date)
    .maybeSingle();

  return (
    <PageShell width="content">
      <div className="mb-6">
        <div className="eyebrow mb-1.5">Morning check-in</div>
        <h1 className="text-2xl font-semibold tracking-tight">How did you wake up?</h1>
        <p className="mt-1.5 text-sm text-muted">
          Do this in the morning: how you slept last night, yesterday's completed
          fuel, and how you feel right now — anything blank is fine. Your coach reads
          this (with your screenshots) to plan today's session. You'll log how the
          session actually went in the Post-workout check-in.
        </p>
      </div>

      <CheckinForm existing={(existing as DailyCheckin) ?? null} dateISO={date} />
    </PageShell>
  );
}
