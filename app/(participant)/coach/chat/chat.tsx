"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sendMessage, submitQuickFeedback, type FormState } from "./actions";
import { SubmitButton } from "@/components/interactive";
import { relativeTime, todayISO } from "@/lib/format";
import type { CoachMessage } from "@/lib/types";

// ---------------------------------------------------------------------------
// Workout proposal parsing
// ---------------------------------------------------------------------------

type WorkoutProposal = Record<string, unknown> & { action: string };

function extractProposal(body: string): { text: string; proposal: WorkoutProposal | null } {
  const match = body.match(/<workout_proposal>([\s\S]*?)<\/workout_proposal>/);
  if (!match) return { text: body, proposal: null };
  try {
    const proposal = JSON.parse(match[1].trim()) as WorkoutProposal;
    const text = body.replace(/<workout_proposal>[\s\S]*?<\/workout_proposal>/, "").trim();
    return { text, proposal };
  } catch {
    return { text: body, proposal: null };
  }
}

// A one-tap feedback prompt embeds the morning decision's id so a tap can record
// feedback against the right response. Parsed out the same way as proposals.
function extractFeedbackPrompt(body: string): { text: string; responseId: string | null } {
  const match = body.match(/<feedback_prompt>([\s\S]*?)<\/feedback_prompt>/);
  if (!match) return { text: body, responseId: null };
  const text = body.replace(/<feedback_prompt>[\s\S]*?<\/feedback_prompt>/, "").trim();
  try {
    const parsed = JSON.parse(match[1].trim()) as { response_id?: string };
    return { text, responseId: parsed.response_id ?? null };
  } catch {
    return { text, responseId: null };
  }
}

function proposalLabel(p: WorkoutProposal): string {
  switch (p.action) {
    case "add_exercise": {
      const ex = p.exercise as { name?: string } | undefined;
      return `Add ${ex?.name ?? "exercise"} to ${p.day_name ?? "day"}`;
    }
    case "remove_exercise":
      return `Remove ${p.exercise_name ?? "exercise"} from ${p.day_name ?? "day"}`;
    case "update_exercise":
      return `Update exercise in ${p.day_name ?? "day"}`;
    case "create_day":
      return `Create workout day: ${p.name ?? ""}`;
    case "create_program": {
      const days = p.days as unknown[];
      return `Import ${days?.length ?? 0}-day program`;
    }
    default:
      return "Apply workout change";
  }
}

const initial: FormState = { error: null };

// What the athlete was just redirected here for. Drives the "coach is typing"
// state while the corresponding generation runs server-side.
export type ExpectKind = "brief" | "review" | null;

export function Chat({
  messages,
  expect = null,
  answeredResponseIds = [],
}: {
  messages: CoachMessage[];
  expect?: ExpectKind;
  answeredResponseIds?: string[];
}) {
  const answeredSet = new Set(answeredResponseIds);
  const router = useRouter();
  const [state, action, isPending] = useActionState(sendMessage, initial);
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // The browser's local today, sent with the message so the coach's "today" is
  // the athlete's real day (set after mount to avoid a hydration mismatch).
  const [localToday, setLocalToday] = useState("");
  useEffect(() => setLocalToday(todayISO()), []);

  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------------------
  // Chat-first check-ins: when the athlete lands here right after a check-in
  // (?expect=brief) or a logged workout (?expect=review), ping the idempotent
  // generation route and show a typing bubble until the coach's message lands.
  // With no expect param we still ping both routes silently — they no-op
  // cheaply when there's nothing new, so the brief/review always catches up
  // even if the athlete navigates here on their own.
  // ---------------------------------------------------------------------------
  const [generating, setGenerating] = useState<ExpectKind>(expect);
  const pinged = useRef(false);
  useEffect(() => {
    if (pinged.current) return;
    pinged.current = true;

    const ping = async (path: string) => {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The browser's LOCAL today, so the coach's day matches the athlete's.
        body: JSON.stringify({ date: todayISO() }),
      });
      return (await res.json().catch(() => null)) as
        | { ok?: boolean; sent?: boolean }
        | null;
    };

    (async () => {
      try {
        // Order matters: the morning decision first (the review reads it).
        const brief = await ping("/api/coach/auto-respond");
        const review = await ping("/api/coach/post-workout-ack");
        if (brief?.sent || review?.sent) router.refresh();
      } catch {
        // Best-effort: never disrupt the chat if generation fails.
      } finally {
        setGenerating(null);
        // Drop the ?expect=… param so a reload doesn't re-show the typing state.
        if (expect) router.replace("/coach/chat", { scroll: false });
      }
    })();
  }, [router, expect]);

  // Keep the latest message in view as the conversation grows or while waiting.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isPending, generating]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  // Group messages by local calendar day for date dividers.
  const withDividers: (CoachMessage | { divider: string })[] = [];
  let lastDay = "";
  for (const m of messages) {
    const day = new Date(m.created_at).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    if (day !== lastDay) {
      withDividers.push({ divider: day });
      lastDay = day;
    }
    withDividers.push(m);
  }

  return (
    <div className="flex flex-col">
      <div className="space-y-3">
        {messages.length === 0 && !generating ? (
          <div className="card text-center text-sm text-muted">
            Ask your coach anything — how to adjust today, why they made a call, how a
            lift is trending. They have your full picture.
          </div>
        ) : (
          withDividers.map((item) =>
            "divider" in item ? (
              <div
                key={`d-${item.divider}`}
                className="flex items-center gap-3 py-1 text-[11px] uppercase tracking-wide text-muted-2"
              >
                <span className="h-px flex-1 bg-border" />
                {item.divider}
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : (
              <Bubble
                key={item.id}
                message={item}
                answeredSet={answeredSet}
              />
            ),
          )
        )}

        {generating ? (
          <Typing
            label={
              generating === "review"
                ? "Coach is reviewing your session"
                : "Coach is reading your check-in"
            }
          />
        ) : isPending ? (
          <Typing label="Coach is thinking" />
        ) : null}

        <div ref={bottomRef} />
      </div>

      <form
        action={action}
        className="sticky bottom-0 mt-4 -mx-4 border-t border-border bg-background/90 px-4 py-3 backdrop-blur"
        onSubmit={() => setPdfFile(null)}
      >
        <input type="hidden" name="client_date" value={localToday} />
        {/* Hidden file input for PDF uploads */}
        <input
          ref={fileRef}
          type="file"
          name="pdf"
          accept=".pdf"
          className="hidden"
          onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
        />
        {pdfFile ? (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">
            <span className="flex-1 truncate text-muted">{pdfFile.name}</span>
            <button
              type="button"
              onClick={() => { setPdfFile(null); if (fileRef.current) fileRef.current.value = ""; }}
              className="text-muted-2 hover:text-foreground"
            >
              ✕
            </button>
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-lg border border-border text-muted hover:text-foreground"
            title="Attach workout PDF"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <textarea
            key={messages.length}
            ref={taRef}
            name="body"
            rows={1}
            onKeyDown={onKeyDown}
            placeholder={pdfFile ? "Add a note about the PDF (optional)…" : "Message your coach…"}
            className="input max-h-40 min-h-[44px] flex-1 resize-y"
          />
          <SubmitButton pendingText="Sending…" variant="accent">
            Send
          </SubmitButton>
        </div>
        {state.error ? (
          <p className="mt-2 text-sm text-danger">{state.error}</p>
        ) : null}
        <p className="mt-2 text-[11px] text-muted-2">
          Your coach gives training guidance, not medical advice.
        </p>
      </form>
    </div>
  );
}

function Typing({ label }: { label: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-surface-2 px-3.5 py-2.5 text-sm text-muted">
        <span className="inline-flex items-center gap-1">
          {label}
          <span className="animate-pulse">…</span>
        </span>
      </div>
    </div>
  );
}

const KIND_LABELS: Record<string, string> = {
  morning_brief: "Morning brief",
  workout_review: "Workout review",
  feedback_prompt: "Quick feedback",
};

// One-tap feedback card rendered under a feedback_prompt message. Three taps map
// to "did my call land?" — Nailed it / Sort of / Off. An optional one-line note
// can ride along. Submitting records feedback for the embedded morning decision.
const QUICK_FEEDBACK_OPTIONS: { value: "yes" | "somewhat" | "no"; label: string }[] = [
  { value: "yes", label: "Nailed it" },
  { value: "somewhat", label: "Sort of" },
  { value: "no", label: "Off" },
];

function QuickFeedbackCard({
  responseId,
  alreadyAnswered,
}: {
  responseId: string;
  alreadyAnswered: boolean;
}) {
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">(
    alreadyAnswered ? "done" : "idle",
  );
  const [errorMsg, setErrorMsg] = useState("");
  const [comment, setComment] = useState("");

  async function submit(rating: "yes" | "somewhat" | "no") {
    setStatus("saving");
    try {
      const res = await submitQuickFeedback(responseId, rating, comment);
      if (res.ok) {
        setStatus("done");
      } else {
        setStatus("error");
        setErrorMsg(res.error ?? "Could not save that.");
      }
    } catch {
      setStatus("error");
      setErrorMsg("Could not save that.");
    }
  }

  if (status === "done") {
    return (
      <div className="mt-2 rounded-xl border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
        ✓ Thanks — logged. This is what sharpens tomorrow&apos;s call.
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2.5">
      <div className="flex flex-wrap gap-2">
        {QUICK_FEEDBACK_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => submit(o.value)}
            disabled={status === "saving"}
            className="rounded-lg border border-accent/40 bg-surface-2 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent/10 disabled:opacity-50"
          >
            {o.label}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Add a word (optional)…"
        className="input mt-2 h-9 text-sm"
      />
      {status === "error" ? (
        <p className="mt-1.5 text-xs text-danger">{errorMsg}</p>
      ) : null}
    </div>
  );
}

function WorkoutProposalCard({ proposal }: { proposal: WorkoutProposal }) {
  const [status, setStatus] = useState<"idle" | "applying" | "done" | "error">("idle");
  const [resultMsg, setResultMsg] = useState("");

  async function apply() {
    setStatus("applying");
    try {
      const res = await fetch("/api/coach/workout/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(proposal),
      });
      const json = await res.json() as { ok?: boolean; message?: string; error?: string };
      if (json.ok) {
        setStatus("done");
        setResultMsg(json.message ?? "Done!");
      } else {
        setStatus("error");
        setResultMsg(json.error ?? "Something went wrong.");
      }
    } catch {
      setStatus("error");
      setResultMsg("Could not apply change.");
    }
  }

  if (status === "done") {
    return (
      <div className="mt-2 rounded-xl border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
        ✓ {resultMsg}
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="mt-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
        {resultMsg}
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-accent">Workout change</p>
      <p className="mt-0.5 text-sm text-foreground">{proposalLabel(proposal)}</p>
      <button
        onClick={apply}
        disabled={status === "applying"}
        className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
      >
        {status === "applying" ? "Applying…" : "Confirm"}
      </button>
    </div>
  );
}

function Bubble({
  message,
  answeredSet,
}: {
  message: CoachMessage;
  answeredSet: Set<string>;
}) {
  const mine = message.role === "athlete";
  const kindLabel = !mine ? KIND_LABELS[message.kind] : undefined;
  const isFeedbackPrompt = !mine && message.kind === "feedback_prompt";

  let text = message.body;
  let proposal: WorkoutProposal | null = null;
  let feedbackResponseId: string | null = null;
  if (!mine) {
    if (isFeedbackPrompt) {
      const fb = extractFeedbackPrompt(message.body);
      text = fb.text;
      feedbackResponseId = fb.responseId;
    } else {
      const ex = extractProposal(message.body);
      text = ex.text;
      proposal = ex.proposal;
    }
  }

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] ${mine ? "items-end" : "items-start"}`}>
        <div
          className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
            mine
              ? "rounded-br-sm bg-accent/15 text-foreground"
              : kindLabel
                ? "rounded-bl-sm border border-accent/30 bg-surface-2 text-foreground"
                : "rounded-bl-sm border border-border bg-surface-2 text-foreground"
          }`}
        >
          {kindLabel ? (
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
              {kindLabel}
            </div>
          ) : null}
          {text}
        </div>
        {proposal ? <WorkoutProposalCard proposal={proposal} /> : null}
        {feedbackResponseId ? (
          <QuickFeedbackCard
            responseId={feedbackResponseId}
            alreadyAnswered={answeredSet.has(feedbackResponseId)}
          />
        ) : null}
        <div className={`mt-1 text-[11px] text-muted-2 ${mine ? "text-right" : "text-left"}`}>
          {mine ? "You" : "Coach"} · {relativeTime(message.created_at)}
        </div>
      </div>
    </div>
  );
}
