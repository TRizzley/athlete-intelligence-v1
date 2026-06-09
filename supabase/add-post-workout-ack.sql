-- ----------------------------------------------------------------------------
-- Migration: post-workout coach acknowledgment tracking — June 2026
--
-- Adds an idempotency key so the coach sends its short post-workout note at most
-- once per logged session. The note lands in coach_messages (chat) and never
-- overwrites the frozen morning decision; this column just records that it ran.
--
-- Applied to Supabase project dodfgknznxripagqncpd via the MCP connector.
-- Safe to run more than once.
-- ----------------------------------------------------------------------------

alter table public.daily_checkins
  add column if not exists post_workout_ack_at timestamptz;
