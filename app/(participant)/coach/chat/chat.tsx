"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sendMessage, type FormState } from "./actions";
import { SubmitButton } from "@/components/interactive";
import { relativeTime, todayISO } from "@/lib/format";
import type { CoachMessage } from "@/lib/types";

const initial: FormState = { error: null };

// What the athlete was just redirected here for. Drives the "coach is typing"
// state while the corresponding generation runs server-side.
export type ExpectKind = "brief" | "review" | null;

export function Chat({
  messages,
  expect = null,
}: {
  messages: CoachMessage[];
  expect?: ExpectKind;
}) {
  const router = useRouter();
  const [state, action, isPending] = useActionState(sendMessage, initial);
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // The browser's local today, sent with the message so the coach's "today" is
  // the athlete's real day (set after mount to avoid a hydration mismatch).
  const [localToday, setLocalToday] = useState("");
  useEffect(() => setLocalToday(todayISO()), []);

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
              <Bubble key={item.id} message={item} />
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
      >
        <input type="hidden" name="client_date" value={localToday} />
        <div className="flex items-end gap-2">
          <textarea
            // Remount (clear) once new messages land after a successful send.
            key={messages.length}
            ref={taRef}
            name="body"
            required
            rows={1}
            onKeyDown={onKeyDown}
            placeholder="Message your coach…"
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
};

function Bubble({ message }: { message: CoachMessage }) {
  const mine = message.role === "athlete";
  const kindLabel = !mine ? KIND_LABELS[message.kind] : undefined;
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
          {message.body}
        </div>
        <div className={`mt-1 text-[11px] text-muted-2 ${mine ? "text-right" : "text-left"}`}>
          {mine ? "You" : "Coach"} · {relativeTime(message.created_at)}
        </div>
      </div>
    </div>
  );
}
