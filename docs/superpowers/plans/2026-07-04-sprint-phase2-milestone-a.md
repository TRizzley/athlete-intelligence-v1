# Sprint Phase 2 — Milestone A: Self-Evaluation System

**Date:** 2026-07-04
**Status:** A1 committed (21611b3) · A2 built (awaiting checkpoint approval) · A3 pending

## Goal

Create the athlete self-evaluation loop — the foundation for all personalization.
After a workout, the athlete submits an RPE (1–10) and an optional one-liner
("felt strong", "hit plateau"). The coach layer reads that history to
personalize future suggestions. No external data sources (no device APIs, no
Signal): pure self-eval data.

## Tasks

### A1 — Self-eval schema + endpoint (this task)

- **Table:** `public.workout_self_evals` (migration:
  `supabase/add-workout-self-evals.sql`, applied to project
  `dodfgknznxripagqncpd`).
- **Endpoint:** `POST /api/athlete/workouts/:workoutId/eval`
  (`app/api/athlete/workouts/[workoutId]/eval/route.ts`). Upserts on
  `workout_id`; re-submission overwrites.
- **Tests:** `app/api/athlete/workouts/__tests__/eval.test.ts` (vitest,
  mocks `@/lib/supabase/server`).

### A2 — Coach reads evals (built)

Self-evals flow into every AI coaching module via the shared context
pipeline:

- `lib/coach-types.ts` — `SelfEvalBrief` (workout_date, day_name, rpe,
  feedback) + optional `selfEvals` on `CoachContext`.
- `lib/context.ts` — `buildCoachContext` fetches the newest 15 evals
  (`selfEvalLimit` option) joined to `workout_sessions` for date/day-name,
  in the existing parallel query batch (service-role client, like all
  context reads).
- `lib/coach-context.ts` — `buildContextText` renders an "ATHLETE
  SELF-EVALS" section directly after LOGGED WORKOUTS so evals line up with
  sessions by date. The section tells the coach to read RPE alongside
  `workout_intensity_1to10` from check-ins (same scale, day level), to read
  rising RPE at constant load as fatigue / falling as adaptation, and to
  echo the athlete's own words for personalization.
- `lib/coach-evals.ts` — pure `summarizeSelfEvals(evals)` derives
  deterministic stats (avg RPE over last 5, newest feedback, count, trend
  from the two most recent) so the AI never does arithmetic over raw rows
  (same reasoning as `coach-trends.ts`). Rendered as a SUMMARY line at the
  top of the self-evals section. No DB access — it summarizes the evals
  `buildCoachContext` already fetched.
- Tests: `lib/__tests__/coach-evals.test.ts` (9 pure-function tests) and
  `lib/__tests__/coach-context.test.ts` (rendering, summary line, ordering,
  null-feedback handling, section placement).

Because every coach surface (morning brief, chat, workout review,
milestone reports) builds context through `buildCoachContext` →
`buildContextText`, no per-route changes were needed.

### A3 — End-to-end checkpoint

Full loop verification: athlete logs a workout → submits self-eval → coach
response demonstrably uses the eval history. Manual e2e pass plus any gaps
found in A1/A2.

## Schema (as built)

```sql
create table if not exists public.workout_self_evals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  workout_id  uuid not null references public.workout_sessions(id) on delete cascade,
  rpe         int  not null check (rpe between 1 and 10),
  feedback    text check (char_length(feedback) <= 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (workout_id)
);
```

Conventions (differ from the original draft spec, confirmed 2026-07-04):

- `user_id` → `public.users`, not `athlete_id` → `sprint_athlete` (that table
  does not exist; every table in this schema keys on `user_id`).
- `workout_id` → `public.workout_sessions` (the logged-workout entity), not
  a `workouts` table.
- `timestamptz` + the shared `set_updated_at()` trigger, matching all other
  tables.
- `unique (workout_id)` only — a session already belongs to exactly one user,
  so the two-column unique key was redundant. Upserts conflict on
  `workout_id`.
- Feedback length enforced in the DB (`char_length <= 200`) as well as in the
  endpoint.

**RLS:** athletes select/insert/update/delete their own rows
(`user_id = auth.uid()`); admins can select (`public.is_admin()`). The
backend coach logic uses the service-role client, which bypasses RLS — no
extra policy needed.

**Endpoint auth:** user-scoped client from `@/lib/supabase/server` +
`auth.getUser()` (same pattern as `app/api/coach/post-workout-ack/route.ts`).
No service-role key in this route. Next 15 promise-style `params`, awaited.
`workoutId` validated as a UUID up front (400 on garbage). Ownership of the
workout session is checked explicitly before the write; RLS backstops it.

## Overlap note: `daily_checkins.workout_intensity`

`daily_checkins.workout_intensity` (int, 1–10, written by the existing
post-workout check-in flow) already captures an RPE-style effort rating, and
`workout_sessions.notes` holds free text. Decision (2026-07-04): keep both
live. `workout_self_evals` is the dedicated per-workout eval entity; coach
logic in A2 reads **both** signals.

**Milestone B decision point:** once real usage shows whether the two ratings
diverge or duplicate, decide whether to deprecate `workout_intensity` (fold
it into self-evals) or keep it as the check-in-day signal.

## Constraints

- RPE required, integer 1–10 (CHECK constraint + endpoint validation).
- Feedback optional, max 200 chars (CHECK constraint + endpoint validation).
- One eval per workout (unique on `workout_id`; upsert on re-submit).
- Athletes can only eval their own workouts (RLS + explicit ownership check).
- No external data sources.
