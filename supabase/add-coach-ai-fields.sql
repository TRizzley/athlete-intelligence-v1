-- ============================================================================
-- Migration: AI coach-response draft workflow
-- The Operating System for Human Performance — Sprint V1 Validation
--
-- Adds the two columns the admin "Generate Coach Response" workflow needs:
--   * athlete_question — the one short question the coach asks the athlete
--                        (the 7th section of the daily decision)
--   * ai_generated     — true when the draft was first drafted by Claude
--                        (so you can measure how much admin work AI saved)
--
-- Safe to run on an existing database and safe to re-run. Run it once in the
-- Supabase SQL Editor (Dashboard → SQL → New query). No RLS changes are needed:
-- coach_responses already hides drafts and only shows status = 'sent' rows to
-- the athlete, which is exactly the human-approval gate this workflow relies on.
-- ============================================================================

alter table public.coach_responses
  add column if not exists athlete_question text;

alter table public.coach_responses
  add column if not exists ai_generated boolean not null default false;

-- ============================================================================
-- Done. The "Generate Coach Response" button will now save AI drafts here.
-- ============================================================================
