# Sprint Phase 1 — Codebase Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Sprint codebase to a verified clean baseline by fixing the defects found in the Phase 1 audit — no new features.

**Architecture:** Next.js 15 App Router app (`web/`) with a `lib/` domain layer, Supabase (project "The Operating System", `dodfgknznxripagqncpd`) for data/auth/storage, Anthropic + OpenAI + Nutritionix + WHOOP external APIs, Vercel hosting with Vercel Cron + a Supabase pg_cron tick. Fixes consolidate duplicated WHOOP sync logic, add bounded retry to raw fetch integrations, make background work survive serverless freeze, close a server-action authorization gap, and repair cron scheduling + lint tooling.

**Tech Stack:** TypeScript 5.6, Next.js 15.1, React 19, @supabase/ssr + supabase-js, @anthropic-ai/sdk, vitest 4.

## Global Constraints

- **Stabilization only — no new features, tables, or schema redesigns.** (from task spec)
- **All schema changes additive-only and require explicit user confirmation first.** No migration is included in this plan; none is needed.
- **Never connect to or modify anything belonging to Project Signal** (Supabase project `exkiaiycdgkabhpomija`), and do not touch the `signal_*` tables inside the Sprint DB.
- **Never delete database records.** Status/timestamp fields only. (Existing delete-based code paths are flagged, not changed, unless the user approves changing them.)
- **External API failure handling:** explicit retry, max 3 attempts, exponential backoff. A technical failure must never mark a record with a terminal or rejected-type status.
- Test runner: `npm test` (vitest run). Typecheck: `npx tsc --noEmit`. Both must pass after every task.
- All work happens in `C:\Users\tyler\Claude\The Operating System for Human Performance\sprint-v1-web\web` (paths below are relative to it).

## Baseline (recorded 2026-07-03, before any fix)

- `npm test`: **2 files, 30 tests, 30 passed, 0 failed, 0 skipped** (vitest 4.1.8, exit 0).
- `npx tsc --noEmit`: exit 0, no errors.
- `npm run lint`: **not runnable** — `eslint` is not a devDependency and no ESLint config exists (Task 7 fixes this).

---

### Task 1: Baseline production build check

No source changes. Confirms `next build` passes before fixes begin so any later build break is attributable to this plan's changes.

**Files:** none created/modified.

**Interfaces:** Produces: a recorded green `next build` baseline referenced by Task 10.

- [ ] **Step 1: Run the production build**

Run: `npm run build`
Expected: exit code 0, all routes compiled. If it fails, STOP and report the exact error to the user before continuing — the audit found no build breaks, so a failure here is new information.

- [ ] **Step 2: Run tests + typecheck (baseline re-confirmation)**

Run: `npm test && npx tsc --noEmit`
Expected: 30/30 pass, tsc exit 0.

- [ ] **Step 3: Commit nothing** — this task is verification only. Record the build result in the working notes for Task 10.

---

### Task 2: Consolidate WHOOP→check-in mapping and fix integer/check-constraint bugs

The identical ~60-line mapping block (recoveries + sleeps + cycles → `daily_checkins` upsert rows) is copy-pasted in three places: `app/api/cron/whoop-sync/route.ts:59-120`, `app/api/whoop/sync/route.ts:67-132`, `app/api/whoop/callback/route.ts:108-165`. All three have two data bugs:
1. `hrv_ms: Math.round(x * 10) / 10` writes a **fractional value into an integer column** (`daily_checkins.hrv_ms` is `int4`) — PostgREST rejects non-integral values for integer columns, so any WHOOP user with fractional HRV fails to sync that day.
2. `sleep_quality: Math.round(efficiency / 10)` can produce `0` (efficiency < 5%), violating the DB check `sleep_quality between 1 and 10` and failing the whole row upsert.

**Files:**
- Create: `lib/whoop-sync.ts`
- Test: `lib/__tests__/whoop-sync.test.ts`
- Modify: `app/api/cron/whoop-sync/route.ts`, `app/api/whoop/sync/route.ts`, `app/api/whoop/callback/route.ts`

**Interfaces:**
- Consumes: `WhoopRecovery`, `WhoopSleep`, `WhoopCycle` types from `lib/whoop.ts` (unchanged).
- Produces: `buildWhoopCheckinRows(userId: string, recoveries: WhoopRecovery[], sleeps: WhoopSleep[], cycles: WhoopCycle[]): Record<string, unknown>[]` and `upsertWhoopCheckins(admin: AdminClient, rows: Record<string, unknown>[]): Promise<{ synced: number; skipped: number }>` — used by all three routes.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/whoop-sync.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildWhoopCheckinRows } from "../whoop-sync";
import type { WhoopRecovery, WhoopSleep, WhoopCycle } from "../whoop";

const recovery = (over: Partial<WhoopRecovery["score"] & { created_at: string }> = {}): WhoopRecovery => ({
  cycle_id: 1, sleep_id: 1, user_id: 1,
  created_at: over.created_at ?? "2026-07-01T09:00:00Z",
  updated_at: "2026-07-01T09:00:00Z",
  score_state: "SCORED",
  score: {
    user_calibrating: false,
    recovery_score: 67.4,
    resting_heart_rate: 52.6,
    hrv_rmssd_milli: 65.34, // fractional — must round to integer 65
    spo2_percentage: 97.1,
    skin_temp_celsius: 33.2,
    ...over,
  },
});

const sleep = (efficiencyPct: number): WhoopSleep => ({
  id: 1, user_id: 1, created_at: "", updated_at: "",
  start: "2026-06-30T23:00:00Z", end: "2026-07-01T07:00:00Z",
  timezone_offset: "-04:00", nap: false, score_state: "SCORED",
  score: {
    stage_summary: {
      total_in_bed_time_milli: 8 * 3_600_000,
      total_awake_time_milli: 0, total_no_data_time_milli: 0,
      total_light_sleep_time_milli: 4 * 3_600_000,
      total_slow_wave_sleep_time_milli: 2 * 3_600_000,
      total_rem_sleep_time_milli: 1.5 * 3_600_000,
      sleep_cycle_count: 5, disturbance_count: 3,
    },
    sleep_needed: { baseline_milli: 0, need_from_sleep_debt_milli: 0, need_from_recent_strain_milli: 0, need_from_recent_nap_milli: 0 },
    respiratory_rate: 15.2,
    sleep_performance_percentage: 90,
    sleep_consistency_percentage: 80,
    sleep_efficiency_percentage: efficiencyPct,
  },
});

const cycle = (): WhoopCycle => ({
  id: 1, user_id: 1, created_at: "", updated_at: "",
  start: "2026-07-01T04:00:00Z", end: null, timezone_offset: "-04:00",
  score_state: "SCORED",
  score: { strain: 14.27, kilojoule: 0, average_heart_rate: 0, max_heart_rate: 0 },
});

describe("buildWhoopCheckinRows", () => {
  it("rounds hrv_ms and resting_hr to integers (int4 columns)", () => {
    const rows = buildWhoopCheckinRows("u1", [recovery()], [sleep(92)], [cycle()]);
    expect(rows).toHaveLength(1);
    expect(rows[0].hrv_ms).toBe(65);
    expect(Number.isInteger(rows[0].hrv_ms)).toBe(true);
    expect(rows[0].resting_hr).toBe(53);
  });

  it("clamps sleep_quality into [1,10] (DB check constraint)", () => {
    const low = buildWhoopCheckinRows("u1", [recovery()], [sleep(3)], []);
    expect(low[0].sleep_quality).toBe(1); // round(3/10)=0 would violate the check
    const high = buildWhoopCheckinRows("u1", [recovery()], [sleep(100)], []);
    expect(high[0].sleep_quality).toBe(10);
  });

  it("skips unscored recoveries and naps, maps strain by date", () => {
    const unscored: WhoopRecovery = { ...recovery(), score_state: "PENDING_SLEEP", score: null };
    const rows = buildWhoopCheckinRows("u1", [unscored, recovery()], [{ ...sleep(90), nap: true }], [cycle()]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sleep_hours).toBeUndefined(); // nap-only sleep list contributes nothing
    expect(rows[0].whoop_strain).toBe(14.3);
    expect(rows[0].checkin_date).toBe("2026-07-01");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/__tests__/whoop-sync.test.ts`
Expected: FAIL — `Cannot find module '../whoop-sync'`.

- [ ] **Step 3: Write the implementation**

Create `lib/whoop-sync.ts` (logic lifted verbatim from the three routes, with the two fixes marked):

```ts
// Shared WHOOP → daily_checkins mapping. Single source of truth for the three
// sync paths (cron sync, manual sync, post-OAuth backfill).

import type { createAdminClient } from "./supabase/admin";
import type { WhoopRecovery, WhoopSleep, WhoopCycle } from "./whoop";

type AdminClient = ReturnType<typeof createAdminClient>;

function msToHours(ms: number): number {
  return Math.round((ms / 3_600_000) * 10) / 10;
}

type SleepEntry = {
  hours: number; efficiency: number | null;
  light_hours: number | null; sws_hours: number | null; rem_hours: number | null;
  disturbances: number | null; respiratory_rate: number | null;
};

export function buildWhoopCheckinRows(
  userId: string,
  recoveries: WhoopRecovery[],
  sleeps: WhoopSleep[],
  cycles: WhoopCycle[],
): Record<string, unknown>[] {
  const sleepByDate = new Map<string, SleepEntry>();
  for (const sleep of sleeps) {
    if (sleep.nap || sleep.score_state !== "SCORED" || !sleep.score) continue;
    const date = sleep.end.slice(0, 10);
    const ss = sleep.score.stage_summary;
    const totalMs =
      ss.total_light_sleep_time_milli +
      ss.total_slow_wave_sleep_time_milli +
      ss.total_rem_sleep_time_milli;
    sleepByDate.set(date, {
      hours: msToHours(totalMs),
      efficiency: sleep.score.sleep_efficiency_percentage ?? null,
      light_hours: msToHours(ss.total_light_sleep_time_milli),
      sws_hours: msToHours(ss.total_slow_wave_sleep_time_milli),
      rem_hours: msToHours(ss.total_rem_sleep_time_milli),
      disturbances: ss.disturbance_count ?? null,
      respiratory_rate: sleep.score.respiratory_rate ?? null,
    });
  }

  const strainByDate = new Map<string, number>();
  for (const cycle of cycles) {
    if (cycle.score_state !== "SCORED" || !cycle.score) continue;
    strainByDate.set(cycle.start.slice(0, 10), Math.round(cycle.score.strain * 10) / 10);
  }

  const rows: Record<string, unknown>[] = [];
  for (const rec of recoveries) {
    if (rec.score_state !== "SCORED" || !rec.score) continue;
    const date = rec.created_at.slice(0, 10);
    const sleep = sleepByDate.get(date);

    const row: Record<string, unknown> = {
      user_id: userId,
      checkin_date: date,
      recovery_score: Math.round(rec.score.recovery_score),
      // hrv_ms is an int4 column — must be a whole number or the upsert fails.
      hrv_ms: Math.round(rec.score.hrv_rmssd_milli),
      resting_hr: Math.round(rec.score.resting_heart_rate),
      spo2_percentage: rec.score.spo2_percentage ?? null,
      skin_temp_celsius: rec.score.skin_temp_celsius ?? null,
      whoop_strain: strainByDate.get(date) ?? null,
    };

    if (sleep) {
      row.sleep_hours = sleep.hours;
      if (sleep.efficiency !== null) {
        // DB check: sleep_quality between 1 and 10 — clamp so efficiency < 5%
        // can't produce 0 and sink the whole row.
        row.sleep_quality = Math.min(10, Math.max(1, Math.round(sleep.efficiency / 10)));
      }
      row.sleep_light_hours = sleep.light_hours;
      row.sleep_sws_hours = sleep.sws_hours;
      row.sleep_rem_hours = sleep.rem_hours;
      row.sleep_disturbances = sleep.disturbances;
      row.respiratory_rate = sleep.respiratory_rate;
    }

    rows.push(row);
  }
  return rows;
}

export async function upsertWhoopCheckins(
  admin: AdminClient,
  rows: Record<string, unknown>[],
): Promise<{ synced: number; skipped: number }> {
  let synced = 0;
  let skipped = 0;
  for (const row of rows) {
    const { error } = await admin
      .from("daily_checkins")
      .upsert(row, { onConflict: "user_id,checkin_date", ignoreDuplicates: false });
    if (error) {
      console.error(`WHOOP upsert failed for ${row.checkin_date}:`, error);
      skipped++;
    } else {
      synced++;
    }
  }
  return { synced, skipped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/__tests__/whoop-sync.test.ts`
Expected: PASS (all 3 tests).

- [ ] **Step 5: Replace the duplicated block in all three routes**

In `app/api/cron/whoop-sync/route.ts`: delete the local `msToHours`, `SleepEntry`, sleep/strain map building, and the per-recovery upsert loop (lines ~30-33 and ~59-120). Replace the body of the per-token `try` with:

```ts
const accessToken = await getValidWhoopToken(tokenRow, admin);
const [recoveries, sleeps, cycles] = await Promise.all([
  fetchWhoopRecoveries(accessToken, start),
  fetchWhoopSleeps(accessToken, start),
  fetchWhoopCycles(accessToken, start),
]);
const rows = buildWhoopCheckinRows(tokenRow.user_id, recoveries, sleeps, cycles);
const { synced } = await upsertWhoopCheckins(admin, rows);
results.push({ user_id: tokenRow.user_id, synced });
```

Add `import { buildWhoopCheckinRows, upsertWhoopCheckins } from "@/lib/whoop-sync";`.

In `app/api/whoop/sync/route.ts`: same replacement (keep the route's own auth/token handling); its response keeps `synced` and `skipped` from `upsertWhoopCheckins`.

In `app/api/whoop/callback/route.ts`: replace the 30-day backfill mapping block (lines ~108-165) with `const rows = buildWhoopCheckinRows(user.id, recoveries, sleeps, cycles); await upsertWhoopCheckins(admin, rows);` inside the existing try/catch. Remove the now-unused local `msToHours`.

- [ ] **Step 6: Verify full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: 33/33 pass (30 baseline + 3 new), tsc exit 0.

- [ ] **Step 7: Commit**

```bash
git add lib/whoop-sync.ts lib/__tests__/whoop-sync.test.ts app/api/cron/whoop-sync/route.ts app/api/whoop/sync/route.ts app/api/whoop/callback/route.ts
git commit -m "fix: consolidate WHOOP sync mapping; integer hrv_ms; clamp sleep_quality"
```

---

### Task 3: Bounded retry for raw-fetch integrations + non-destructive WHOOP token refresh

Raw `fetch` calls to WHOOP and Nutritionix have zero retry. Worse, `getValidWhoopToken` (`lib/whoop.ts:172-211`) **deletes the athlete's `whoop_tokens` row on any refresh failure**, including a transient network error or WHOOP 5xx — a technical failure producing a terminal state, which violates the project constraint.

**Files:**
- Create: `lib/http-retry.ts`
- Test: `lib/__tests__/http-retry.test.ts`
- Modify: `lib/whoop.ts`, `lib/nutritionix.ts`

**Interfaces:**
- Produces: `fetchWithRetry(input: RequestInfo | URL, init?: RequestInit, opts?: { attempts?: number; baseDelayMs?: number }): Promise<Response>` and `class WhoopAuthError extends Error` (exported from `lib/whoop.ts`).

- [ ] **Step 1: Write the failing tests**

Create `lib/__tests__/http-retry.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { fetchWithRetry } from "../http-retry";

const res = (status: number) => ({ ok: status < 400, status }) as Response;

describe("fetchWithRetry", () => {
  it("returns the first successful response without retrying", async () => {
    const mock = vi.fn().mockResolvedValue(res(200));
    vi.stubGlobal("fetch", mock);
    const r = await fetchWithRetry("https://x.test", undefined, { baseDelayMs: 1 });
    expect(r.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("retries on 5xx/429 up to 3 attempts then returns the last response", async () => {
    const mock = vi.fn()
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(429))
      .mockResolvedValueOnce(res(503));
    vi.stubGlobal("fetch", mock);
    const r = await fetchWithRetry("https://x.test", undefined, { baseDelayMs: 1 });
    expect(r.status).toBe(503);
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on 4xx client errors", async () => {
    const mock = vi.fn().mockResolvedValue(res(401));
    vi.stubGlobal("fetch", mock);
    const r = await fetchWithRetry("https://x.test", undefined, { baseDelayMs: 1 });
    expect(r.status).toBe(401);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("retries thrown network errors and succeeds", async () => {
    const mock = vi.fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(res(200));
    vi.stubGlobal("fetch", mock);
    const r = await fetchWithRetry("https://x.test", undefined, { baseDelayMs: 1 });
    expect(r.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("throws the last network error after 3 attempts", async () => {
    const mock = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    vi.stubGlobal("fetch", mock);
    await expect(fetchWithRetry("https://x.test", undefined, { baseDelayMs: 1 })).rejects.toThrow("ECONNRESET");
    expect(mock).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/__tests__/http-retry.test.ts`
Expected: FAIL — `Cannot find module '../http-retry'`.

- [ ] **Step 3: Implement `lib/http-retry.ts`**

```ts
// Bounded retry for raw fetch calls to external APIs (WHOOP, Nutritionix).
// Policy per project constraints: max 3 attempts, exponential backoff.
// Retries transient failures only (network errors, 429, 5xx). 4xx client
// errors return immediately — retrying them can't succeed.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  opts: { attempts?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(input, init);
      const transient = res.status === 429 || res.status >= 500;
      if (!transient || attempt === attempts) return res;
    } catch (err) {
      lastError = err;
      if (attempt === attempts) throw err;
    }
    await sleep(baseDelayMs * 2 ** (attempt - 1)); // 500ms, 1s, (2s)
  }
  throw lastError; // unreachable, satisfies the type checker
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/__tests__/http-retry.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Adopt in `lib/whoop.ts` and make token refresh non-destructive**

In `lib/whoop.ts`:
1. `import { fetchWithRetry } from "./http-retry";` and replace all four `fetch(` calls (`refreshWhoopToken`, `whoopGet`, `exchangeWhoopCode`) with `fetchWithRetry(`.
2. Add the typed auth error and throw it only on definitive auth failures in `refreshWhoopToken`:

```ts
export class WhoopAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhoopAuthError";
  }
}
```

In `refreshWhoopToken`, replace the `if (!res.ok)` block with:

```ts
  if (!res.ok) {
    const body = await res.text();
    // 400/401/403 = the refresh token itself is dead (revoked/expired) —
    // the only case where reconnecting is genuinely required.
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new WhoopAuthError(`WHOOP token refresh rejected: ${res.status} ${body}`);
    }
    throw new Error(`WHOOP token refresh failed: ${res.status} ${body}`);
  }
```

3. In `getValidWhoopToken`'s `catch (refreshErr)` block, after the concurrent-refresh re-read, replace the unconditional delete with:

```ts
    if (refreshErr instanceof WhoopAuthError) {
      // Genuinely dead (revoked/expired). Delete the row so the user is
      // prompted to reconnect on the dashboard.
      await admin.from("whoop_tokens").delete().eq("id", tokenRow.id);
      throw new Error(`WHOOP token refresh failed; user must reconnect. Cause: ${refreshErr}`);
    }
    // Transient failure (network, WHOOP 5xx): keep the row so the next sync
    // retries. A technical failure must never be terminal.
    throw new Error(`WHOOP token refresh failed transiently; will retry next sync. Cause: ${refreshErr}`);
```

- [ ] **Step 6: Adopt in `lib/nutritionix.ts`**

`import { fetchWithRetry } from "./http-retry";` and replace all three `fetch(` calls with `fetchWithRetry(`. No other behavior changes — the existing `NutritionixError` handling already treats failures non-terminally.

- [ ] **Step 7: Verify full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass (38 total), tsc exit 0. Note: the existing `lib/__tests__/nutritionix.test.ts` stubs `fetch` globally — it must still pass since `fetchWithRetry` delegates to global `fetch`. If a stubbed test intentionally returns a 500 to assert an error (`"throws NutritionixError on API failure"`), it will now be retried 3 times against the same stub and still throw — assertion unchanged.

- [ ] **Step 8: Commit**

```bash
git add lib/http-retry.ts lib/__tests__/http-retry.test.ts lib/whoop.ts lib/nutritionix.ts
git commit -m "fix: bounded retry for WHOOP/Nutritionix; keep whoop token on transient refresh failure"
```

---

### Task 4: Make fire-and-forget background work survive serverless response freeze

`app/(participant)/upload/actions.ts` fires `void runOcr(...)` and `app/(participant)/checkin/actions.ts` fires `void (async () => …)()` and then returns/redirects. On Vercel, the function can be frozen as soon as the response is sent, killing the in-flight OCR / memory-distillation work — screenshots stuck at `parse_status='pending'/'processing'`, silently lost memory notes. Next 15.1 ships `after()` (stable) exactly for this: callbacks passed to `after` run after the response, and the platform keeps the function alive until they finish.

**Files:**
- Modify: `app/(participant)/upload/actions.ts`, `app/(participant)/checkin/actions.ts`

**Interfaces:**
- Consumes: `after` from `next/server` (Next 15.1+ — the repo is on `next@^15.1.6`).
- Produces: no signature changes; `runOcr` and the distillation block run inside `after()`.

- [ ] **Step 1: Update `upload/actions.ts`**

Add `import { after } from "next/server";` at the top. In `uploadScreenshot`, replace:

```ts
    void runOcr(supabase, {
      screenshotId: inserted.id as string,
      source: source as ScreenshotSource,
      note,
      bytes,
      mimeType: file.type,
    });
```

with:

```ts
    after(() =>
      runOcr(supabase, {
        screenshotId: inserted.id as string,
        source: source as ScreenshotSource,
        note,
        bytes,
        mimeType: file.type,
      }),
    );
```

In `retryOcr`, apply the same change to its `void runOcr(...)` call.

- [ ] **Step 2: Update `checkin/actions.ts`**

Add `import { after } from "next/server";`. Replace the `void (async () => { ... })();` wrapper around the distillation block with:

```ts
    after(async () => {
      try {
        const { data: notesData } = await admin
          .from("athlete_memory_notes")
          .select("category, note")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });
        const existing = (notesData as Pick<AthleteMemoryNote, "category" | "note">[] | null) ?? [];
        const newNotes = await distillMemoryFromCheckin(existing, {
          open_comments: openComments,
          pain_injury_note: painNote,
        });
        if (newNotes.length > 0) {
          const embeddings = await embedTexts(newNotes.map((n) => n.note));
          await admin.from("athlete_memory_notes").insert(
            newNotes.map((n, i) => ({
              user_id: user.id,
              category: n.category ?? "constraint",
              note: n.note,
              created_by: user.id,
              ...(embeddings[i] ? { embedding: `[${embeddings[i]!.join(",")}]` } : {}),
            })),
          );
          console.log(`[checkin] distilled ${newNotes.length} memory note(s) for user=${user.id}`);
        }
      } catch {
        // Never surface distillation errors to the athlete
      }
    });
```

(The body is identical to the current IIFE — only the scheduling wrapper changes.)

- [ ] **Step 3: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: pass. Also run `npm run build` — `after` must not error at build time.

- [ ] **Step 4: Commit**

```bash
git add "app/(participant)/upload/actions.ts" "app/(participant)/checkin/actions.ts"
git commit -m "fix: run OCR and memory distillation via next/server after() so serverless freeze can't kill them"
```

---

### Task 5: Close the `syncNutritionToCheckin` server-action authorization gap

`app/(participant)/nutrition/actions.ts` has `"use server"` at module scope, so **every export is a public POST endpoint**. `syncNutritionToCheckin(userId, logDate)` takes an arbitrary `userId`, performs no caller check, and writes with the service-role client — any signed-in user can invoke it against any other user's check-ins. Fix: move it to a plain lib module (not a server action) and keep the call sites.

**Files:**
- Create: `lib/nutrition-sync.ts`
- Modify: `app/(participant)/nutrition/actions.ts`

**Interfaces:**
- Produces: `syncNutritionToCheckin(userId: string, logDate: string): Promise<void>` exported from `lib/nutrition-sync.ts` (same signature; no longer a server action).

- [ ] **Step 1: Create `lib/nutrition-sync.ts`**

Move the entire `syncNutritionToCheckin` function body (including its doc comment) from `nutrition/actions.ts` verbatim into the new file, with imports:

```ts
// Aggregates nutrition_logs for a date and upserts macro totals into
// daily_checkins. Server-side helper — intentionally NOT a "use server"
// action: it takes a raw userId and writes with the service-role client, so
// it must only be reachable from server code that has already resolved the
// authenticated user.

import { createAdminClient } from "./supabase/admin";

export async function syncNutritionToCheckin(userId: string, logDate: string): Promise<void> {
  const admin = createAdminClient();

  // Use the DB helper function for clean aggregation
  const { data, error } = await admin.rpc("get_daily_nutrition_totals", {
    p_user_id: userId,
    p_date: logDate,
  });

  if (error || !data || !data.length) return;

  const totals = data[0] as {
    total_calories: number;
    total_protein_g: number;
    total_carbs_g: number;
    total_fat_g: number;
    meal_count: number;
  };

  // Upsert into daily_checkins — only update the nutrition columns.
  // All other fields (sleep, HRV, workout, etc.) are left untouched.
  await admin.from("daily_checkins").upsert(
    {
      user_id: userId,
      checkin_date: logDate,
      calories: Math.round(totals.total_calories),
      protein_g: Math.round(totals.total_protein_g),
      carbs_g: Math.round(totals.total_carbs_g),
      fat_g: Math.round(totals.total_fat_g),
    },
    {
      onConflict: "user_id,checkin_date",
      ignoreDuplicates: false, // we want to update, not skip
    },
  );
}
```

- [ ] **Step 2: Update `nutrition/actions.ts`**

Delete the `syncNutritionToCheckin` export from the actions file, remove the now-unused `createAdminClient` import, and add `import { syncNutritionToCheckin } from "@/lib/nutrition-sync";`. The two internal call sites (`logFoodAction`, `deleteFoodLogAction`) keep working unchanged — both already pass `user.id` from the authenticated session.

- [ ] **Step 3: Confirm no other callers**

Run: `grep -rn "syncNutritionToCheckin" app lib components`
Expected: exactly the two call sites in `nutrition/actions.ts` plus the definition in `lib/nutrition-sync.ts`.

- [ ] **Step 4: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add lib/nutrition-sync.ts "app/(participant)/nutrition/actions.ts"
git commit -m "fix: remove public server-action exposure of syncNutritionToCheckin (arbitrary-userId write)"
```

---

### Task 6: Fix morning-reminder scheduling (winter DST gap) and failed-send marking

Two defects in the reminder pipeline:
1. `vercel.json` schedules `/api/cron/reminders` once daily at `0 13 * * *` UTC, but the route only sends when the hour in `REMINDER_TIMEZONE` equals `REMINDER_MORNING_HOUR` (default 9). 13:00 UTC is 9am EDT but **8am EST — from November to March the Vercel tick does nothing**. (Production currently survives on the redundant Supabase pg_cron 15-minute tick; the route comment even says "hourly Vercel Cron tick".) Fix: make the Vercel cron hourly, matching the route's design.
2. `app/api/cron/reminders/route.ts:125-129` marks `morning_reminder_date` even when the push send **failed** — a transient APNs error permanently suppresses that day's reminder. Fix: mark only on success or a permanently-dead token.

**Files:**
- Modify: `vercel.json`, `app/api/cron/reminders/route.ts`

**Interfaces:** none new.

- [ ] **Step 1: Make the Vercel reminders cron hourly**

In `vercel.json`, change the reminders entry:

```json
    {
      "path": "/api/cron/reminders",
      "schedule": "0 * * * *"
    }
```

(The route is idempotent per day and exits instantly outside the reminder hour, so hourly is cheap.)

- [ ] **Step 2: Only mark reminded on success or dead token**

In `app/api/cron/reminders/route.ts`, replace the send loop body's tail:

```ts
    let markReminded = false;
    if ("ok" in r && r.ok) {
      sent += 1;
      markReminded = true;
    } else if ("ok" in r && !r.ok) {
      errors.push(`${r.status ?? ""} ${r.reason ?? ""}`.trim());
      // Clear a dead token so we stop trying it (the app re-registers on next open).
      if (r.status === 410 || r.reason === "Unregistered" || r.reason === "BadDeviceToken") {
        await admin.from("users").update({ push_token: null }).eq("id", id);
        markReminded = true; // pointless to retry today with no token
      }
      // Transient failure: leave morning_reminder_date unset so the next tick retries.
    }

    if (markReminded) {
      await admin
        .from("athlete_profiles")
        .update({ morning_reminder_date: localDate })
        .eq("user_id", id);
    }
```

(This replaces the unconditional `update({ morning_reminder_date: localDate })` at the end of the loop.)

- [ ] **Step 3: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add vercel.json app/api/cron/reminders/route.ts
git commit -m "fix: hourly reminders cron (EST/EDT gap); don't mark reminded on transient push failure"
```

---

### Task 7: Restore the lint toolchain

`package.json` defines `"lint": "next lint"` but `eslint` and `eslint-config-next` are not installed and no config exists — the script prompts interactively / fails, so lint has never run in this repo.

**Files:**
- Create: `.eslintrc.json`
- Modify: `package.json` (devDependencies), `package-lock.json` (via npm)

**Interfaces:** none.

- [ ] **Step 1: Install ESLint matching Next 15**

Run: `npm install --save-dev eslint@^9 eslint-config-next@15.1.6`
Expected: exit 0, lockfile updated.

- [ ] **Step 2: Add config**

Create `.eslintrc.json`:

```json
{
  "extends": "next/core-web-vitals"
}
```

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: completes non-interactively. If it reports errors: fix only mechanical, zero-behavior-change items (unused imports, `let`→`const`); anything judgement-call gets recorded in the Task 10 baseline report as deferred, NOT fixed (stabilization scope).

- [ ] **Step 4: Verify**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .eslintrc.json
git commit -m "chore: install eslint + next config so npm run lint actually runs"
```

---

### Task 8: Bring `.env.example` in line with the variables the code actually reads

`.env.example` lists 7 variables; the code reads 19+. Missing from the example: `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, `REMINDER_TIMEZONE`, `REMINDER_MORNING_HOUR`, `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_PRODUCTION`, and the optional model overrides `COACH_MODEL`, `OCR_MODEL`, `MEMORY_MODEL`.

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Rewrite `.env.example`**

```bash
# ── Supabase (project: "The Operating System") ────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# ── AI ─────────────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=
OPENAI_API_KEY=            # embeddings for memory-note RAG (optional; falls back to loading all notes)
# COACH_MODEL=             # default: claude-sonnet-4-6
# OCR_MODEL=               # default: claude-haiku-4-5-20251001
# MEMORY_MODEL=            # default: claude-haiku-4-5-20251001

# ── Nutrition (Nutritionix Track API) ─────────────────────────────────────────
NUTRITIONIX_APP_ID=
NUTRITIONIX_APP_KEY=

# ── WHOOP OAuth ────────────────────────────────────────────────────────────────
WHOOP_CLIENT_ID=
WHOOP_CLIENT_SECRET=

# ── App / cron ─────────────────────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL=       # e.g. https://athlete-intelligence-v1.vercel.app
CRON_SECRET=               # must match the Bearer token in the Supabase pg_cron job AND Vercel cron env
REMINDER_TIMEZONE=America/New_York
# REMINDER_MORNING_HOUR=9

# ── APNs push (env-gated: leave empty to disable push) ────────────────────────
APNS_KEY_P8=
APNS_KEY_ID=
APNS_TEAM_ID=
APNS_BUNDLE_ID=
APNS_PRODUCTION=false
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: document every env var the app actually reads"
```

---

### Task 9: Mark stale docs (SMS) and dead references

`SMS_SETUP.md` documents a Twilio SMS flow that no longer exists (replaced by APNs push — `app/api/cron/reminders/route.ts` header says so). `app/privacy/page.tsx` tells users Strava data is collected, but there is no Strava integration in the code (schema-only). Docs-only task; no behavior changes.

**Files:**
- Modify: `SMS_SETUP.md`, `app/privacy/page.tsx`

- [ ] **Step 1: Deprecation banner on SMS_SETUP.md**

Insert at the very top of `SMS_SETUP.md`:

```markdown
> **DEPRECATED (2026-07):** SMS reminders were never shipped and the Twilio
> integration described below does not exist in the codebase. Reminders are
> delivered via APNs push — see `app/api/cron/reminders/route.ts` and
> `lib/push.ts`. Kept for historical reference only.
```

- [ ] **Step 2: Remove the Strava claims from the privacy page**

In `app/privacy/page.tsx` line 36, delete the `<li>Strava: workout activities, distance, pace, and heart rate</li>` bullet. In line 66, change `(e.g. WHOOP, Strava)` to `(e.g. WHOOP)`. (The Strava DB tables stay — additive-only rule — but the privacy page must not claim collection that can't happen.)

- [ ] **Step 3: Verify + commit**

Run: `npm test && npx tsc --noEmit`
Expected: pass.

```bash
git add SMS_SETUP.md app/privacy/page.tsx
git commit -m "docs: deprecate SMS setup doc; remove unshipped Strava claims from privacy page"
```

---

### Task 10: Final verification + Phase 1 baseline document

**Files:**
- Create: `docs/PHASE1_BASELINE.md`

- [ ] **Step 1: Full verification**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: every command exits 0. Record exact test counts.

- [ ] **Step 2: Write `docs/PHASE1_BASELINE.md`**

Contents: (a) final test count / pass rate, lint + build status; (b) what was fixed, grouped by audit category, one line each with commit hash; (c) intentionally deferred items — copy the "Flagged, not fixed" list from the audit report (signal tables, delete-replacement semantics, APNs/Nutritionix credentials, Strava dormancy, Supabase advisor hygiene, coach-model upgrade, repo-SQL drift) with a one-line reason each; (d) "future pass" list. This document is the measuring stick for Phase 2.

- [ ] **Step 3: Commit**

```bash
git add docs/PHASE1_BASELINE.md
git commit -m "docs: Phase 1 stabilization baseline"
```

---

## Flagged, NOT fixed in this plan (user decisions required)

These were found by the audit but are intentionally excluded from the tasks above — approve separately if you want them addressed:

1. **`signal_*` tables live inside Sprint's DB** (`signal_deduplication`, `signal_job_run_log`, `signal_collected_content` + 4 enum types; all 0 rows). Scope says Signal is a separate project. Options: leave (harmless, RLS'd), or drop in a Phase 2 migration you confirm. Note: `signal_content_authenticated_read` lets any signed-in Sprint athlete read that table.
2. **Delete-based "replace" semantics** in `app/api/coach/auto-respond/route.ts:304-314` (deletes prior same-day AI responses + predictions) and `app/api/admin/generate-coach-response/route.ts:111-117` (deletes prior AI drafts) conflict with the no-record-deletion constraint. Changing to status-supersede needs a schema/status decision.
3. **Credentials you must supply** (code is ready, env-gated): `NUTRITIONIX_APP_ID`/`NUTRITIONIX_APP_KEY` (nutrition logging currently errors), `APNS_KEY_ID`/`APNS_KEY_P8` (push reminders currently no-op).
4. **Strava** is schema-only (tables + column + unique index, no code). Leave dormant or build in a feature pass.
5. **Supabase advisor hygiene** (warnings, all pre-existing): leaked-password protection disabled in Auth; `pg_net` and `vector` extensions in the `public` schema; `is_admin()` SECURITY DEFINER callable by `authenticated` (by design — returns only a boolean).
6. **Repo SQL drift**: `supabase/schema.sql` + 17 patch files + `lib/supabase/migrations/20260613_nutrition_logs.sql` are historical and don't match the 37 live migrations. Recommend declaring the live DB authoritative and regenerating a reference snapshot in a future pass.
7. **Model note**: `COACH_MODEL` default `claude-sonnet-4-6` is valid and active (previous-gen Sonnet; current is `claude-sonnet-5`). No change needed for stabilization; revisit in Phase 2.
8. **pg_cron job fragility**: the Supabase `reminders-tick` job hardcodes the production URL + bearer secret; if `CRON_SECRET` rotates or the domain changes it silently 401s. Document in runbook when rotating secrets.
