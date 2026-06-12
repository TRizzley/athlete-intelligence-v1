-- ----------------------------------------------------------------------------
-- Migration: chat-first check-in flow — June 2026
--
-- The morning decision and the post-workout review now land IN THE COACH CHAT
-- as conversational messages instead of (only) the long structured card. This
-- adds a `kind` tag to coach_messages so the UI can style the daily brief and
-- the workout review distinctly, and so each is posted at most once per day.
--
--   chat           — a normal back-and-forth message (default)
--   morning_brief  — the conversational delivery of the day's decision
--   workout_review — the coach's review after the post-workout check-in
--
-- Applied to Supabase project dodfgknznxripagqncpd via the MCP connector.
-- Safe to run more than once.
-- ----------------------------------------------------------------------------

alter table public.coach_messages
  add column if not exists kind text not null default 'chat'
  check (kind in ('chat', 'morning_brief', 'workout_review'));
