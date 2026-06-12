-- ----------------------------------------------------------------------------
-- Migration: Strava OAuth integration — June 2026
--
-- strava_tokens     one row per connected Strava athlete; stores the OAuth
--                   tokens needed to call the Strava API on their behalf
--
-- workout_sessions  three new columns:
--   strava_activity_id bigint — the Strava activity ID (nullable, unique)
--   source             text   — 'manual' (default) or 'strava'
--   source_meta        jsonb  — full raw Strava activity payload for re-processing
--
-- The existing UNIQUE(user_id, session_date) constraint remains. Strava-imported
-- sessions respect it: if a manual session already exists for that date, the
-- import is silently skipped (handled in the route, not the DB).
--
-- Safe to run more than once.
-- ----------------------------------------------------------------------------

-- 1. Strava OAuth tokens -------------------------------------------------------

create table if not exists public.strava_tokens (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            uuid        not null references public.users(id) on delete cascade,
  strava_athlete_id  bigint      not null,
  access_token       text        not null,
  refresh_token      text        not null,
  expires_at         timestamptz not null,
  scope              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint strava_tokens_user_unique unique (user_id),
  constraint strava_tokens_athlete_unique unique (strava_athlete_id)
);

drop trigger if exists set_updated_at on public.strava_tokens;
create trigger set_updated_at before update on public.strava_tokens
  for each row execute function public.set_updated_at();

-- RLS: athletes see only their own token row; webhook uses service role (bypasses)
alter table public.strava_tokens enable row level security;

drop policy if exists strava_tokens_select on public.strava_tokens;
create policy strava_tokens_select on public.strava_tokens for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists strava_tokens_insert on public.strava_tokens;
create policy strava_tokens_insert on public.strava_tokens for insert
  with check (user_id = auth.uid());

drop policy if exists strava_tokens_update on public.strava_tokens;
create policy strava_tokens_update on public.strava_tokens for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists strava_tokens_delete on public.strava_tokens;
create policy strava_tokens_delete on public.strava_tokens for delete
  using (user_id = auth.uid());

-- 2. Strava columns on workout_sessions ----------------------------------------

alter table public.workout_sessions
  add column if not exists strava_activity_id bigint,
  add column if not exists source             text not null default 'manual',
  add column if not exists source_meta        jsonb;

-- Partial unique index: only one row may claim each Strava activity ID.
create unique index if not exists idx_workout_sessions_strava_activity
  on public.workout_sessions (strava_activity_id)
  where strava_activity_id is not null;

create index if not exists idx_workout_sessions_source
  on public.workout_sessions (user_id, source);
