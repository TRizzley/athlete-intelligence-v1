-- ============================================================================
-- Sprint V1 Validation — Database Schema
-- The Operating System for Human Performance
--
-- Run this once in the Supabase SQL Editor (Dashboard → SQL → New query).
-- It is idempotent: safe to re-run. Creates tables, helper functions, the
-- signup trigger, row-level-security policies, and the screenshots bucket.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Extensions
-- ----------------------------------------------------------------------------
create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- 1. Helper functions
-- ----------------------------------------------------------------------------

-- True when the current authenticated user has the 'admin' role.
-- SECURITY DEFINER so it can read public.users without triggering the
-- users RLS policy (which would otherwise recurse).
create or replace function public.is_admin()
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  return exists (
    select 1 from public.users
    where id = auth.uid() and role = 'admin'
  );
end;
$$;

-- Keeps updated_at fresh on row updates.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Mirrors a new auth user into public.users as a participant.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    'participant'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 2. Tables
-- ----------------------------------------------------------------------------

-- 2.1 users (profile + role; 1:1 with auth.users)
create table if not exists public.users (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text default '',
  role       text not null default 'participant' check (role in ('participant', 'admin')),
  created_at timestamptz not null default now()
);

-- 2.2 athlete_profiles (one-time onboarding; 1:1 with user)
create table if not exists public.athlete_profiles (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null unique references public.users(id) on delete cascade,
  full_name             text,
  phone                 text,  -- E.164 (e.g. +15551234567) for SMS check-in reminders
  last_checkin_reminder_at timestamptz, -- idempotency for the daily SMS reminder
  day14_report_sent_at  timestamptz, -- when the background Day-14 report was sent
  age                   int check (age between 10 and 100),
  sex                   text check (sex in ('male', 'female', 'other', 'prefer_not_to_say')),
  height_in             numeric,
  body_weight_lbs       numeric,
  primary_sport         text check (primary_sport in ('strength', 'endurance', 'hybrid', 'other')),
  primary_goal          text,
  goal_detail           text,
  training_age          text check (training_age in ('beginner', 'intermediate', 'advanced')),
  experience_mode       text check (experience_mode in ('advisor', 'guide')),
  training_days_per_week int check (training_days_per_week between 0 and 14),
  current_program       text,
  devices               text[] default '{}',
  nutrition_app         text,
  injuries              text,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- 2.3 daily_checkins (the morning input ritual)
create table if not exists public.daily_checkins (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  checkin_date      date not null default current_date,
  sleep_hours       numeric,
  sleep_quality     int check (sleep_quality between 1 and 10),
  recovery_score    int check (recovery_score between 0 and 100),
  hrv_ms            int,
  resting_hr        int,
  body_weight_lbs   numeric,
  calories          int,
  protein_g         int,
  carbs_g           int,
  fat_g             int,
  water_oz          numeric,
  workout_completed boolean,
  workout_type      text,
  workout_types     text[] default '{}',
  workout_split     text,
  training_load     text,
  top_set_lbs       numeric,
  bed_time          time,
  wake_time         time,
  workout_intensity int check (workout_intensity between 1 and 10),
  soreness          int check (soreness between 1 and 10),
  energy            int check (energy between 1 and 10),
  mood              int check (mood between 1 and 10),
  stress            int check (stress between 1 and 10),
  motivation        int check (motivation between 1 and 10),
  pain_injury_note  text,
  open_comments     text,
  -- Set when the coach has sent its short post-workout acknowledgment for the
  -- day (idempotency key — see supabase/add-post-workout-ack.sql).
  post_workout_ack_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, checkin_date)
);

-- 2.4 uploaded_screenshots (manual stand-in for wearable APIs)
create table if not exists public.uploaded_screenshots (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  source       text not null check (source in
                ('whoop', 'apple_health', 'apple_fitness', 'garmin', 'oura', 'nutrition', 'other')),
  storage_path text not null,
  file_name    text,
  capture_date date,
  note         text,
  created_at   timestamptz not null default now(),
  -- Background OCR (Claude vision) status + extracted values.
  parse_status text not null default 'pending'
               check (parse_status in ('pending','processing','done','error','skipped')),
  parsed_json  jsonb,
  parsed_at    timestamptz,
  parse_error  text,
  -- Null = the OCR reading is pending the athlete's review; set once confirmed
  -- or dismissed (see supabase/add-screenshot-applied-at.sql).
  applied_at   timestamptz
);

-- 2.5 coach_responses (hand-written daily decision)
create table if not exists public.coach_responses (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  response_date   date not null default current_date,
  what_noticed    text,
  why_it_matters  text,
  recommendation  text,
  prediction      text,
  confidence      text check (confidence in ('low', 'medium', 'high')),
  data_used       text,
  athlete_question text,
  status          text not null default 'draft' check (status in ('draft', 'sent')),
  ai_generated    boolean not null default false,
  created_by      uuid references public.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  sent_at         timestamptz
);

-- 2.6 predictions (structured, trackable predictions)
create table if not exists public.predictions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  coach_response_id uuid references public.coach_responses(id) on delete set null,
  prediction_text   text not null,
  horizon           text default 'tomorrow',
  confidence        text check (confidence in ('low', 'medium', 'high')),
  target_date       date,
  created_by        uuid references public.users(id),
  created_at        timestamptz not null default now()
);

-- 2.7 prediction_outcomes (did the prediction come true?)
create table if not exists public.prediction_outcomes (
  id            uuid primary key default gen_random_uuid(),
  prediction_id uuid not null unique references public.predictions(id) on delete cascade,
  outcome       text not null check (outcome in ('came_true', 'partially', 'false', 'too_early', 'unknown')),
  notes         text,
  recorded_by   uuid references public.users(id),
  recorded_at   timestamptz not null default now()
);

-- 2.8 user_feedback (the aha measurement — one per coach response)
create table if not exists public.user_feedback (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.users(id) on delete cascade,
  coach_response_id     uuid not null unique references public.coach_responses(id) on delete cascade,
  felt_accurate         text check (felt_accurate in ('yes', 'somewhat', 'no')),
  felt_personalized     text check (felt_personalized in ('yes', 'somewhat', 'no')),
  was_useful            text check (was_useful in ('yes', 'somewhat', 'no')),
  prediction_came_true  text check (prediction_came_true in ('yes', 'somewhat', 'no', 'too_early')),
  would_pay             text check (would_pay in ('yes', 'maybe', 'no')),
  free_text             text,
  created_at            timestamptz not null default now()
);

-- 2.9 athlete_memory_notes (coach's private per-athlete memory)
create table if not exists public.athlete_memory_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  category   text,
  note       text not null,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

-- 2.10 trust_metrics (periodic per-athlete metric snapshots)
create table if not exists public.trust_metrics (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  snapshot_date       date not null default current_date,
  responses_sent      int default 0,
  feedback_count      int default 0,
  aha_rate            numeric,
  accuracy_rate       numeric,
  usefulness_rate     numeric,
  would_pay_rate      numeric,
  predictions_total   int default 0,
  predictions_correct numeric default 0,
  prediction_accuracy numeric,
  created_by          uuid references public.users(id),
  created_at          timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 3. updated_at triggers
-- ----------------------------------------------------------------------------
drop trigger if exists set_updated_at on public.athlete_profiles;
create trigger set_updated_at before update on public.athlete_profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.daily_checkins;
create trigger set_updated_at before update on public.daily_checkins
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.coach_responses;
create trigger set_updated_at before update on public.coach_responses
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Indexes
-- ----------------------------------------------------------------------------
create index if not exists idx_checkins_user_date    on public.daily_checkins (user_id, checkin_date desc);
create index if not exists idx_screenshots_user      on public.uploaded_screenshots (user_id, created_at desc);
create index if not exists idx_responses_user        on public.coach_responses (user_id, response_date desc);
create index if not exists idx_predictions_user      on public.predictions (user_id, created_at desc);
create index if not exists idx_feedback_user         on public.user_feedback (user_id, created_at desc);
create index if not exists idx_memory_user           on public.athlete_memory_notes (user_id, created_at desc);
create index if not exists idx_trust_user            on public.trust_metrics (user_id, snapshot_date desc);

-- ----------------------------------------------------------------------------
-- 5. Row Level Security
-- ----------------------------------------------------------------------------
alter table public.users                enable row level security;
alter table public.athlete_profiles     enable row level security;
alter table public.daily_checkins       enable row level security;
alter table public.uploaded_screenshots enable row level security;
alter table public.coach_responses      enable row level security;
alter table public.predictions          enable row level security;
alter table public.prediction_outcomes  enable row level security;
alter table public.user_feedback        enable row level security;
alter table public.athlete_memory_notes enable row level security;
alter table public.trust_metrics        enable row level security;

-- 5.1 users
drop policy if exists users_select on public.users;
create policy users_select on public.users for select
  using (id = auth.uid() or public.is_admin());

drop policy if exists users_update_admin on public.users;
create policy users_update_admin on public.users for update
  using (public.is_admin()) with check (public.is_admin());

-- 5.2 athlete_profiles
drop policy if exists profiles_select on public.athlete_profiles;
create policy profiles_select on public.athlete_profiles for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists profiles_insert on public.athlete_profiles;
create policy profiles_insert on public.athlete_profiles for insert
  with check (user_id = auth.uid());

drop policy if exists profiles_update on public.athlete_profiles;
create policy profiles_update on public.athlete_profiles for update
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- 5.3 daily_checkins
drop policy if exists checkins_select on public.daily_checkins;
create policy checkins_select on public.daily_checkins for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists checkins_insert on public.daily_checkins;
create policy checkins_insert on public.daily_checkins for insert
  with check (user_id = auth.uid());

drop policy if exists checkins_update on public.daily_checkins;
create policy checkins_update on public.daily_checkins for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists checkins_delete on public.daily_checkins;
create policy checkins_delete on public.daily_checkins for delete
  using (user_id = auth.uid());

-- 5.4 uploaded_screenshots
drop policy if exists screenshots_select on public.uploaded_screenshots;
create policy screenshots_select on public.uploaded_screenshots for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists screenshots_insert on public.uploaded_screenshots;
create policy screenshots_insert on public.uploaded_screenshots for insert
  with check (user_id = auth.uid());

drop policy if exists screenshots_update on public.uploaded_screenshots;
create policy screenshots_update on public.uploaded_screenshots for update
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists screenshots_delete on public.uploaded_screenshots;
create policy screenshots_delete on public.uploaded_screenshots for delete
  using (user_id = auth.uid() or public.is_admin());

-- 5.5 coach_responses (participants see only SENT responses; admins see all)
drop policy if exists responses_select on public.coach_responses;
create policy responses_select on public.coach_responses for select
  using ((user_id = auth.uid() and status = 'sent') or public.is_admin());

drop policy if exists responses_insert on public.coach_responses;
create policy responses_insert on public.coach_responses for insert
  with check (public.is_admin());

drop policy if exists responses_update on public.coach_responses;
create policy responses_update on public.coach_responses for update
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists responses_delete on public.coach_responses;
create policy responses_delete on public.coach_responses for delete
  using (public.is_admin());

-- 5.6 predictions
drop policy if exists predictions_select on public.predictions;
create policy predictions_select on public.predictions for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists predictions_write on public.predictions;
create policy predictions_write on public.predictions for all
  using (public.is_admin()) with check (public.is_admin());

-- 5.7 prediction_outcomes
drop policy if exists outcomes_select on public.prediction_outcomes;
create policy outcomes_select on public.prediction_outcomes for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.predictions p
      where p.id = prediction_id and p.user_id = auth.uid()
    )
  );

drop policy if exists outcomes_write on public.prediction_outcomes;
create policy outcomes_write on public.prediction_outcomes for all
  using (public.is_admin()) with check (public.is_admin());

-- 5.8 user_feedback
drop policy if exists feedback_select on public.user_feedback;
create policy feedback_select on public.user_feedback for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists feedback_insert on public.user_feedback;
create policy feedback_insert on public.user_feedback for insert
  with check (user_id = auth.uid());

drop policy if exists feedback_update on public.user_feedback;
create policy feedback_update on public.user_feedback for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 5.9 athlete_memory_notes (admin/coach only)
drop policy if exists memory_all_admin on public.athlete_memory_notes;
create policy memory_all_admin on public.athlete_memory_notes for all
  using (public.is_admin()) with check (public.is_admin());

-- 5.10 trust_metrics (admin/coach only)
drop policy if exists trust_all_admin on public.trust_metrics;
create policy trust_all_admin on public.trust_metrics for all
  using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- 6. Storage: private 'screenshots' bucket + policies
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', false)
on conflict (id) do nothing;

-- Files are stored at: screenshots/{user_id}/{uuid}.{ext}
-- foldername(name)[1] is therefore the owning user's id.

drop policy if exists screenshots_upload on storage.objects;
create policy screenshots_upload on storage.objects for insert
  with check (
    bucket_id = 'screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists screenshots_read on storage.objects;
create policy screenshots_read on storage.objects for select
  using (
    bucket_id = 'screenshots'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists screenshots_remove on storage.objects;
create policy screenshots_remove on storage.objects for delete
  using (
    bucket_id = 'screenshots'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- ============================================================================
-- Done. Next: promote yourself to admin with supabase/seed-admin.sql
-- ============================================================================
