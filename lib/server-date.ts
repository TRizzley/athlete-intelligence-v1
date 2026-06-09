// ----------------------------------------------------------------------------
// Server-side "today" that respects the athlete's timezone.
//
// The server runs in UTC, so a plain new Date() rolls over a day early/late for
// the athlete. The browser writes its IANA timezone into a `tz` cookie (see
// components/timezone-cookie.tsx); this reads it so server components render the
// athlete's real local date. Falls back to the UTC date when the cookie isn't
// set yet (first load) — the client then sets it and refreshes.
// ----------------------------------------------------------------------------

import { cookies } from "next/headers";
import { todayISO, todayInTz } from "./format";

export async function serverToday(): Promise<string> {
  try {
    const tz = (await cookies()).get("tz")?.value;
    if (tz) return todayInTz(tz);
  } catch {
    /* cookies() unavailable in this context — fall back below */
  }
  return todayISO();
}
