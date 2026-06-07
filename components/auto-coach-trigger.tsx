"use client";

// Fires the fully-automatic coach response once, on mount. Safe to render on any
// page the athlete lands on after checking in / uploading: the API route is
// idempotent and only (re)generates when there's new data, so repeated pings are
// cheap. If a fresh decision gets sent, we refresh so it appears immediately.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function AutoCoachTrigger() {
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    (async () => {
      try {
        const res = await fetch("/api/coach/auto-respond", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
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
