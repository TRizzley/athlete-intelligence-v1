import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageShell, BackLink } from "@/components/ui";
import { CoachResponseView } from "@/components/coach-response-view";
import { labelFor } from "@/lib/constants";
import { YSN_OPTIONS, WOULD_PAY_OPTIONS, PREDICTION_FEEDBACK_OPTIONS } from "@/lib/constants";
import type { CoachResponse, UserFeedback } from "@/lib/types";

export const metadata = { title: "Your daily decision — The Coach" };

export default async function CoachResponsePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ thanks?: string }>;
}) {
  const { id } = await params;
  const { thanks } = await searchParams;
  const user = await requireUser();
  const supabase = await createClient();

  const { data: response } = await supabase
    .from("coach_responses")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!response || (response as CoachResponse).user_id !== user.id) notFound();
  const r = response as CoachResponse;

  const { data: feedbackRow } = await supabase
    .from("user_feedback")
    .select("*")
    .eq("coach_response_id", id)
    .maybeSingle();
  const feedback = (feedbackRow as UserFeedback) ?? null;

  return (
    <PageShell width="content">
      <BackLink href="/coach">All responses</BackLink>

      {thanks ? (
        <div className="mb-5 rounded-lg border border-success/30 bg-success-soft px-3.5 py-2.5 text-sm text-success">
          Thank you — your feedback was saved. This is what makes the coach better.
        </div>
      ) : null}

      <div className="card">
        <CoachResponseView response={r} />
      </div>

      {/* Feedback call-to-action / summary */}
      <div className="mt-5">
        {feedback ? (
          <div className="card-tight">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Your feedback</h3>
              <Link href={`/feedback/${id}`} className="link text-sm">
                Edit
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Rated label="Accurate" value={labelFor(YSN_OPTIONS, feedback.felt_accurate)} />
              <Rated label="Personalized" value={labelFor(YSN_OPTIONS, feedback.felt_personalized)} />
              <Rated label="Useful" value={labelFor(YSN_OPTIONS, feedback.was_useful)} />
              <Rated label="Prediction" value={labelFor(PREDICTION_FEEDBACK_OPTIONS, feedback.prediction_came_true)} />
              <Rated label="Would pay" value={labelFor(WOULD_PAY_OPTIONS, feedback.would_pay)} />
            </div>
            {feedback.free_text ? (
              <p className="mt-3 border-t border-border pt-3 text-sm text-muted">
                “{feedback.free_text}”
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-accent/30 bg-accent/5 p-5 text-center">
            <div>
              <p className="font-medium text-foreground">Did this get you?</p>
              <p className="mt-1 text-sm text-muted">
                Two minutes of honest feedback shapes what we build next.
              </p>
            </div>
            <Link href={`/feedback/${id}`} className="btn-accent">
              Share your feedback
            </Link>
          </div>
        )}
      </div>
    </PageShell>
  );
}

function Rated({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-2">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}
