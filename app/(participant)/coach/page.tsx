import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageShell, EmptyState, ConfidenceBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { CoachResponse, UserFeedback } from "@/lib/types";

export const metadata = { title: "Your coach — The Coach" };

export default async function CoachListPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: responsesData } = await supabase
    .from("coach_responses")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "sent")
    .order("response_date", { ascending: false });

  const responses = (responsesData as CoachResponse[]) ?? [];

  const { data: feedbackData } = await supabase
    .from("user_feedback")
    .select("coach_response_id")
    .eq("user_id", user.id);
  const ratedIds = new Set(
    (feedbackData as Pick<UserFeedback, "coach_response_id">[] | null)?.map(
      (f) => f.coach_response_id,
    ) ?? [],
  );

  return (
    <PageShell width="content">
      <div className="mb-6">
        <div className="eyebrow mb-1.5">Your coach</div>
        <h1 className="text-2xl font-semibold tracking-tight">Daily decisions</h1>
        <p className="mt-1.5 text-sm text-muted">
          Every coaching response, newest first. Tap one to read it and leave feedback.
        </p>
      </div>

      {responses.length === 0 ? (
        <EmptyState
          title="No coaching responses yet"
          body="Keep logging your check-ins and uploading screenshots. Your coach will send your first daily decision soon."
        />
      ) : (
        <div className="space-y-3">
          {responses.map((r) => {
            const rated = ratedIds.has(r.id);
            return (
              <Link
                key={r.id}
                href={`/coach/${r.id}`}
                className="card-tight block transition hover:border-border-strong"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {formatDate(r.response_date)}
                      </span>
                      <ConfidenceBadge value={r.confidence} />
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-muted">
                      {r.recommendation || r.what_noticed || "Open to read."}
                    </p>
                  </div>
                  <span
                    className={`pill shrink-0 ${
                      rated
                        ? "bg-success/15 text-success"
                        : "bg-accent/15 text-accent"
                    }`}
                  >
                    {rated ? "Rated" : "Needs feedback"}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
