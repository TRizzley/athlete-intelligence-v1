import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  PageShell,
  BackLink,
  Avatar,
  DataPoint,
  MetricBar,
  OutcomeBadge,
  StatusPill,
  ConfidenceBadge,
  Prose,
  EmptyState,
} from "@/components/ui";
import { CheckinDetail, CheckinHistoryRow } from "@/components/checkin-detail";
import { CoachResponseView } from "@/components/coach-response-view";
import {
  ResponseComposer,
  PredictionForm,
  OutcomeForm,
  MemoryNoteForm,
  TrustSnapshotButton,
  DeleteResponseButton,
  DeletePredictionButton,
  DeleteMemoryNoteButton,
} from "./admin-forms";
import { computeTrustMetrics } from "@/lib/metrics";
import { formatDate, formatDateLong, relativeTime, todayISO } from "@/lib/format";
import {
  labelFor,
  SPORTS,
  GOALS,
  TRAINING_AGES,
  SEXES,
  SOURCE_LABELS,
  YSN_OPTIONS,
  WOULD_PAY_OPTIONS,
  PREDICTION_FEEDBACK_OPTIONS,
} from "@/lib/constants";
import type {
  AthleteProfile,
  DailyCheckin,
  UploadedScreenshot,
  CoachResponse,
  PredictionWithOutcome,
  PredictionOutcome,
  UserFeedback,
  AthleteMemoryNote,
  TrustMetricSnapshot,
} from "@/lib/types";

export const metadata = { title: "Athlete review — Coach Console" };

type UserRec = { id: string; email: string | null; full_name: string | null; created_at: string };
type FeedbackJoined = UserFeedback & { coach_responses: { response_date: string } | null };

function firstOutcome(p: PredictionWithOutcome): PredictionOutcome | null {
  const po = p.prediction_outcomes;
  if (!po) return null;
  return Array.isArray(po) ? po[0] ?? null : po;
}

export default async function AthleteReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const today = todayISO();

  const { data: userRec } = await supabase
    .from("users")
    .select("id, email, full_name, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!userRec) notFound();
  const u = userRec as UserRec;

  const [
    profileRes,
    checkinsRes,
    shotsRes,
    responsesRes,
    predictionsRes,
    feedbackRes,
    memoryRes,
    snapshotRes,
  ] = await Promise.all([
    supabase.from("athlete_profiles").select("*").eq("user_id", id).maybeSingle(),
    supabase.from("daily_checkins").select("*").eq("user_id", id).order("checkin_date", { ascending: false }).limit(30),
    supabase.from("uploaded_screenshots").select("*").eq("user_id", id).order("created_at", { ascending: false }).limit(24),
    supabase.from("coach_responses").select("*").eq("user_id", id).order("response_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("predictions").select("*, prediction_outcomes(*)").eq("user_id", id).order("created_at", { ascending: false }),
    supabase.from("user_feedback").select("*, coach_responses(response_date)").eq("user_id", id).order("created_at", { ascending: false }),
    supabase.from("athlete_memory_notes").select("*").eq("user_id", id).order("created_at", { ascending: false }),
    supabase.from("trust_metrics").select("*").eq("user_id", id).order("snapshot_date", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const profile = (profileRes.data as AthleteProfile) ?? null;
  const checkins = (checkinsRes.data as DailyCheckin[]) ?? [];
  const screenshots = (shotsRes.data as UploadedScreenshot[]) ?? [];
  const responses = (responsesRes.data as CoachResponse[]) ?? [];
  const predictions = (predictionsRes.data as PredictionWithOutcome[]) ?? [];
  const feedback = (feedbackRes.data as FeedbackJoined[]) ?? [];
  const memory = (memoryRes.data as AthleteMemoryNote[]) ?? [];
  const snapshot = (snapshotRes.data as TrustMetricSnapshot) ?? null;

  const latest = checkins[0] ?? null;
  const outcomes = predictions.map(firstOutcome).filter(Boolean) as PredictionOutcome[];
  const metrics = computeTrustMetrics(feedback, outcomes, predictions.length);
  const feedbackByResponse = new Set(feedback.map((f) => f.coach_response_id));

  // Signed URLs for screenshots.
  const urlMap = new Map<string, string>();
  if (screenshots.length > 0) {
    const { data: signed } = await supabase.storage
      .from("screenshots")
      .createSignedUrls(screenshots.map((s) => s.storage_path), 60 * 60);
    signed?.forEach((s) => {
      if (s.signedUrl && s.path) urlMap.set(s.path, s.signedUrl);
    });
  }

  return (
    <PageShell width="wide">
      <BackLink href="/admin">All participants</BackLink>

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar name={u.full_name} email={u.email} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {u.full_name || u.email || "Unnamed athlete"}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{u.email}</span>
            {profile?.primary_sport ? (
              <span className="pill bg-surface-3 text-muted">{labelFor(SPORTS, profile.primary_sport)}</span>
            ) : null}
            {profile?.experience_mode ? (
              <span className="pill bg-accent/15 text-accent">{profile.experience_mode} mode</span>
            ) : null}
            <span className="text-muted-2">· joined {formatDate(u.created_at)}</span>
          </div>
          {profile?.goal_detail ? (
            <p className="mt-1 text-sm text-muted">Goal: {profile.goal_detail}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* MAIN COLUMN */}
        <div className="space-y-6 lg:col-span-2">
          {/* Latest check-in */}
          <section className="card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
                Latest check-in
              </h2>
              {latest ? (
                <span className="text-xs text-muted">
                  {formatDate(latest.checkin_date)}
                  {latest.checkin_date === today ? (
                    <span className="ml-2 pill bg-success/15 text-success">Today</span>
                  ) : null}
                </span>
              ) : null}
            </div>
            {latest ? (
              <CheckinDetail checkin={latest} />
            ) : (
              <p className="text-sm text-muted">No check-ins yet.</p>
            )}
          </section>

          {/* Compose response */}
          <section className="card border-accent/30">
            <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-2">
              Write today's decision
            </h2>
            <p className="mb-4 text-xs text-muted">
              Conclusions first. Make it specific, non-obvious, and personal — the
              kind of call they couldn't get from their own device.
            </p>
            <ResponseComposer userId={id} dateISO={today} />
          </section>

          {/* Existing responses */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-2">
              Coaching responses ({responses.length})
            </h2>
            {responses.length === 0 ? (
              <p className="text-sm text-muted-2">None yet.</p>
            ) : (
              <div className="space-y-3">
                {responses.map((r) =>
                  r.status === "draft" ? (
                    <div key={r.id} className="card border-warning/30">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm font-semibold text-foreground">
                          {formatDate(r.response_date)} · editing draft
                        </span>
                        <div className="flex items-center gap-2">
                          <StatusPill value={r.status} />
                          <DeleteResponseButton userId={id} responseId={r.id} />
                        </div>
                      </div>
                      <ResponseComposer userId={id} editing={r} dateISO={today} />
                    </div>
                  ) : (
                    <div key={r.id} className="card">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {formatDate(r.response_date)}
                        </span>
                        <div className="flex items-center gap-2">
                          <span
                            className={`pill ${
                              feedbackByResponse.has(r.id)
                                ? "bg-success/15 text-success"
                                : "bg-surface-3 text-muted"
                            }`}
                          >
                            {feedbackByResponse.has(r.id) ? "Rated" : "Awaiting feedback"}
                          </span>
                          <StatusPill value={r.status} />
                        </div>
                      </div>
                      <p className="mb-2 text-xs text-muted-2">
                        Sent {r.sent_at ? relativeTime(r.sent_at) : "—"}
                      </p>
                      <details className="group">
                        <summary className="cursor-pointer list-none text-sm text-accent">
                          Preview what the athlete sees
                        </summary>
                        <div className="mt-3 rounded-xl border border-border bg-surface-2 p-4">
                          <CoachResponseView response={r} />
                        </div>
                      </details>
                      <div className="mt-3 flex justify-end">
                        <DeleteResponseButton userId={id} responseId={r.id} />
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </section>

          {/* Predictions */}
          <section className="card">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-2">
              Predictions
            </h2>
            <PredictionForm userId={id} dateISO={today} />
            <div className="mt-5 space-y-3">
              {predictions.length === 0 ? (
                <p className="text-sm text-muted-2">No predictions yet.</p>
              ) : (
                predictions.map((p) => {
                  const o = firstOutcome(p);
                  return (
                    <div key={p.id} className="rounded-lg border border-border bg-surface-2 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground">{p.prediction_text}</p>
                          <p className="mt-0.5 text-xs text-muted-2">
                            {p.horizon}
                            {p.target_date ? ` · target ${formatDate(p.target_date)}` : ""}
                            {p.confidence ? ` · ${p.confidence} confidence` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <OutcomeBadge value={o?.outcome ?? null} />
                          <DeletePredictionButton userId={id} predictionId={p.id} />
                        </div>
                      </div>
                      <OutcomeForm userId={id} prediction={p} outcome={o} />
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>

        {/* SIDEBAR */}
        <aside className="space-y-6">
          {/* Trust metrics */}
          <section className="card">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-2">
                Trust &amp; accuracy
              </h2>
              <TrustSnapshotButton userId={id} />
            </div>
            <div className="space-y-3.5">
              <MetricBar label="Feels personalized" value={metrics.ahaRate} sample={`${metrics.feedbackCount}`} goodAt={60} />
              <MetricBar label="Feels accurate" value={metrics.accuracyRate} sample={`${metrics.feedbackCount}`} goodAt={60} />
              <MetricBar label="Useful" value={metrics.usefulnessRate} sample={`${metrics.feedbackCount}`} goodAt={50} />
              <MetricBar label="Would pay" value={metrics.wouldPayRate} sample={`${metrics.feedbackCount}`} goodAt={40} />
              <MetricBar label="Prediction accuracy" value={metrics.predictionAccuracy} sample={`${metrics.predictionsScored}`} goodAt={70} />
            </div>
            <p className="mt-3 text-[11px] text-muted-2">
              {snapshot
                ? `Last snapshot ${formatDate(snapshot.snapshot_date)}.`
                : "No snapshot saved yet."}
            </p>
          </section>

          {/* Profile */}
          <section className="card">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-2">
              Athlete profile
            </h2>
            {profile ? (
              <div className="grid grid-cols-2 gap-2">
                <DataPoint label="Age" value={profile.age ?? "—"} />
                <DataPoint label="Sex" value={labelFor(SEXES, profile.sex)} />
                <DataPoint label="Weight" value={profile.body_weight_lbs ? `${profile.body_weight_lbs} lb` : "—"} />
                <DataPoint label="Height" value={profile.height_in ? `${profile.height_in} in` : "—"} />
                <DataPoint label="Sport" value={labelFor(SPORTS, profile.primary_sport)} />
                <DataPoint label="Experience" value={labelFor(TRAINING_AGES, profile.training_age)} />
                <DataPoint label="Goal" value={labelFor(GOALS, profile.primary_goal)} />
                <DataPoint label="Days/week" value={profile.training_days_per_week ?? "—"} />
                <div className="col-span-2">
                  <DataPoint label="Program" value={profile.current_program ?? "—"} />
                </div>
                <div className="col-span-2">
                  <DataPoint label="Devices" value={profile.devices && profile.devices.length ? profile.devices.join(", ") : "—"} />
                </div>
                <div className="col-span-2">
                  <DataPoint label="Nutrition app" value={profile.nutrition_app ?? "—"} />
                </div>
                {profile.injuries ? (
                  <div className="col-span-2">
                    <DataPoint label="Injuries / limits" value={profile.injuries} />
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-2">Athlete hasn't completed onboarding.</p>
            )}
          </section>

          {/* Coach memory */}
          <section className="card">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-2">
              Coach memory
            </h2>
            <MemoryNoteForm userId={id} />
            <div className="mt-4 space-y-2">
              {memory.length === 0 ? (
                <p className="text-xs text-muted-2">No notes yet. Capture patterns, preferences, and context here.</p>
              ) : (
                memory.map((n) => (
                  <div key={n.id} className="rounded-lg border border-border bg-surface-2 px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {n.category ? (
                          <span className="mr-1.5 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                            {n.category}
                          </span>
                        ) : null}
                        <span className="text-sm text-foreground">{n.note}</span>
                        <div className="mt-0.5 text-[10px] text-muted-2">{formatDate(n.created_at)}</div>
                      </div>
                      <DeleteMemoryNoteButton userId={id} noteId={n.id} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Feedback log */}
          <section className="card">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-2">
              Feedback ({feedback.length})
            </h2>
            {feedback.length === 0 ? (
              <p className="text-xs text-muted-2">No feedback submitted yet.</p>
            ) : (
              <div className="space-y-3">
                {feedback.map((f) => (
                  <div key={f.id} className="rounded-lg border border-border bg-surface-2 p-3">
                    <div className="mb-2 text-xs text-muted-2">
                      On {f.coach_responses?.response_date ? formatDate(f.coach_responses.response_date) : formatDate(f.created_at)}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Fb label="Accurate" value={labelFor(YSN_OPTIONS, f.felt_accurate)} good={f.felt_accurate === "yes"} />
                      <Fb label="Personal" value={labelFor(YSN_OPTIONS, f.felt_personalized)} good={f.felt_personalized === "yes"} />
                      <Fb label="Useful" value={labelFor(YSN_OPTIONS, f.was_useful)} good={f.was_useful === "yes"} />
                      <Fb label="Prediction" value={labelFor(PREDICTION_FEEDBACK_OPTIONS, f.prediction_came_true)} good={f.prediction_came_true === "yes"} />
                      <Fb label="Pay" value={labelFor(WOULD_PAY_OPTIONS, f.would_pay)} good={f.would_pay === "yes"} />
                    </div>
                    {f.free_text ? (
                      <p className="mt-2 text-sm text-muted">“{f.free_text}”</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Screenshots */}
          <section className="card">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-2">
              Screenshots ({screenshots.length})
            </h2>
            {screenshots.length === 0 ? (
              <p className="text-xs text-muted-2">No uploads yet.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {screenshots.map((s) => {
                  const url = urlMap.get(s.storage_path);
                  return (
                    <a key={s.id} href={url} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-lg border border-border">
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={SOURCE_LABELS[s.source] ?? s.source} className="aspect-square w-full bg-surface-2 object-cover" />
                      ) : (
                        <div className="flex aspect-square items-center justify-center bg-surface-2 text-[10px] text-muted-2">n/a</div>
                      )}
                      <div className="bg-surface px-1.5 py-1 text-[10px] text-muted">
                        {SOURCE_LABELS[s.source] ?? s.source}
                      </div>
                    </a>
                  );
                })}
              </div>
            )}
          </section>

          {/* Check-in history */}
          <section className="card">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-2">
              Check-in history
            </h2>
            {checkins.length <= 1 ? (
              <p className="text-xs text-muted-2">Not enough history yet.</p>
            ) : (
              <div className="divide-y divide-border">
                {checkins.slice(0, 14).map((c) => (
                  <CheckinHistoryRow key={c.id} checkin={c} />
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </PageShell>
  );
}

function Fb({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <span className={`pill ${good ? "bg-success/15 text-success" : "bg-surface-3 text-muted"}`}>
      {label}: {value}
    </span>
  );
}
