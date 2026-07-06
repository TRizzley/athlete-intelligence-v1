"use client";

// Fires the short post-workout coach acknowledgment once, on mount. Mounted on
// the dashboard as a safety net — the workout save flow (saveSession) hands off
// to the coach chat, which normally triggers the review. The API route is
// idempotent and only sends once per logged session, so repeated pings are cheap
// — it no-ops on days with no logged workout or one already acknowledged.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { todayISO } from "@/lib/format";

export function PostWorkoutAckTrigger() {
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    (async () => {
      try {
        const res = await fetch("/api/coach/post-workout-ack", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // Send the browser's LOCAL today so it matches the post-workout
          // check-in's date even if the server's UTC day differs.
          body: JSON.stringify({ date: todayISO() }),
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; sent?: boolean }
          | null;
        if (data?.ok && data?.sent) router.refresh();
      } catch {
        // Best-effort: never disrupt the page if this fails.
      }
    })();
  }, [router]);

  return null;
}
