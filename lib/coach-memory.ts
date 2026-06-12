// Memory distillation — turns chat conversations and daily check-ins into
// durable athlete notes. Uses a small, cheap model; never throws fatally so
// callers treat failure as "no new notes" and chat is never blocked.
// Server-only. Requires ANTHROPIC_API_KEY.

import Anthropic from "@anthropic-ai/sdk";
import type { ChatTurn } from "./coach-types";
import { asString } from "./coach-context";

export interface DistilledNote {
  category: string | null; // e.g. "preference", "history", "pattern", "goal", "constraint", "style"
  note: string;
}

const DISTILL_SYSTEM_PROMPT = [
  "You maintain a performance coach's private long-term memory about ONE athlete.",
  "You are given the notes already on file and a recent chat between the coach and the athlete.",
  "Extract ONLY new, durable facts worth remembering for future coaching sessions — things that will still be true next week:",
  "- preferences (how they like to train, be coached, communicate)",
  "- constraints (schedule, equipment, recurring injuries, dietary limits)",
  "- history & context (past PRs, life events, work/school stressors, sport background)",
  "- stable patterns (e.g. 'pushes through fatigue', 'sleep drops during exam weeks')",
  "- goals and what 'good coaching' means to them",
  "Do NOT record transient daily state (today's soreness, one-off mood, a single night's sleep) — that already lives in check-ins.",
  "Do NOT duplicate or lightly reword a note already on file. Only return genuinely new information.",
  "Keep each note one crisp sentence, written about the athlete in third person so it reads cleanly as a standalone fact.",
  "If there is nothing new worth saving, return an empty list. Be conservative — quality over quantity.",
  "Return ONLY by calling save_memory_notes.",
].join("\n");

const CHECKIN_DISTILL_SYSTEM_PROMPT = [
  "You maintain a performance coach's private long-term memory about ONE athlete.",
  "You are given the notes already on file and the free-text fields from a single daily check-in (open_comments and/or pain_injury_note).",
  "Extract ONLY new, durable facts worth remembering for future coaching — things that will still be true or relevant next week:",
  "- injuries and recurring pain patterns (e.g. 'right shoulder clicking during pressing', 'knee flares up on high-volume squat days')",
  "- schedule or life constraints (e.g. 'starting a new demanding job', 'exam week in June', 'traveling for work')",
  "- coaching context they shared (e.g. 'their sport coach said to limit overhead pressing', 'doctor cleared them for full training')",
  "- stable behavioral patterns (e.g. 'tends to underreport fatigue', 'skips post-workout nutrition when busy')",
  "Do NOT record: today's soreness, how they feel today, one-off moods, routine check-in context.",
  "Do NOT duplicate or lightly reword a note already on file.",
  "Keep each note one crisp sentence, written about the athlete in third person.",
  "If there is nothing new worth saving, return an empty list. Be very conservative — quality over quantity.",
  "Return ONLY by calling save_memory_notes.",
].join("\n");

const DISTILL_TOOL: Anthropic.Tool = {
  name: "save_memory_notes",
  description:
    "Save any new durable memory notes extracted from the conversation. Return an empty notes array if there is nothing new worth remembering.",
  input_schema: {
    type: "object",
    properties: {
      notes: {
        type: "array",
        description: "New durable facts about the athlete. May be empty.",
        items: {
          type: "object",
          properties: {
            category: {
              type: "string",
              description:
                "One short tag: preference | constraint | history | pattern | goal | style | other",
            },
            note: {
              type: "string",
              description: "One crisp sentence stating the durable fact.",
            },
          },
          required: ["note"],
        },
      },
    },
    required: ["notes"],
  },
};

function parseNotes(
  input: unknown,
  existingNotes: { note: string }[],
): DistilledNote[] {
  const raw = (input as { notes?: unknown })?.notes;
  if (!Array.isArray(raw)) return [];

  const seen = new Set(existingNotes.map((n) => n.note.trim().toLowerCase()));
  const out: DistilledNote[] = [];
  for (const item of raw) {
    const o = (item ?? {}) as Record<string, unknown>;
    const note = asString(o.note);
    if (!note) continue;
    const key = note.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ category: asString(o.category) || null, note });
  }
  return out;
}

export async function distillMemoryFromChat(
  existingNotes: { category: string | null; note: string }[],
  history: ChatTurn[],
): Promise<DistilledNote[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || history.length === 0) return [];

  const client = new Anthropic({ apiKey });

  const existingText =
    existingNotes.length > 0
      ? existingNotes
          .map((n) => `- ${n.category ? `[${n.category}] ` : ""}${n.note}`)
          .join("\n")
      : "(none yet)";
  const convoText = history
    .map((t) => `${t.role === "athlete" ? "Athlete" : "Coach"}: ${t.body}`)
    .join("\n");

  const userContent =
    "NOTES ALREADY ON FILE:\n" +
    existingText +
    "\n\nRECENT CONVERSATION:\n" +
    convoText +
    "\n\nExtract any new durable notes by calling save_memory_notes.";

  let input: unknown;
  try {
    const msg = await client.messages.create({
      model: process.env.MEMORY_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: DISTILL_SYSTEM_PROMPT,
      tools: [DISTILL_TOOL],
      tool_choice: { type: "tool", name: "save_memory_notes" },
      messages: [{ role: "user", content: userContent }],
    });
    const toolUse = msg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    input = toolUse?.input;
  } catch {
    return [];
  }

  return parseNotes(input, existingNotes);
}

export async function distillMemoryFromCheckin(
  existingNotes: { category: string | null; note: string }[],
  checkin: { open_comments?: string | null; pain_injury_note?: string | null },
): Promise<DistilledNote[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const open = checkin.open_comments?.trim() ?? "";
  const pain = checkin.pain_injury_note?.trim() ?? "";
  if (!apiKey || (!open && !pain)) return [];

  const client = new Anthropic({ apiKey });

  const existingText =
    existingNotes.length > 0
      ? existingNotes
          .map((n) => `- ${n.category ? `[${n.category}] ` : ""}${n.note}`)
          .join("\n")
      : "(none yet)";

  const checkinText = [
    pain ? `pain_injury_note: "${pain}"` : null,
    open ? `open_comments: "${open}"` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const userContent =
    "NOTES ALREADY ON FILE:\n" +
    existingText +
    "\n\nCHECK-IN FREE-TEXT FIELDS:\n" +
    checkinText +
    "\n\nExtract any new durable memory notes by calling save_memory_notes.";

  let input: unknown;
  try {
    const msg = await client.messages.create({
      model: process.env.MEMORY_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: CHECKIN_DISTILL_SYSTEM_PROMPT,
      tools: [DISTILL_TOOL],
      tool_choice: { type: "tool", name: "save_memory_notes" },
      messages: [{ role: "user", content: userContent }],
    });
    const toolUse = msg.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    input = toolUse?.input;
  } catch {
    return [];
  }

  return parseNotes(input, existingNotes);
}
