import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageShell, BackLink, Prose } from "@/components/ui";
import { formatDateLong } from "@/lib/format";
import { FeedbackForm } from "./feedback-form";
import type { CoachResponse, UserFeedback } from "@/lib/types";

export const metadata = { title: "Your feedback — The Coach" };

export default async function FeedbackPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const supabase = await createClient();

  const { data: response } = await supabase
    .from("coach_responses")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!response || (response as CoachResponse).user_id !== user.id) notFound();
  const r = response as CoachResponse;

  const { data: feedback } = await supabase
    .from("user_feedback")
    .select("*")
    .eq("coach_response_id", id)
    .maybeSingle();

  return (
    <PageShell width="content">
      <BackLink href={`/coach/${id}`}>Back to response</BackLink>

      <div className="mb-6">
        <div className="eyebrow mb-1.5">Your feedback</div>
        <h1 className="text-2xl font-semibold tracking-tight">
          How did your coach do?
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          For the decision from {formatDateLong(r.response_date)}. Be brutally
          honest — this is exactly what we're testing.
        </p>
      </div>

      {/* Recap of the recommendation being rated */}
      <div className="card-tight mb-6 bg-surface-2">
        <div className="eyebrow mb-1.5 text-accent">The recommendation</div>
        <div className="text-sm text-foreground">
          <Prose text={r.recommendation} />
        </div>
      </div>

      <FeedbackForm responseId={id} existing={(feedback as UserFeedback) ?? null} />
    </PageShell>
  );
}
