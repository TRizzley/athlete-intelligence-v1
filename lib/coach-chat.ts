// Conversational chat reply — the athlete can message the coach any time.
// Server-only. Requires ANTHROPIC_API_KEY.

import Anthropic from "@anthropic-ai/sdk";
import type { CoachContext, ChatTurn } from "./coach-types";
import { buildContextText } from "./coach-context";

const CHAT_SYSTEM_PROMPT = [
  "You are the athlete's personal performance coach, replying in an ongoing chat.",
  "You have full context on this athlete (profile, recent check-ins, screenshots, logged workouts, past coaching decisions, predictions, and feedback) — it is provided below. Use it: reference their actual numbers, trends, sport, goal, and known patterns so every reply feels personal.",
  "",
  "STYLE:",
  "- Talk like a sharp, warm human coach texting back. Conversational and concise — usually 1-4 sentences. No corporate tone, no bullet-point essays unless they ask for a plan.",
  "- Lead with the answer. Be specific and direct. Ask a follow-up question only when it genuinely helps.",
  "- Speak in second person ('you'). No emojis unless they use them first.",
  "",
  "SAFETY — non-negotiable. You are a PERFORMANCE COACH, not a healthcare provider:",
  "- Do NOT give medical advice, diagnose, or interpret medical conditions.",
  "- Do NOT prescribe or adjust supplements, medications, or dosages.",
  "- If they describe pain, injury, illness, or concerning symptoms, keep training guidance conservative and point them to a qualified professional (doctor, physio, or dietitian).",
  "- When unsure, be conservative and defer to a professional.",
  "",
  "If you don't have enough data to answer well, say so plainly and ask for what you'd need. Never invent data.",
].join("\n");

/**
 * Generate the coach's conversational reply to the athlete's latest message,
 * given full athlete context and the recent conversation history.
 */
export async function generateCoachChatReply(
  ctx: CoachContext,
  history: ChatTurn[],
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

  const client = new Anthropic({ apiKey });

  const contextText = buildContextText(
    ctx,
    "That is everything you know about this athlete. Reply to their messages as their coach.",
  );

  const mapped: Anthropic.MessageParam[] = history.map((t) => ({
    role: (t.role === "athlete" ? "user" : "assistant") as "user" | "assistant",
    content: t.body,
  }));

  // Coalesce consecutive same-role turns (API requires strictly alternating roles).
  const messages: Anthropic.MessageParam[] = [];
  for (const m of mapped) {
    const last = messages[messages.length - 1];
    if (last && last.role === m.role && typeof last.content === "string") {
      last.content = `${last.content}\n\n${m.content as string}`;
    } else {
      messages.push({ role: m.role, content: m.content });
    }
  }

  // Drop any leading coach turns; ensure there is a trailing user message.
  while (messages.length > 0 && messages[0].role !== "user") messages.shift();
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    messages.push({ role: "user", content: "(Please reply to my latest message.)" });
  }

  const msg = await client.messages.create({
    model: process.env.COACH_MODEL || "claude-sonnet-4-6",
    max_tokens: 700,
    system: `${CHAT_SYSTEM_PROMPT}\n\n${contextText}`,
    messages,
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!text) throw new Error("The coach didn't have a reply. Try again.");
  return text;
}
