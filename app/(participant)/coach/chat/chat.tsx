"use client";

import { useActionState, useEffect, useRef } from "react";
import { sendMessage, type FormState } from "./actions";
import { SubmitButton } from "@/components/interactive";
import { relativeTime } from "@/lib/format";
import type { CoachMessage } from "@/lib/types";

const initial: FormState = { error: null };

export function Chat({ messages }: { messages: CoachMessage[] }) {
  const [state, action, isPending] = useActionState(sendMessage, initial);
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Keep the latest message in view as the conversation grows or while waiting.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isPending]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <div className="flex flex-col">
      <div className="space-y-3">
        {messages.length === 0 ? (
          <div className="card text-center text-sm text-muted">
            Ask your coach anything — how to adjust today, why they made a call, how a
            lift is trending. They have your full picture.
          </div>
        ) : (
          messages.map((m) => <Bubble key={m.id} message={m} />)
        )}

        {isPending ? (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-border bg-surface-2 px-3.5 py-2.5 text-sm text-muted">
              <span className="inline-flex items-center gap-1">
                Coach is thinking
                <span className="animate-pulse">…</span>
              </span>
            </div>
          </div>
        ) : null}

        <div ref={bottomRef} />
      </div>

      <form
        action={action}
        className="sticky bottom-0 mt-4 -mx-4 border-t border-border bg-background/90 px-4 py-3 backdrop-blur"
      >
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

function Bubble({ message }: { message: CoachMessage }) {
  const mine = message.role === "athlete";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] ${mine ? "items-end" : "items-start"}`}>
        <div
          className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
            mine
              ? "rounded-br-sm bg-accent/15 text-foreground"
              : "rounded-bl-sm border border-border bg-surface-2 text-foreground"
          }`}
        >
          {message.body}
        </div>
        <div className={`mt-1 text-[11px] text-muted-2 ${mine ? "text-right" : "text-left"}`}>
          {mine ? "You" : "Coach"} · {relativeTime(message.created_at)}
        </div>
      </div>
    </div>
  );
}
