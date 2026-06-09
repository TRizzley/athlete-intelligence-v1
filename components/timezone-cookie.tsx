"use client";

// Writes the browser's IANA timezone (e.g. "America/New_York") into a `tz`
// cookie so server components can render the athlete's real local date instead
// of the server's UTC date. Mounted once in the participant layout. If the
// cookie was missing or stale, it refreshes so the server re-renders with the
// correct day.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function TimezoneCookie() {
  const router = useRouter();

  useEffect(() => {
    let tz = "";
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
      /* very old browser — leave the server on its UTC fallback */
    }
    if (!tz) return;

    const current = document.cookie
      .split("; ")
      .find((c) => c.startsWith("tz="))
      ?.slice(3);

    if (current === tz) return; // already set and current — nothing to do

    // IANA names use only cookie-safe characters (letters, digits, _ / + -).
    document.cookie = `tz=${tz}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [router]);

  return null;
}
