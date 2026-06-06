import type { ReactNode } from "react";
import type { CoachResponse } from "@/lib/types";
import { formatDateLong } from "@/lib/format";
import { ConfidenceBadge, Prose } from "@/components/ui";

// The premium "conclusions first" reading layout for a single daily coaching
// decision. Used by the participant read page and the admin preview.
export function CoachResponseView({ response }: { response: CoachResponse }) {
  return (
    <article className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <div className="eyebrow mb-1">Your daily decision</div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {formatDateLong(response.response_date)}
          </h1>
        </div>
        <ConfidenceBadge value={response.confidence} />
      </header>

      <Block label="What your coach noticed" lead>
        <Prose text={response.what_noticed} />
      </Block>

      <Block label="Why it matters">
        <Prose text={response.why_it_matters} />
      </Block>

      {/* The recommendation is the hero — make it unmissable. */}
      <div className="rounded-2xl border border-accent/40 bg-accent/10 p-5">
        <div className="eyebrow mb-2 text-accent">Today's recommendation</div>
        <div className="text-lg font-medium leading-relaxed text-foreground">
          <Prose text={response.recommendation} />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface-2 p-5">
        <div className="mb-2 flex items-center justify-between">
          <div className="eyebrow">Prediction for tomorrow</div>
          <ConfidenceBadge value={response.confidence} />
        </div>
        <Prose text={response.prediction} />
      </div>

      {response.athlete_question && response.athlete_question.trim() ? (
        <div className="rounded-2xl border border-accent/30 bg-accent/5 p-5">
          <div className="eyebrow mb-2 text-accent">One question for you</div>
          <div className="text-base font-medium leading-relaxed text-foreground">
            <Prose text={response.athlete_question} />
          </div>
        </div>
      ) : null}

      {response.data_used && response.data_used.trim() ? (
        <details className="group rounded-xl border border-border bg-surface px-4 py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-muted">
            <span>What data your coach used</span>
            <svg
              className="h-4 w-4 transition group-open:rotate-180"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div className="mt-3 text-sm text-muted">
            <Prose text={response.data_used} />
          </div>
        </details>
      ) : null}
    </article>
  );
}

function Block({
  label,
  children,
  lead,
}: {
  label: string;
  children: ReactNode;
  lead?: boolean;
}) {
  return (
    <section>
      <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-2">
        {label}
      </h2>
      <div className={lead ? "text-base leading-relaxed text-foreground" : "text-sm"}>
        {children}
      </div>
    </section>
  );
}
