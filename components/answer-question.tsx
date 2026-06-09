"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { sendMessage, type FormState } from "@/app/(participant)/coach/chat/actions";
import { SubmitButton } from "@/components/interactive";

const initial: FormState = { error: null };

// Inline answer box for the coach's "One question for you" on a daily decision.
// It posts the athlete's reply straight into the coach chat (reusing sendMessage),
// so the answer feeds the coach's memory and gets a reply — the athlete doesn't
// have to leave the page or re-find the question in chat.
export function AnswerQuestion({
  question,
}: {
  question: string;
}) {
  const [state, action] = useActionState(sendMessage, initial);
  const [answer, setAnswer] = useState("");

  // We send the question + the answer as one message so the coach's reply has
  // the full context (the chat history doesn't include the daily-decision question).
  const composed =
    `My coach asked: "${question.trim()}"\n\nMy answer: ${answer.trim()}`;

  if (state.ok) {
    return (
      <div className="rounded-2xl border border-success/30 bg-success-soft p-5 text-center">
        <p className="font-medium text-foreground">Sent to your coach.</p>
        <p className="mt-1 text-sm text-muted">
          Your answer is in your chat — your coach has replied.
        </p>
        <Link href="/coach/chat" className="btn-accent mt-4 inline-flex">
          See your coach&apos;s reply
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="rounded-2xl border border-accent/30 bg-accent/5 p-5">
      <div className="eyebrow mb-1 text-accent">Answer your coach</div>
      <p className="mb-3 text-sm leading-relaxed text-foreground">{question}</p>

      {/* Send the composed question+answer as the chat message body. */}
      <input type="hidden" name="body" value={composed} />

      <textarea
        rows={3}
        required
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="Type your answer…"
        className="input min-h-[72px] w-full resize-y"
      />

      {state.error ? (
        <p className="mt-2 text-sm text-danger">{state.error}</p>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-2">Goes to your coach chat.</p>
        <SubmitButton pendingText="Sending…" variant="accent">
          Send answer
        </SubmitButton>
      </div>
    </form>
  );
}
