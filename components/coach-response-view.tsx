import type { ReactNode } from "react";
import type { CoachResponse } from "@/lib/types";
import { formatDateLong } from "@/lib/format";
import { ConfidenceBadge, Prose } from "@/components/ui";

// The premium "conclusions first" reading layout for a single daily coaching
// decision. Used by the participant read page and the admin preview.
//
// To avoid a wall of text, everything except the hero recommendation is a
// tap-to-expand dropdown. Native <details> elements are used so this works with
// no client JavaScript (the component stays a server component).
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

      {/* The recommendation is the hero — always visible. */}
      <div className="rounded-2xl border border-accent/40 bg-accent/10 p-5">
        <div className="eyebrow mb-2 text-accent">Today's recommendation</div>
        <div className="text-lg font-medium leading-relaxed text-foreground">
          <Prose text={response.recommendation} />
        </div>
      </div>

      {/* Everything else collapses into dropdowns to keep the card scannable. */}
      <div className="space-y-2.5">
        <Dropdown label="What your coach noticed" defaultOpen>
          <Prose text={response.what_noticed} />
        </Dropdown>

        <Dropdown label="Why it matters">
          <Prose text={response.why_it_matters} />
        </Dropdown>

        <Dropdown label="Prediction for tomorrow" badge={<ConfidenceBadge value={response.confidence} />}>
          <Prose text={response.prediction} />
        </Dropdown>

        {response.athlete_question && response.athlete_question.trim() ? (
          <Dropdown label="One question for you" accent>
            <Prose text={response.athlete_question} />
          </Dropdown>
        ) : null}

        {response.data_used && response.data_used.trim() ? (
          <Dropdown label="What data your coach used" muted>
            <Prose text={response.data_used} />
          </Dropdown>
        ) : null}
      </div>
    </article>
  );
}

// A single collapsible section. Tap the header to reveal the body. `defaultOpen`
// starts expanded; `accent` / `muted` tweak the emphasis for question vs. data.
function Dropdown({
  label,
  children,
  badge,
  defaultOpen,
  accent,
  muted,
}: {
  label: string;
  children: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  accent?: boolean;
  muted?: boolean;
}) {
  const border = accent ? "border-accent/30 bg-accent/5" : "border-border bg-surface";
  return (
    <details open={defaultOpen} className={`group rounded-xl border ${border} px-4 py-3`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span
          className={`text-xs font-semibold uppercase tracking-[0.12em] ${
            accent ? "text-accent" : "text-muted-2"
          }`}
        >
          {label}
        </span>
        <span className="flex items-center gap-2">
          {badge}
          <svg
            className="h-4 w-4 text-muted-2 transition group-open:rotate-180"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </summary>
      <div
        className={`mt-3 leading-relaxed ${
          muted ? "text-sm text-muted" : "text-base text-foreground"
        }`}
      >
        {children}
      </div>
    </details>
  );
}
