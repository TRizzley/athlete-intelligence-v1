-- ----------------------------------------------------------------------------
-- Migration: allow the 'feedback_prompt' coach-message kind — June 2026
--
-- Layer 2 of the feedback loop posts a closing message that hands off to the
-- existing feedback tool (/feedback/[id]). That message is stored in
-- coach_messages with kind = 'feedback_prompt', so the kind CHECK constraint
-- must permit it alongside the existing kinds.
--
-- Safe to run more than once.
-- ----------------------------------------------------------------------------

alter table public.coach_messages
  drop constraint if exists coach_messages_kind_check;

alter table public.coach_messages
  add constraint coach_messages_kind_check
  check (kind = any (array['chat', 'morning_brief', 'workout_review', 'feedback_prompt']));
