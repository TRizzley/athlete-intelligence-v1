import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { serverToday } from "@/lib/server-date";
import { PageShell, BackLink } from "@/components/ui";
import { Chat } from "./chat";
import { UploadForm } from "@/app/(participant)/upload/upload-form";
import type { CoachMessage } from "@/lib/types";

export const metadata = { title: "Chat with your coach — The Coach" };

export default async function CoachChatPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from("coach_messages")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(200);

  const messages = (data as CoachMessage[]) ?? [];
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
          Send a Whoop, Oura, Garmin, Apple, or nutrition screen — your coach reads
          the numbers off it. You&apos;ll confirm what we read before it&apos;s used.
        </p>
        <UploadForm dateISO={today} />
      </details>

      <Chat messages={messages} />
    </PageShell>
  );
}
