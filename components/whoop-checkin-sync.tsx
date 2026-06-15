"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Fires POST /api/whoop/sync on mount (with the user's session cookie),
// then refreshes the server component so biometric fields pre-fill.
// Rendered only when WHOOP is connected but today's recovery data is missing.
export function WhoopCheckinSync() {
  const router = useRouter();

  useEffect(() => {
    fetch("/api/whoop/sync", { method: "POST" })
      .then((res) => res.json())
      .then((data: { synced?: number }) => {
        // Only reload if we actually got new data — avoids infinite reload
        // when WHOOP hasn't processed today's recovery yet.
        if (data.synced && data.synced > 0) window.location.reload();
      })
      .catch(() => {/* non-fatal */});
  }, [router]);

  return null;
}
