"use client";

import { useEffect, useState } from "react";
import { isNativeApp, registerForPush } from "@/lib/native";
import { savePushToken } from "@/app/(participant)/dashboard/push-actions";

type State = "idle" | "requesting" | "granted" | "denied" | "error";

export function PushOptIn({ hasPushToken }: { hasPushToken: boolean }) {
  const [native, setNative] = useState(false);
  const [state, setState] = useState<State>(hasPushToken ? "granted" : "idle");

  // Only evaluate at runtime — isNativeApp() reads window.Capacitor which
  // doesn't exist during SSR or in a regular browser.
  useEffect(() => {
    setNative(isNativeApp());
  }, []);

  // Don't render at all in a browser or if already registered.
  if (!native || state === "granted") return null;

  async function handleEnable() {
    setState("requesting");
    const token = await registerForPush();
    if (!token) {
      setState("denied");
      return;
    }
    const { error } = await savePushToken(token);
    setState(error ? "error" : "granted");
  }

  return (
    <div className="mb-5 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">
            Get check-in reminders
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {state === "denied"
              ? "Permission denied — enable notifications in iOS Settings → The Coach."
              : state === "error"
              ? "Something went wrong. Try again."
              : "A morning nudge when you haven't checked in yet."}
          </p>
        </div>
        {state === "idle" || state === "error" ? (
          <button
            onClick={handleEnable}
            className="btn-ghost shrink-0 text-sm"
          >
            Enable
          </button>
        ) : state === "requesting" ? (
          <span className="shrink-0 text-xs text-muted">Asking…</span>
        ) : null}
      </div>
    </div>
  );
}
