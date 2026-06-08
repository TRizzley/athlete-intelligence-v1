-- ----------------------------------------------------------------------------
-- Migration: workout tracking (templates + daily logging)  — June 2026
--
-- Model
--   workout_days       a reusable template day (e.g. "Push", "Upper 1")
--   workout_exercises  the exercises in a template day (name/sets/reps/muscle)
--   workout_sessions   a logged training day, created from a template day
--   workout_set_logs   per-set weight + reps for a session (the tracked data)
--
-- The template (days + exercises) is stable; the per-set WEIGHT/REPS are what
-- reset and get tracked each day. Starting a session snapshots the template's
-- exercises into blank set-log rows the athlete fills in.
--
-- Safe to run more than once.
-- ----------------------------------------------------------------------------

-- 1. Template: a workout day ------------------------------------------------
create table if not exists public.workout_days (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  name        text not null,            -- "Push", "Upper 1"
  label       text,                     -- optional grouping: "Push"/"Pull"/"Legs"
  position    int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2. Template: exercises within a day ---------------------------------------
create table if not exists public.workout_exercises (
  id              uuid primary key default gen_random_uuid(),
  workout_day_id  uuid not null references public.workout_days(id) on delete cascade,
  user_id         uuid not null references public.users(id) on delete cascade,
  name            text not null,        -- "Bench"
  target_sets     int,                  -- 4
  target_reps     text,                 -- "8" or "8-10"
  muscle_group    text,                 -- "chest"
  position        int  not null default 0,
  created_at      timestamptz not null default now()
);

-- 3. A logged session (one per calendar day) --------------------------------
create table if not exists public.workout_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  workout_day_id  uuid references public.workout_days(id) on delete set null,
  day_name        text,                 -- snapshot of the day's name
  session_date    date not null default current_date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, session_date)
);

-- 4. Per-set log: the tracked weight + reps ---------------------------------
create table if not exists public.workout_set_logs (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.workout_sessions(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  exercise_name text not null,
  muscle_group  text,
  set_number    int  not null,          -- 1..n within the exercise
  target_reps   text,
  weight        numeric,                -- the tracked value (blank until logged)
  reps          int,                    -- actual reps performed
  position      int  not null default 0,
  created_at    timestamptz not null default now()
);

-- 5. updated_at triggers ----------------------------------------------------
drop trigger if exists set_updated_at on public.workout_days;
create trigger set_updated_at before update on public.workout_days
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.workout_sessions;
create trigger set_updated_at before update on public.workout_sessions
  for each row execute function public.set_updated_at();

-- 6. Indexes ----------------------------------------------------------------
create index if not exists idx_workout_days_user      on public.workout_days (user_id, position);
create index if not exists idx_workout_ex_day         on public.workout_exercises (workout_day_id, position);
create index if not exists idx_workout_sessions_user  on public.workout_sessions (user_id, session_date desc);
create index if not exists idx_workout_setlogs_session on public.workout_set_logs (session_id, position);

-- 7. Row Level Security -----------------------------------------------------
alter table public.workout_days     enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.workout_set_logs enable row level security;

-- workout_days
drop policy if exists workout_days_select on public.workout_days;
create policy workout_days_select on public.workout_days for select
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists workout_days_insert on public.workout_days;
create policy workout_days_insert on public.workout_days for insert
  with check (user_id = auth.uid());
drop policy if exists workout_days_update on public.workout_days;
create policy workout_days_update on public.workout_days for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists workout_days_delete on public.workout_days;
create policy workout_days_delete on public.workout_days for delete
  using (user_id = auth.uid());

-- workout_exercises
drop policy if exists workout_ex_select on public.workout_exercises;
create policy workout_ex_select on public.workout_exercises for select
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists workout_ex_insert on public.workout_exercises;
create policy workout_ex_insert on public.workout_exercises for insert
  with check (user_id = auth.uid());
drop policy if exists workout_ex_update on public.workout_exercises;
create policy workout_ex_update on public.workout_exercises for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists workout_ex_delete on public.workout_exercises;
create policy workout_ex_delete on public.workout_exercises for delete
  using (user_id = auth.uid());

-- workout_sessions
drop policy if exists workout_sessions_select on public.workout_sessions;
create policy workout_sessions_select on public.workout_sessions for select
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists workout_sessions_insert on public.workout_sessions;
create policy workout_sessions_insert on public.workout_sessions for insert
  with check (user_id = auth.uid());
drop policy if exists workout_sessions_update on public.workout_sessions;
create policy workout_sessions_update on public.workout_sessions for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists workout_sessions_delete on public.workout_sessions;
create policy workout_sessions_delete on public.workout_sessions for delete
  using (user_id = auth.uid());

-- workout_set_logs
drop policy if exists workout_setlogs_select on public.workout_set_logs;
create policy workout_setlogs_select on public.workout_set_logs for select
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists workout_setlogs_insert on public.workout_set_logs;
create policy workout_setlogs_insert on public.workout_set_logs for insert
  with check (user_id = auth.uid());
drop policy if exists workout_setlogs_update on public.workout_set_logs;
create policy workout_setlogs_update on public.workout_set_logs for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists workout_setlogs_delete on public.workout_set_logs;
create policy workout_setlogs_delete on public.workout_set_logs for delete
  using (user_id = auth.uid());
