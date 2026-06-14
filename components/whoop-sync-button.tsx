"use client";

import { useState } from "react";

export function WhoopSyncButton() {
  const [state, setState] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [result, setResult] = useState<{ synced?: number } | null>(null);

  async function handleSync() {
    setState("syncing");
    try {
      const res = await fetch("/api/whoop/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setResult(data);
        setState("done");
        setTimeout(() => setState("idle"), 4000);
      } else {
        setState("error");
        setTimeout(() => setState("idle"), 4000);
      }
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 4000);
    }
  }

  return (
    <button
      onClick={handleSync}
      disabled={state === "syncing"}
      className="btn-ghost text-sm"
    >
      {state === "syncing" && "Syncing WHOOP…"}
      {state === "done" && `✓ Synced ${result?.synced ?? 0} days`}
      {state === "error" && "Sync failed"}
      {state === "idle" && "Sync WHOOP"}
    </button>
  );
}
