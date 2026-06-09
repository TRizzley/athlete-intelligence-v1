-- ----------------------------------------------------------------------------
-- Migration: Day-14 analytical report tracking — June 2026
--
-- Idempotency for the background job that has the coach send an athlete ONE
-- analytical report (a non-obvious pattern about themselves) once they have ~2
-- weeks of data. See app/api/cron/milestone-reports/route.ts.
--
-- Applied to Supabase project dodfgknznxripagqncpd via the MCP connector.
-- Safe to run more than once.
-- ----------------------------------------------------------------------------

alter table public.athlete_profiles
  add column if not exists day14_report_sent_at timestamptz;
