-- ----------------------------------------------------------------------------
-- Migration: richer training + sleep capture on daily_checkins
--
-- Adds (June 2026):
--   workout_types  text[]   multi-select workout type (replaces single workout_type)
--   workout_split  text     training split for the session (push/pull/legs, etc.)
--   training_load  text     free-text load log, e.g. "225x5, 245x3"
--   top_set_lbs    numeric  optional numeric top set for charting later
--   bed_time       time     when they went to bed
--   wake_time      time     when they woke up
--
-- The existing single `workout_type` column is kept for back-compat. The app
-- writes the first selected type into it so older reads keep working.
--
-- Safe to run more than once (IF NOT EXISTS).
-- ----------------------------------------------------------------------------

alter table public.daily_checkins
  add column if not exists workout_types text[] default '{}',
  add column if not exists workout_split text,
  add column if not exists training_load text,
  add column if not exists top_set_lbs   numeric,
  add column if not exists bed_time      time,
  add column if not exists wake_time     time;

-- Backfill the new array from the legacy single column where present.
update public.daily_checkins
  set workout_types = array[workout_type]
  where workout_type is not null
    and (workout_types is null or array_length(workout_types, 1) is null);
