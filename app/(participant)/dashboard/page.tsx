import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { serverToday } from "@/lib/server-date";
import { AutoCoachTrigger } from "@/components/auto-coach-trigger";
import { PostWorkoutAckTrigger } from "@/components/post-workout-ack-trigger";
import { PushOptIn } from "@/components/push-opt-in";
import { WhoopSyncButton } from "@/components/whoop-sync-button";
import type { DailyCheckin } from "@/lib/types";

export const metadata = { title: "Today — The Coach" };

function firstName(name?: string | null): string {
  if (!name) return "there";
  return name.trim().split(/\s+/)[0];
}

export default async function DashboardPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const today = await serverToday();

  const [recordRes, checkinRes, morningBriefRes, workoutReviewRes] =
    await Promise.all([
      supabase.from("users").select("full_name, push_token").eq("id", user.id).maybeSingle(),
      supabase
        .from("daily_checkins")
        .select("workout_completed")
        .eq("user_id", user.id)
        .eq("checkin_date", today)
        .maybeSingle(),
      // Latest morning brief from coach chat
      supabase
        .from("coach_messages")
        .select("body, created_at")
        .eq("user_id", user.id)
        .eq("kind", "morning_brief")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Latest workout review from coach chat
      supabase
        .from("coach_messages")
        .select("body, created_at")
        .eq("user_id", user.id)
        .eq("kind", "workout_review")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const name = firstName(recordRes.data?.full_name);
  const hasPushToken = !!(recordRes.data as { push_token?: string | null } | null)?.push_token;
  const checkin = (checkinRes.data as Partial<DailyCheckin>) ?? null;
  const trained =
    checkin?.workout_completed !== null && checkin?.workout_completed !== undefined;
  const morningBrief = morningBriefRes.data ?? null;
  const workoutReview = workoutReviewRes.data ?? null;

  // Brief summary: first 2 sentences of the coach message
  function excerpt(body: string): string {
    const sentences = body.match(/[^.!?]+[.!?]+/g) ?? [];
    return sentences.slice(0, 2).join(" ").trim() || body.slice(0, 160);
  }

  return (
    <PageShell width="content">
      <AutoCoachTrigger />
      <PostWorkoutAckTrigger />
      <PushOptIn hasPushToken={hasPushToken} />

      {/* Header */}
      <div className="mb-8">
        <div className="eyebrow mb-1.5">{formatDate(today)}</div>
        <h1 className="text-2xl font-semibold tracking-tight">Hi, {name}.</h1>
      </div>

      {/* Action buttons */}
      <div className="mb-8 flex flex-wrap gap-2">
        <Link href="/checkin" className={checkin ? "btn-ghost" : "btn-primary"}>
          {checkin ? "Edit check-in" : "Morning check-in"}
        </Link>
        <Link
          href="/post-workout"
          className={checkin && !trained ? "btn-primary" : "btn-ghost"}
        >
          {trained ? "Edit workout" : "Log workout"}
        </Link>
        <WhoopSyncButton />
      </div>

      {/* Morning brief */}
      {morningBrief ? (
        <div className="card mb-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-2">
            Morning brief
          </p>
          <p className="text-sm leading-relaxed text-muted">
            {excerpt(morningBrief.body)}
          </p>
          <Link href="/coach/chat" className="mt-3 inline-block text-sm font-medium text-accent">
            Open conversation →
          </Link>
        </div>
      ) : checkin ? (
        <div className="card mb-4 text-center">
          <p className="text-sm text-muted">Your coach is preparing today&apos;s brief…</p>
          <Link href="/coach/chat" className="mt-2 inline-block text-sm font-medium text-accent">
            Open chat →
          </Link>
        </div>
      ) : (
        <div className="card mb-4 text-center">
          <p className="text-sm text-muted">
            Do your morning check-in and your coach will plan today&apos;s session.
          </p>
        </div>
      )}

      {/* Workout review */}
      {workoutReview ? (
        <div className="card mb-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-2">
            Workout review
          </p>
          <p className="text-sm leading-relaxed text-muted">
            {excerpt(workoutReview.body)}
          </p>
          <Link href="/coach/chat" className="mt-3 inline-block text-sm font-medium text-accent">
            Open conversation →
          </Link>
        </div>
      ) : trained ? (
        <div className="card mb-4 text-center">
          <p className="text-sm text-muted">Your coach is reviewing your workout…</p>
          <Link href="/coach/chat" className="mt-2 inline-block text-sm font-medium text-accent">
            Open chat →
          </Link>
        </div>
      ) : checkin ? (
        <div className="card mb-4 text-center">
          <p className="text-sm text-muted">Log your workout and your coach will review it.</p>
          <Link href="/post-workout" className="mt-2 inline-block text-sm font-medium text-accent">
            Log workout →
          </Link>
        </div>
      ) : null}
    </PageShell>
  );
}
