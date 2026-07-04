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

  const [recordRes, checkinRes, morningBriefRes, workoutReviewRes, whoopTokenRes] =
    await Promise.all([
      supabase.from("users").select("full_name, push_token").eq("id", user.id).maybeSingle(),
      supabase
        .from("daily_checkins")
        .select("workout_completed, recovery_score, hrv_ms, resting_hr, sleep_hours, sleep_quality")
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
      // WHOOP token status
      supabase
        .from("whoop_tokens")
        .select("expires_at")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

  const name = firstName(recordRes.data?.full_name);
  const hasPushToken = !!(recordRes.data as { push_token?: string | null } | null)?.push_token;
  const checkin = (checkinRes.data as Partial<DailyCheckin> & {
    recovery_score?: number | null;
    hrv_ms?: number | null;
    resting_hr?: number | null;
    sleep_hours?: number | null;
    sleep_quality?: number | null;
  }) ?? null;
  const trained =
    checkin?.workout_completed !== null && checkin?.workout_completed !== undefined;

  const whoopBiometrics =
    checkin && (checkin.recovery_score != null || checkin.hrv_ms != null)
      ? {
          recovery_score: checkin.recovery_score ?? null,
          hrv_ms: checkin.hrv_ms ?? null,
          resting_hr: checkin.resting_hr ?? null,
          sleep_hours: checkin.sleep_hours ?? null,
          sleep_quality: checkin.sleep_quality ?? null,
        }
      : null;
  const morningBrief = morningBriefRes.data ?? null;
  const workoutReview = workoutReviewRes.data ?? null;

  // WHOOP connection status
  const whoopToken = whoopTokenRes.data as { expires_at: string } | null;
  const whoopConnected = !!whoopToken;
  // Access tokens expire in ~1 hour but are auto-refreshed by getValidWhoopToken.
  // Only show the reconnect banner when there's no token row at all (user never
  // connected, or actively revoked access on the WHOOP side).
  const whoopExpired = false;

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
        {whoopConnected && <WhoopSyncButton />}
      </div>

      {/* WHOOP: no token row → prompt to connect */}
      {!whoopConnected && (
        <div className="card mb-4 flex items-center justify-between gap-4">
          <p className="text-sm text-muted">
            Connect WHOOP to automatically sync your recovery, HRV, sleep, and strain data.
          </p>
          <a href="/api/whoop/connect" className="btn-primary text-sm shrink-0">
            Connect WHOOP
          </a>
        </div>
      )}

      {/* WHOOP biometrics card */}
      {whoopConnected && !whoopExpired && whoopBiometrics && (
        <div className="card mb-4">
          {/* Attribution per WHOOP brand guidelines */}
          <div className="mb-3 flex items-center gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-2">Data by</span>
            <span className="text-xs font-bold uppercase tracking-widest">WHOOP</span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {whoopBiometrics.recovery_score != null && (
              <div>
                <p className="text-xs text-muted">Recovery</p>
                <p
                  className="text-xl font-semibold"
                  style={{
                    color: whoopBiometrics.recovery_score >= 67
                      ? "#16EC06"
                      : whoopBiometrics.recovery_score >= 34
                        ? "#FFDE00"
                        : "#FF0026"
                  }}
                >
                  {whoopBiometrics.recovery_score}%
                </p>
              </div>
            )}
            {whoopBiometrics.hrv_ms != null && (
              <div>
                <p className="text-xs text-muted">HRV</p>
                <p className="text-xl font-semibold">{whoopBiometrics.hrv_ms}<span className="text-sm font-normal text-muted"> ms</span></p>
              </div>
            )}
            {whoopBiometrics.resting_hr != null && (
              <div>
                <p className="text-xs text-muted">Resting HR</p>
                <p className="text-xl font-semibold">{whoopBiometrics.resting_hr}<span className="text-sm font-normal text-muted"> bpm</span></p>
              </div>
            )}
            {whoopBiometrics.sleep_hours != null && (
              <div>
                <p className="text-xs text-muted">Sleep</p>
                <p className="text-xl font-semibold">{whoopBiometrics.sleep_hours}<span className="text-sm font-normal text-muted"> hrs</span></p>
              </div>
            )}
          </div>
        </div>
      )}

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
