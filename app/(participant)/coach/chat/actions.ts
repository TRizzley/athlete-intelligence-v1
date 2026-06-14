"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateCoachChatReply } from "@/lib/coach-chat";
import { friendlyCoachError } from "@/lib/coach-errors";
import { distillMemoryFromChat } from "@/lib/coach-memory";
import { embedTexts } from "@/lib/embeddings";
import type { ChatTurn } from "@/lib/coach-types";
import { buildCoachContext } from "@/lib/context";
import { todayISO } from "@/lib/format";
import type { CoachMessage } from "@/lib/types";

export type FormState = { error: string | null; ok?: boolean };

export async function sendMessage(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired. Please sign in again." };

  const body = String(formData.get("body") ?? "").trim();
  const pdfFile = formData.get("pdf") as File | null;

  if (!body && !pdfFile) return { error: "Type a message or attach a file." };
  if (body.length > 4000) return { error: "That message is a bit long — try trimming it." };

  // Validate PDF if present.
  let pdfBase64: string | undefined;
  if (pdfFile) {
    if (pdfFile.size > 10 * 1024 * 1024) return { error: "PDF must be under 10 MB." };
    const buf = await pdfFile.arrayBuffer();
    pdfBase64 = Buffer.from(buf).toString("base64");
  }

  // Rate limit: one Claude call per user per 10 seconds. Only ATHLETE messages
  // count — those are what trigger Claude calls. (Coach rows are excluded so a
  // just-posted morning brief or workout review doesn't block the athlete's
  // first reply.) Not perfectly atomic, but covers the practical case of
  // repeated clicks or fast re-sends.
  const cooldownSince = new Date(Date.now() - 10_000).toISOString();
  const { data: recent } = await supabase
    .from("coach_messages")
    .select("id")
    .eq("user_id", user.id)
    .eq("role", "athlete")
    .gte("created_at", cooldownSince)
    .limit(1)
    .maybeSingle();
  if (recent) {
    return { error: "Give the coach a moment — try again in a few seconds." };
  }

  // The browser sends its LOCAL today so the coach's sense of "today" matches the
  // athlete's real day — this server action runs in UTC and would otherwise be off
  // by a day in the evening. Fall back to the server date if it's missing/invalid.
  const clientDateRaw = String(formData.get("client_date") ?? "");
  const localToday = /^\d{4}-\d{2}-\d{2}$/.test(clientDateRaw)
    ? clientDateRaw
    : todayISO();

  // 1. Save the athlete's message (RLS allows posting your own 'athlete' rows).
  const messageBody = body || (pdfFile ? `[Attached PDF: ${pdfFile.name}]` : "");
  const { error: insertErr } = await supabase.from("coach_messages").insert({
    user_id: user.id,
    role: "athlete",
    body: messageBody,
  });
  if (insertErr) return { error: `Could not send: ${insertErr.message}` };

  // 2. Gather context + conversation, then ask the coach for a reply (service
  //    role: writing a 'coach' row is not allowed under the athlete's RLS).
  const admin = createAdminClient();
  const userId = user.id;

  // Fetch conversation history and full context in parallel.
  const [messagesRes, ctx] = await Promise.all([
    admin
      .from("coach_messages")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30),
    buildCoachContext(userId, admin, localToday, {
      screenshotLimit: 8,
      responseLimit: 5,
      predictionLimit: 8,
      feedbackLimit: 8,
    }),
  ]);

  // Fetched newest-first for the limit; reverse to chronological for the model.
  const history: ChatTurn[] = ((messagesRes.data as CoachMessage[]) ?? [])
    .slice()
    .reverse()
    .map((m) => ({ role: m.role, body: m.body }));

  try {
    const reply = await generateCoachChatReply(ctx, history, pdfBase64);
    // Writing a 'coach' row requires the service-role client (RLS forbids the
    // athlete from inserting it). Check the result — if this insert fails (e.g.
    // SUPABASE_SERVICE_ROLE_KEY missing in the deploy), surface it instead of
    // silently dropping the reply.
    const { error: replyErr } = await admin.from("coach_messages").insert({
      user_id: userId,
      role: "coach",
      body: reply,
      ai_generated: true,
    });
    if (replyErr) {
      throw new Error(
        `couldn't save the reply (${replyErr.message}). This usually means the server's database key isn't configured.`,
      );
    }

    // Close the chat -> memory loop: distill any durable facts from this
    // exchange (including the reply just generated) and auto-apply them as
    // memory notes, so tomorrow's decision and future chats individualize.
    // Never let this block or break the chat reply.
    try {
      const newNotes = await distillMemoryFromChat(
        ctx.memoryNotes.map((n) => ({ category: n.category, note: n.note })),
        [...history, { role: "coach", body: reply }],
      );
      if (newNotes.length > 0) {
        const embeddings = await embedTexts(newNotes.map((n) => n.note));
        await admin.from("athlete_memory_notes").insert(
          newNotes.map((n, i) => ({
            user_id: userId,
            category: n.category,
            note: n.note,
            created_by: userId,
            ...(embeddings[i] ? { embedding: `[${embeddings[i]!.join(",")}]` } : {}),
          })),
        );
      }
    } catch {
      /* memory distillation is best-effort; ignore failures */
    }
  } catch (err) {
    const message = friendlyCoachError(err, "chat");
    // The athlete's message is already saved; surface a soft error so they can retry.
    revalidatePath("/coach/chat");
    return { error: `Sent — but ${message}` };
  }

  revalidatePath("/coach/chat");
  return { error: null, ok: true };
}
