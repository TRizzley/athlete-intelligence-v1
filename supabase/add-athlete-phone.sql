-- ----------------------------------------------------------------------------
-- Migration: athlete mobile number for SMS check-in reminders — June 2026
--
-- Collected at onboarding; athletes who onboarded earlier are prompted on the
-- dashboard to add it. Stored normalized to E.164 (e.g. +15551234567).
--
-- Applied to Supabase project dodfgknznxripagqncpd via the MCP connector.
-- Safe to run more than once.
-- ----------------------------------------------------------------------------

alter table public.athlete_profiles
  add column if not exists phone text;

-- Idempotency for the daily SMS check-in reminder cron (never double-text/day).
alter table public.athlete_profiles
  add column if not exists last_checkin_reminder_at timestamptz;
