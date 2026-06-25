import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { serverToday } from "@/lib/server-date";
import { PageShell, BackLink } from "@/components/ui";
import { Chat } from "./chat";
import { UploadForm } from "@/app/(participant)/upload/upload-form";
import type { CoachMessage } from "@/lib/types";

export const metadata = { title: "Chat with your coach — The Coach" };

export default async function CoachChatPage({
  searchParams,
}: {
  searchParams: Promise<{ expect?: string }>;
}) {
  const { expect } = await searchParams;
  const user = await requireUser();
  const supabase = await createClient();

  // Fetch the most RECENT 200 messages, then restore chronological order for
  // display. Ordering ascending with a limit returns the OLDEST 200, so once a
  // conversation passes 200 messages every new reply falls outside the window
  // and never renders (the chat appears frozen with no error). Descending +
  // reverse keeps the latest exchange always visible.
  const { data } = await supabase
    .from("coach_messages")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);

  const messages = ((data as CoachMessage[]) ?? []).slice().reverse();

  // Which feedback_prompt cards have already been answered, so the chat renders
  // them as "logged" instead of re-asking. Pull the response_ids the prompts
  // reference, then look up which already have feedback.
  const promptResponseIds = messages
    .filter((m) => m.kind === "feedback_prompt")
    .map((m) => m.body.match(/<feedback_prompt>([\s\S]*?)<\/feedback_prompt>/)?.[1])
    .map((raw) => {
      if (!raw) return null;
      try {
        return (JSON.parse(raw.trim()) as { response_id?: string }).response_id ?? null;
      } catch {
        return null;
      }
    })
    .filter((v): v is string => !!v);

  let answeredResponseIds: string[] = [];
  if (promptResponseIds.length > 0) {
    const { data: fbRows } = await supabase
      .from("user_feedback")
      .select("coach_response_id")
      .in("coach_response_id", promptResponseIds);
    answeredResponseIds = ((fbRows as { coach_response_id: string }[]) ?? []).map(
      (r) => r.coach_response_id,
    );
  }

  const today = await serverToday();

  return (
    <PageShell width="content">
      <BackLink href="/coach">Back to your coach</BackLink>
      <div className="mb-5">
        <div className="eyebrow mb-1.5">Chat</div>
        <h1 className="text-2xl font-semibold tracking-tight">Talk to your coach</h1>
        <p className="mt-1.5 text-sm text-muted">
          Ask anything, any time. Your coach replies with your full history in mind.
        </p>
      </div>

      <details className="mb-5 rounded-2xl border border-border bg-surface/40 p-4">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          Share a screenshot with your coach
        </summary>
        <p className="mb-3 mt-1 text-xs text-muted">
          Send a Whoop, Oura, Garmin, Apple, or nu