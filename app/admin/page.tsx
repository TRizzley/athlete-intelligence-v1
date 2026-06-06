import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  PageShell,
  MetricBar,
  StatCard,
  Avatar,
  EmptyState,
} from "@/components/ui";
import { computeTrustMetrics } from "@/lib/metrics";
import { formatDate, todayISO } from "@/lib/format";
import { labelFor, SPORTS } from "@/lib/constants";
import type { UserFeedback, PredictionOutcome } from "@/lib/types";

export const metadata = { title: "Coach Console — The Coach" };

type UserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
};

export default async function AdminDashboard() {
  const supabase = await createClient();
  const today = todayISO();

  const [usersRes, profilesRes, feedbackRes, responsesRes, checkinsRes, outcomesRes, predCountRes] =
    await Promise.all([
      supabase
        .from("users")
        .select("id, email, full_name, created_at")
        .eq("role", "participant")
        .order("created_at", { ascending: true }),
      supabase.from("athlete_profiles").select("user_id, primary_sport, goal_detail"),
      supabase
        .from("user_feedback")
        .select("user_id, felt_personalized, felt_accurate, was_useful, would_pay"),
      supabase.from("coach_responses").select("user_id, status, response_date"),
      supabase.from("daily_checkins").select("user_id, checkin_date"),
      supabase.from("prediction_outcomes").select("outcome"),
      supabase.from("predictions").select("id", { count: "exact", head: true }),
    ]);

  const users = (usersRes.data as UserRow[]) ?? [];
  const profiles = (profilesRes.data as { user_id: string; primary_sport: string | null; goal_detail: string | null }[]) ?? [];
  const feedback = (feedbackRes.data as (UserFeedback & { user_id: string })[]) ?? [];
  const responses = (responsesRes.data as { user_id: string; status: string; response_date: string }[]) ?? [];
  const checkins = (checkinsRes.data as { user_id: string; checkin_date: string }[]) ?? [];
  const outcomes = (outcomesRes.data as PredictionOutcome[]) ?? [];
  const predictionsTotal = predCountRes.count ?? 0;

  // Cohort-level metrics.
  const cohort = computeTrustMetrics(feedback, outcomes, predictionsTotal);

  // Per-user aggregates.
  const profileBy = new Map(profiles.map((p) => [p.user_id, p]));
  const feedbackBy = new Map<string, (UserFeedback & { user_id: string })[]>();
  feedback.forEach((f) => {
    const arr = feedbackBy.get(f.user_id) ?? [];
    arr.push(f);
    feedbackBy.set(f.user_id, arr);
  });

  const respBy = new Map<string, { sent: number; sentToday: boolean }>();
  responses.forEach((r) => {
    const cur = respBy.get(r.user_id) ?? { sent: 0, sentToday: false };
    if (r.status === "sent") {
      cur.sent += 1;
      if (r.response_date === today) cur.sentToday = true;
    }
    respBy.set(r.user_id, cur);
  });

  const checkinBy = new Map<string, { count: number; last: string | null; today: boolean }>();
  checkins.forEach((c) => {
    const cur = checkinBy.get(c.user_id) ?? { count: 0, last: null, today: false };
    cur.count += 1;
    if (!cur.last || c.checkin_date > cur.last) cur.last = c.checkin_date;
    if (c.checkin_date === today) cur.today = true;
    checkinBy.set(c.user_id, cur);
  });

  const awaitingCount = users.filter((u) => {
    const ci = checkinBy.get(u.id);
    const rb = respBy.get(u.id);
    return ci?.today && !rb?.sentToday;
  }).length;

  return (
    <PageShell width="wide">
      <div className="mb-6">
        <div className="eyebrow mb-1.5">Validation sprint</div>
        <h1 className="text-2xl font-semibold tracking-tight">Cohort overview</h1>
        <p className="mt-1.5 text-sm text-muted">
          The one question this proves: do real strangers feel understood — and would they pay?
        </p>
      </div>

      {/* Cohort metrics */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Participants" value={users.length} />
        <StatCard label="Feedback collected" value={cohort.feedbackCount} />
        <StatCard
          label="Awaiting response"
          value={awaitingCount}
          hint="checked in today"
        />
        <StatCard
          label="Predictions scored"
          value={`${cohort.predictionsScored}/${cohort.predictionsTotal}`}
        />
      </div>

      <div className="card mb-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-2">
          The signals that matter
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <MetricBar label="“It gets me” (felt personalized)" value={cohort.ahaRate} sample={`${cohort.feedbackCount}`} goodAt={60} />
          <MetricBar label="Felt accurate" value={cohort.accuracyRate} sample={`${cohort.feedbackCount}`} goodAt={60} />
          <MetricBar label="Recommendation useful" value={cohort.usefulnessRate} sample={`${cohort.feedbackCount}`} goodAt={50} />
          <MetricBar label="Would pay" value={cohort.wouldPayRate} sample={`${cohort.feedbackCount}`} goodAt={40} />
          <MetricBar label="Prediction accuracy" value={cohort.predictionAccuracy} sample={`${cohort.predictionsScored}`} goodAt={70} />
        </div>
      </div>

      {/* Participants */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
          Participants
        </h2>
      </div>

      {users.length === 0 ? (
        <EmptyState
          title="No participants yet"
          body="Once athletes sign up and complete onboarding, they'll appear here. Share the signup link to start recruiting your cohort."
        />
      ) : (
        <div className="space-y-2">
          {users.map((u) => {
            const prof = profileBy.get(u.id);
            const fb = feedbackBy.get(u.id) ?? [];
            const aha = fb.filter((f) => f.felt_personalized === "yes").length;
            const rb = respBy.get(u.id);
            const ci = checkinBy.get(u.id);
            const awaiting = ci?.today && !rb?.sentToday;

            return (
              <Link
                key={u.id}
                href={`/admin/users/${u.id}`}
                className="card-tight flex items-center gap-4 transition hover:border-border-strong"
              >
                <Avatar name={u.full_name} email={u.email} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {u.full_name || u.email || "Unnamed athlete"}
                    </span>
                    {prof?.primary_sport ? (
                      <span className="pill bg-surface-3 text-muted">
                        {labelFor(SPORTS, prof.primary_sport)}
                      </span>
                    ) : (
                      <span className="pill bg-warning/15 text-warning">No profile</span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-2">
                    {prof?.goal_detail || u.email}
                  </div>
                </div>

                <div className="hidden gap-6 sm:flex">
                  <MiniStat label="Check-ins" value={ci?.count ?? 0} sub={ci?.last ? formatDate(ci.last) : "—"} />
                  <MiniStat label="Responses" value={rb?.sent ?? 0} sub="sent" />
                  <MiniStat label="Feedback" value={fb.length} sub={`${aha} aha`} />
                </div>

                <span
                  className={`pill shrink-0 ${
                    awaiting
                      ? "bg-accent/15 text-accent"
                      : (rb?.sent ?? 0) > 0
                        ? "bg-success/15 text-success"
                        : "bg-surface-3 text-muted"
                  }`}
                >
                  {awaiting ? "Needs response" : (rb?.sent ?? 0) > 0 ? "Active" : "New"}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="text-right">
      <div className="text-sm font-semibold tabular-nums text-foreground">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-2">{label}</div>
      {sub ? <div className="text-[10px] text-muted-2">{sub}</div> : null}
    </div>
  );
}
