"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateCoachChatReply,
  distillMemoryFromChat,
  type CoachContext,
  type ChatTurn,
} from "@/lib/coach-ai";
import { todayISO } from "@/lib/format";
import type {
  AthleteProfile,
  DailyCheckin,
  UploadedScreenshot,
  CoachResponse,
  PredictionWithOutcome,
  UserFeedback,
  AthleteMemoryNote,
  CoachMessage,
} from "@/lib/types";

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
  if (!body) return { error: "Type a message first." };
  if (body.length > 4000) return { error: "That message is a bit long — try trimming it." };

  // 1. Save the athlete's message (RLS allows posting your own 'athlete' rows).
  const { error: insertErr } = await supabase.from("coach_messages").insert({
    user_id: user.id,
    role: "athlete",
    body,
  });
  if (insertErr) return { error: `Could not send: ${insertErr.message}` };

  // 2. Gather context + conversation, then ask the coach for a reply (service
  //    role: writing a 'coach' row is not allowed under the athlete's RLS).
  const admin = createAdminClient();
  const userId = user.id;

  const [
    userRes,
    profileRes,
    checkinsRes,
    shotsRes,
    responsesRes,
    predictionsRes,
    feedbackRes,
    memoryRes,
    messagesRes,
  ] = await Promise.all([
    admin.from("users").select("full_name, email").eq("id", userId).maybeSingle(),
    admin.from("athlete_profiles").select("*").eq("user_id", userId).maybeSingle(),
    admin
      .from("daily_checkins")
      .select("*")
      .eq("user_id", userId)
      .order("checkin_date", { ascending: false })
      .limit(8),
    admin
      .from("uploaded_screenshots")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(8),
    admin
      .from("coach_responses")
      .select("*")
      .eq("user_id", userId)
      .order("response_date", { ascending: false })
      .limit(5),
    admin
      .from("predictions")
      .select("*, prediction_outcomes(*)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(8),
    admin
      .from("user_feedback")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(8),
    admin
      .from("athlete_memory_notes")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    admin
      .from("coach_messages")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const userRec = userRes.data as { full_name: string | null; email: string | null } | null;
  const profile = (profileRes.data as AthleteProfile) ?? null;
  const checkins = (checkinsRes.data as DailyCheckin[]) ?? [];

  // Recent logged workouts for progression context.
  const { data: sessionRows } = await admin
    .from("workout_sessions")
    .select("id, session_date, day_name, notes")
    .eq("user_id", userId)
    .order("session_date", { ascending: false })
    .limit(5);
  const sessions =
    (sessionRows as {
      id: string;
      session_date: string;
      day_name: string | null;
      notes: string | null;
    }[]) ?? [];

  let recentWorkouts: CoachContext["recentWorkouts"] = [];
  if (sessions.length > 0) {
    const { data: setRows } = await admin
      .from("workout_set_logs")
      .select("session_id, exercise_name, muscle_group, set_number, weight, reps")
      .in(
        "session_id",
        sessions.map((s) => s.id),
      )
      .order("position", { ascending: true });
    const bySession = new Map<string, typeof setRows>();
    (setRows ?? []).forEach((r) => {
      const sid = (r as { session_id: string }).session_id;
      const arr = bySession.get(sid) ?? [];
      arr.push(r);
      bySession.set(sid, arr);
    });
    recentWorkouts = sessions.map((s) => ({
      session_date: s.session_date,
      day_name: s.day_name,
      notes: s.notes,
      sets: (bySession.get(s.id) ?? []).map((r) => {
        const row = r as {
          exercise_name: string;
          muscle_group: string | null;
          set_number: number;
          weight: number | null;
          reps: number | null;
        };
        return {
          exercise: row.exercise_name,
          muscle: row.muscle_group,
          set: row.set_number,
          weight: row.weight,
          reps: row.reps,
        };
      }),
    }));
  }

  const ctx: CoachContext = {
    athleteName: userRec?.full_name || profile?.full_name || userRec?.email || null,
    today: todayISO(),
    profile,
    latestCheckin: checkins[0] ?? null,
    recentCheckins: checkins,
    screenshots: (shotsRes.data as UploadedScreenshot[]) ?? [],
    memoryNotes: (memoryRes.data as AthleteMemoryNote[]) ?? [],
    previousResponses: (responsesRes.data as CoachResponse[]) ?? [],
    predictions: (predictionsRes.data as PredictionWithOutcome[]) ?? [],
    feedback: (feedbackRes.data as UserFeedback[]) ?? [],
    recentWorkouts,
  };

  // Fetched newest-first for the limit; reverse to chronological for the model.
  const history: ChatTurn[] = ((messagesRes.data as CoachMessage[]) ?? [])
    .slice()
    .reverse()
    .map((m) => ({ role: m.role, body: m.body }));

  const existingNotes = (memoryRes.data as AthleteMemoryNote[]) ?? [];

  try {
    const reply = await generateCoachChatReply(ctx, history);
    await admin.from("coach_messages").insert({
      user_id: userId,
      role: "coach",
      body: reply,
      ai_generated: true,
    });

    // Close the chat -> memory loop: distill any durable facts from this
    // exchange (including the reply just generated) and auto-apply them as
    // memory notes, so tomorrow's decision and future chats individualize.
    // Never let this block or break the chat reply.
    try {
      const newNotes = await distillMemoryFromChat(
        existingNotes.map((n) => ({ category: n.category, note: n.note })),
        [...history, { role: "coach", body: reply }],
      );
      if (newNotes.length > 0) {
        await admin.from("athlete_memory_notes").insert(
          newNotes.map((n) => ({
            user_id: userId,
            category: n.category,
            note: n.note,
            created_by: userId,
          })),
        );
      }
    } catch {
      /* memory distillation is best-effort; ignore failures */
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "The coach couldn't reply just now.";
    // The athlete's message is already saved; surface a soft error so they can retry.
    revalidatePath("/coach/chat");
    return { error: `Sent — but the coach hit an error replying: ${message}` };
  }

  revalidatePath("/coach/chat");
  return { error: null, ok: true };
}
