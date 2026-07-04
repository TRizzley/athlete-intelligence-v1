# Sprint — Phase 1 Baseline

**Date:** 2026-07-04
**Purpose:** Post-stabilization baseline for comparison at the start of Phase 2.
Commits `4c77610` → `3809a8c` (Tasks 1–4) plus the final docs/env task.

## Verification results (all run on this baseline)

| Check | Command | Result |
|---|---|---|
| Unit tests | `npm test` (vitest 4.1.8) | ✅ 2 files, **45/45 passed** |
| Types | `npx tsc --noEmit` | ✅ exit 0 |
| Lint | `npm run lint` (eslint 9, next/core-web-vitals) | ✅ No warnings or errors |
| Build | `npm run build` (Next.js 15.1) | ✅ exit 0, 26 routes |

Test coverage: `lib/__tests__/coach-ai.test.ts` (context building, calibration)
and `lib/whoop/__tests__/sync-service.test.ts` (25 tests: transform fixes,
backoff, error classification, retry, upsert flow).

## What Phase 1 changed

### Task 1 — Cleanup (`4c77610`)
- **Strava removed entirely.** No code ever existed; deleted the schema
  remnants (`strava_tokens` table, `workout_sessions.strava_activity_id`
  column — both empty, guarded migrations `remove_strava`) and the privacy
  page claims.
- **Nutritionix removed entirely.** Deleted `lib/nutritionix.ts`, the
  `/nutrition` feature (page/actions/logger/components), its tests, the
  dashboard snapshot, nav link, coach-context nutrition-log feed, and the
  `nutrition_logs` table + `get_daily_nutrition_totals` function (empty,
  guarded migration `remove_nutritionix`). **Kept:** `daily_checkins` macro
  columns (real data, still fed by manual entry + screenshot OCR) and the
  `athlete_profiles.nutrition_app` field.
- **APNS reminders gated off:** `/api/cron/reminders` returns
  `"APNS reminders disabled"` unless `APNS_ENABLED=true`. Infrastructure
  (`lib/push.ts`, cron wiring) intact.

### Task 2 — WHOOP sync consolidation (`b937971`)
- `lib/whoop.ts` → `lib/whoop/client.ts`; new `lib/whoop/sync-service.ts` +
  `lib/whoop/index.ts`. The ~75-line transform block duplicated across the
  cron route, manual sync route, and OAuth callback now exists once.
- **Bug fix:** `hrv_ms` written as a 1-decimal float into an int4 column
  (failed the whole row) → now `Math.round()` integer.
- **Bug fix:** `sleep_quality` could round to 0 against its 1–10 check
  constraint → now clamped to [1, 10].
- **Retry:** transient WHOOP failures (429/5xx/network) retried max 3
  attempts, exponential backoff 1s→30s ±1s jitter; 401/403/validation fail
  immediately. `WhoopApiError` carries the HTTP status.
- **Non-destructive token refresh:** `whoop_tokens` rows are never deleted on
  refresh failure; the sync cycle is skipped and retried later. (Previously a
  network blip forced the athlete to reconnect.)

### Task 3 — Background work durability (`74a3fd3`)
- Screenshot OCR (`uploadScreenshot`, `retryOcr`) and check-in memory
  distillation now run via `after()` from `next/server` instead of
  fire-and-forget promises that Vercel could kill at response freeze
  (the cause of rows stuck in `parse_status='processing'`).

### Task 4 — Reminders + ESLint (`3809a8c`)
- Reminders Vercel cron `0 13 * * *` → `0 * * * *` (the daily 13:00 UTC tick
  missed the 9am local gate during winter time).
- `morning_reminder_date` set only on successful send or dead token —
  transient APNs failures no longer mark the athlete as reminded.
- ESLint restored (`eslint@^9`, `eslint-config-next@15.1.6`,
  `.eslintrc.json` extends `next/core-web-vitals`); all 28 findings fixed
  (all `react/no-unescaped-entities`).

### Final task
- `.env.example` rewritten: documents all 20 environment variables the code
  reads (was 7, including two for deleted Nutritionix).
- `SMS_SETUP.md` marked deprecated (describes a Twilio flow that was never
  built; reminders are APNs push).

## Known state / carried into Phase 2

- **Signal tables stay by design:** `signal_collected_content`,
  `signal_deduplication`, `signal_job_run_log` live in Sprint's DB (all
  currently 0 rows) for admin visibility into Signal's video data. Note the
  task spec named them `signal_content` / `signal_content_authenticated_read`
  / `signal_digest_log` — the actual names differ, and
  `signal_content_authenticated_read` is an RLS **policy** on
  `signal_collected_content` that lets any signed-in athlete read that table.
  Worth revisiting when the tables gain data.
- **No WHOOP users connected** (`whoop_tokens` empty): the hrv/sleep-quality
  fixes are unit-tested but not yet smoke-tested against live data. After the
  next WHOOP connect, verify `daily_checkins.hrv_ms` is an integer and
  `sleep_quality` ∈ 1–10.
- **APNS reminders off** until `APNS_ENABLED=true` + `APNS_KEY_ID`/
  `APNS_KEY_P8` are provided (active Apple Developer account required).
- **Delete-based "regenerate" semantics** in
  `app/api/coach/auto-respond/route.ts` and
  `app/api/admin/generate-coach-response/route.ts` (same-day AI drafts are
  deleted before re-insert) — flagged during audit, intentionally unchanged.
- **pg_cron `reminders-tick`** (every 15 min) carries a hardcoded production
  URL + bearer token; rotate together with `CRON_SECRET`. Local `.env.local`
  `CRON_SECRET` does not match production's.
- **Repo SQL drift:** `supabase/schema.sql` + patch files lag the live
  migration history (39 migrations after Phase 1). The live DB is
  authoritative.
- **Supabase advisors** (pre-existing): leaked-password protection disabled;
  `pg_net`/`vector` extensions in the public schema; `is_admin()` SECURITY
  DEFINER callable by authenticated.
- `next lint` is deprecated in Next 16 — migrate to the ESLint CLI in Phase 2.
- Stray `C:\Users\tyler\package-lock.json` outside the repo makes Next.js
  mis-infer the workspace root (build warning only).
- Coach/OCR default model is `claude-sonnet-4-6` (valid, previous-gen);
  override via `COACH_MODEL`/`OCR_MODEL` when ready.
