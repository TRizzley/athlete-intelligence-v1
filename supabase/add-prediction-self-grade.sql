-- ----------------------------------------------------------------------------
-- Migration: coach self-grade on predictions — June 2026
--
-- Layer 1 of the two-layer feedback loop. At the start of each daily session the
-- coach grades its OWN previous-day performance prediction against the athlete's
-- actual logged workout, assigning Accurate / Slightly Off / Missed plus a one-
-- sentence note explaining the delta. This is separate from `outcome` (which
-- grades the prediction against the morning check-in): the self-grade is judged
-- specifically against the workout log, and is shown to the developer/admin —
-- not to the athlete unless they ask.
--
-- Safe to run more than once.
-- ----------------------------------------------------------------------------

alter table public.prediction_outcomes
  add column if not exists self_grade text
    check (self_grade in ('accurate', 'slightly_off', 'missed')),
  add column if not exists self_grade_note text;
