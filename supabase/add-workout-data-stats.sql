-- ----------------------------------------------------------------------------
-- Migration: workout-data stats for the trend-engine gate — June 2026
--
-- The trend-based coaching engine only activates once an athlete has at least
-- TREND_GATE_DAYS (currently 21) of workout history. To keep that gate check cheap (a single PK read of
-- the profile row that's already loaded each session — never a scan of the
-- workout tables on every page load), we materialize two stats onto the profile:
--
--   workout_data_start_date — date of the athlete's FIRST completed workout
--   workout_log_count       — number of completed workout sessions logged
--
-- These are refreshed (one aggregate query) whenever a session is completed, and
-- lazily backfilled the first time the trend flow runs for an existing athlete.
--
-- Safe to run more than once.
-- ----------------------------------------------------------------------------

alter table public.athlete_profiles
  add column if not exists workout_data_start_date date,
  add column if not exists workout_log_count integer not null default 0;
