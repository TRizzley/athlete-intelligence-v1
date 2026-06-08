import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageShell, BackLink } from "@/components/ui";
import { Chat } from "./chat";
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

      <Chat messages={messages} />
    </PageShell>
  );
}
