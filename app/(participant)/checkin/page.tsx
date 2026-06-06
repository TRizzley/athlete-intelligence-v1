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
        <h1 className="text-2xl font-semibold tracking-tight">How are you today?</h1>
        <p className="mt-1.5 text-sm text-muted">
          Fill in what you have — anything blank is fine. Your coach reads this with
          your screenshots to make today's call.
        </p>
      </div>

      <CheckinForm existing={(existing as DailyCheckin) ?? null} dateISO={date} />
    </PageShell>
  );
}
