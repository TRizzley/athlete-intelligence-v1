"use client";

import { useEffect } from "react";

// Silently fires POST /api/whoop/sync on mount when the WHOOP token is valid.
// No UI — just a background sync so data is always fresh when the user opens
// the dashboard.
export function WhoopAutoSync() {
  useEffect(() => {
    fetch("/api/whoop/sync", { method: "POST" }).catch(() => {
      // Silently ignore — token may be expired, reconnect banner handles that.
    });
  }, []);

  return null;
}
