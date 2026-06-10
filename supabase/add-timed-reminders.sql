-- ----------------------------------------------------------------------------
-- Migration: timed SMS reminders (morning 9am, post-workout 7pm) + feedback
-- nudge — June 2026
--
-- Drives /api/cron/reminders (a 15-min tick). Per-day idempotency for the two
-- time-of-day reminders, and per-response idempotency for the feedback nudge.
--
-- Applied to Supabase project dodfgknznxripagqncpd via the MCP connector.
-- Safe to run more than once.
-- ----------------------------------------------------------------------------

alter table public.athlete_profiles
  add column if not exists morning_reminder_date text,
  add column if not exists postworkout_reminder_date text;

alter table public.coach_responses
  add column if not exists feedback_reminder_at timestamptz;
