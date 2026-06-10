import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  PageShell,
  ConfidenceBadge,
  OutcomeBadge,
  StatCard,
} from "@/components/ui";
import { formatDate } from "@/lib/format";
import { serverToday } from "@/lib/server-date";
import { AutoCoachTrigger } from "@/components/auto-coach-trigger";
import { PostWorkoutAckTrigger } from "@/components/post-workout-ack-trigger";
import { AddPhonePrompt } from "@/components/add-phone-prompt";
import { ReviewReadings } from "@/app/(participant)/upload/review-readings";
import type {
  CoachResponse,
  DailyCheckin,
  PredictionWithOutcome,
  PredictionOutcome,
  UploadedScreenshot,
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
  const today = await serverToday();

  const [
    recordRes,
    checkinRes,
    shotsCountRes,
    latestRes,
    predictionsRes,
    recentRes,
    profileRes,
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
    supabase
      .from("athlete_profiles")
      .select("phone")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  // Prompt athletes who onboarded before phone capture to add their number.
  const needsPhone = !((profileRes.data as { phone: string | null } | null)?.phone);

  // Pending OCR readings (uploaded anywhere) that still need the athlete's
  // confirmation before they reach the coach. Surfaced here since Upload was
  // removed from the nav.
  const { data: shotData } = await supabase
    .from("uploaded_screenshots")
    .select("*")
    .eq("user_id", user.id)
    .is("applied_at", null)
    .not("parsed_json", "is", null)
    .order("created_at", { ascending: false })
    .limit(10);
  const shotRows = (shotData as UploadedScreenshot[]) ?? [];
  const urlMap = new Map<string, string>();
  if (shotRows.length > 0) {
    const { data: signed } = await supabase.storage
      .from("screenshots")
      .createSignedUrls(shotRows.map((r) => r.storage_path), 60 * 60);
    signed?.forEach((s) => {
      if (s.signedUrl && s.path) urlMap.set(s.path, s.signedUrl);
    });
  }
  const pendingReadings = shotRows
    .filter(
      (r) =>
        r.parsed_json != null &&
        Object.values(r.parsed_json).some((v) => v !== null && v !== undefined),
    )
    .map((r) => ({
      id: r.id,
      source: r.source,
      capture_date: r.capture_date,
      created_at: r.created_at,
      file_name: r.file_name,
      url: urlMap.get(r.storage_path) ?? null,
      parsed: r.parsed_json as Record<string, number | null>,
    }));

  const name = firstName(recordRes.data?.full_name);
  const checkin = (checkinRes.data as DailyCheckin) ?? null;
  // Has today's training been logged via the post-workout check-in?
  const trained =
    checkin?.workout_completed !== null && checkin?.workout_completed !== undefined;
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
      <AutoCoachTrigger />
      <PostWorkoutAckTrigger />
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-1.5">{formatDate(today)}</div>
          <h1 className="text-2xl font-semibold tracking-tight">Hi, {name}.</h1>
        </div>
      </div>

      {needsPhone ? <AddPhonePrompt /> : null}

      {pendingReadings.length > 0 ? <ReviewReadings readings={pendingReadings} /> : null}

      {saved === "checkin" ? (
        <div className="mb-5 rounded-lg border border-success/30 bg-success-soft px-3.5 py-2.5 text-sm text-success">
          Morning check-in saved. Your coach will factor it into today's decision.
        </div>
      ) : null}
      {saved === "postworkout" ? (
        <div className="mb-5 rounded-lg border border-success/30 bg-success-soft px-3.5 py-2.5 text-sm text-success">
          Post-workout check-in saved. Your coach will send you a quick note and score today&apos;s session against its prediction.
        </div>
      ) : null}

      {/* Today's action card */}
      <div className="card mb-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {!checkin
                ? "Start with your morning check-in"
                : !trained
                  ? "You're checked in — log your workout after you train"
                  : "You're all logged for today"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {!checkin
                ? "A 60-second morning check-in is how your coach reads your day and plans today's session."
                : !trained
                  ? "After your session, the post-workout check-in lets your coach score its prediction."
                  : "Add screenshots so your coach has the full picture."}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link href="/checkin" className={checkin ? "btn-ghost" : "btn-primary"}>
              {checkin ? "Edit check-in" : "Morning check-in"}
            </Link>
            <Link
              href="/post-workout"
              className={checkin && !trained ? "btn-primary" : "btn-ghost"}
            >
              {trained ? "Edit workout" : "Log workout"}
            </Link>
            <Link href="/upload" className="btn-ghost">
              Upload
            </Link>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Morning check-in" value={checkin ? "Done" : "Not yet"} />
          <StatCard label="Workout" value={trained ? "Logged" : "Not yet"} />
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
