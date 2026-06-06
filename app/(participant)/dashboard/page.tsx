import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  PageShell,
  ConfidenceBadge,
  OutcomeBadge,
  StatCard,
} from "@/components/ui";
import { formatDate, todayISO } from "@/lib/format";
import type {
  CoachResponse,
  DailyCheckin,
  PredictionWithOutcome,
  PredictionOutcome,
} from "@/lib/types";

export const metadata = { title: "Today — The Coach" };

function firstName(name?: string | null): string {
  if (!name) return "there";
  return name.trim().split(/\s+/)[0];
}

function outcomeOf(p: PredictionWithOutcome): string | null {
  const po = p.prediction_outcomes;
  if (!po) return null;
  const row: PredictionOutcome | undefined = Array.isArray(po) ? po[0] : po;
  return row?.outcome ?? null;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const { saved } = await searchParams;
  const user = await requireUser();
  const supabase = await createClient();
  const today = todayISO();

  const [
    recordRes,
    checkinRes,
    shotsCountRes,
    latestRes,
    predictionsRes,
    recentRes,
  ] = await Promise.all([
    supabase.from("users").select("full_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("daily_checkins")
      .select("*")
      .eq("user_id", user.id)
      .eq("checkin_date", today)
      .maybeSingle(),
    supabase
      .from("uploaded_screenshots")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
    supabase
      .from("coach_responses")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "sent")
      .order("response_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("predictions")
      .select("*, prediction_outcomes(*)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("daily_checkins")
      .select("checkin_date, recovery_score, sleep_hours, energy, soreness")
      .eq("user_id", user.id)
      .order("checkin_date", { ascending: false })
      .limit(5),
  ]);

  const name = firstName(recordRes.data?.full_name);
  const checkin = (checkinRes.data as DailyCheckin) ?? null;
  const shotsCount = shotsCountRes.count ?? 0;
  const latest = (latestRes.data as CoachResponse) ?? null;
  const predictions = (predictionsRes.data as PredictionWithOutcome[]) ?? [];
  const recent = (recentRes.data as Partial<DailyCheckin>[]) ?? [];

  // Has the latest response been rated?
  let latestRated = false;
  if (latest) {
    const { data: fb } = await supabase
      .from("user_feedback")
      .select("id")
      .eq("coach_response_id", latest.id)
      .maybeSingle();
    latestRated = !!fb;
  }

  return (
    <PageShell width="content">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1.5">{formatDate(today)}</div>
          <h1 className="text-2xl font-semibold tracking-tight">Hi, {name}.</h1>
        </div>
      </div>

      {saved === "checkin" ? (
        <div className="mb-5 rounded-lg border border-success/30 bg-success-soft px-3.5 py-2.5 text-sm text-success">
          Check-in saved. Your coach will factor it into today's decision.
        </div>
      ) : null}

      {/* Today's action card */}
      <div className="card mb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {checkin ? "You're checked in for today" : "Start with today's check-in"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {checkin
                ? "Add screenshots so your coach has the full picture."
                : "A 60-second check-in is how your coach reads your day."}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Link href="/checkin" className={checkin ? "btn-ghost" : "btn-primary"}>
              {checkin ? "Edit check-in" : "Check in"}
            </Link>
            <Link href="/upload" className={checkin ? "btn-primary" : "btn-ghost"}>
              Upload
            </Link>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <StatCard label="Check-in" value={checkin ? "Done" : "Not yet"} />
          <StatCard
            label="Recovery"
            value={checkin?.recovery_score ?? "—"}
            hint={checkin?.recovery_score ? "logged today" : "from your wearable"}
          />
          <StatCard label="Screenshots" value={shotsCount} hint="total uploaded" />
        </div>
      </div>

      {/* Latest coaching decision */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-2">
        Your latest decision
      </h2>
      {latest ? (
        <Link
          href={`/coach/${latest.id}`}
          className="card mb-6 block transition hover:border-border-strong"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-foreground">
              {formatDate(latest.response_date)}
            </span>
            <div className="flex items-center gap-2">
              <ConfidenceBadge value={latest.confidence} />
              {!latestRated ? (
                <span className="pill bg-accent/15 text-accent">Needs feedback</span>
              ) : null}
            </div>
          </div>
          <p className="line-clamp-3 text-sm leading-relaxed text-muted">
            {latest.recommendation || latest.what_noticed || "Tap to read your decision."}
          </p>
          <div className="mt-3 text-sm font-medium text-accent">
            {latestRated ? "Read again →" : "Read & rate →"}
          </div>
        </Link>
      ) : (
        <div className="card mb-6 text-center">
          <p className="text-sm text-muted">
            Your coach is reviewing your data. Your first daily decision will appear
            here. Keep checking in and uploading screenshots.
          </p>
        </div>
      )}

      {/* Coach track record */}
      {predictions.length > 0 ? (
        <div className="mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-2">
            Coach track record
          </h2>
          <div className="card-tight space-y-3">
            {predictions.map((p) => (
              <div key={p.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-foreground">{p.prediction_text}</p>
                  <p className="text-xs text-muted-2">
                    {p.target_date ? `for ${formatDate(p.target_date)}` : p.horizon}
                  </p>
                </div>
                <OutcomeBadge value={outcomeOf(p)} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Recent check-ins */}
      {recent.length > 0 ? (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-2">
            Recent check-ins
          </h2>
          <div className="card-tight divide-y divide-border">
            {recent.map((c, i) => (
              <div key={i} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                <span className="text-sm font-medium text-foreground">
                  {formatDate(c.checkin_date)}
                </span>
                <div className="flex gap-4 text-xs text-muted">
                  <span>Rec {c.recovery_score ?? "—"}</span>
                  <span>Sleep {c.sleep_hours ?? "—"}h</span>
                  <span>Energy {c.energy ?? "—"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
