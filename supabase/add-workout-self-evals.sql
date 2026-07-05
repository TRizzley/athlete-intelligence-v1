-- ----------------------------------------------------------------------------
-- Migration: workout self-evaluations (Phase 2, Milestone A) — July 2026
--
-- The athlete's post-workout self-eval: RPE (1-10) plus an optional one-liner
-- ("felt strong", "hit plateau"). One eval per workout session; re-submitting
-- overwrites (upsert on workout_id). This is the raw signal the coach layer
-- reads to personalize future suggestions.
--
-- Note: daily_checkins.workout_intensity also captures a 1-10 effort rating
-- via the post-workout check-in. Both stay live for now; coach logic reads
-- both. Whether to deprecate workout_intensity is a Milestone B decision.
--
-- Safe to run more than once.
-- ----------------------------------------------------------------------------

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

-- updated_at trigger (same pattern as every other table)
drop trigger if exists set_updated_at on public.workout_self_evals;
create trigger set_updated_at before update on public.workout_self_evals
  for each row execute function public.set_updated_at();

-- Index for the coach layer: all of an athlete's evals, newest first.
create index if not exists idx_self_evals_user on public.workout_self_evals (user_id, created_at desc);

-- Row Level Security ---------------------------------------------------------
-- Athletes read/write their own evals only; admins can read. The backend
-- coach logic uses the service-role client, which bypasses RLS.
alter table public.workout_self_evals enable row level security;

drop policy if exists self_evals_select on public.workout_self_evals;
create policy self_evals_select on public.workout_self_evals for select
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists self_evals_insert on public.workout_self_evals;
create policy self_evals_insert on public.workout_self_evals for insert
  with check (user_id = auth.uid());
drop policy if exists self_evals_update on public.workout_self_evals;
create policy self_evals_update on public.workout_self_evals for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists self_evals_delete on public.workout_self_evals;
create policy self_evals_delete on public.workout_self_evals for delete
  using (user_id = auth.uid());
