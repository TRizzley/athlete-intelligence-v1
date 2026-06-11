-- ----------------------------------------------------------------------------
-- Add Day-7 and Day-42 milestone report tracking columns to athlete_profiles.
--
-- The existing day14_report_sent_at column is repurposed as the Day-21 report
-- idempotency stamp (its original intent — the "Day 14" name is legacy).
-- New columns track the two additional milestone tiers.
--
-- Run once in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).
-- ----------------------------------------------------------------------------

alter table public.athlete_profiles
  add column if not exists day7_report_sent_at  timestamptz,
  add column if not exists day42_report_sent_at timestamptz;

comment on column public.athlete_profiles.day7_report_sent_at  is 'When the first-week (Day 7) milestone report was sent to the athlete.';
comment on column public.athlete_profiles.day14_report_sent_at is 'When the Phase-1 (Day 21) milestone report was sent (column named day14 for legacy reasons).';
comment on column public.athlete_profiles.day42_report_sent_at is 'When the Phase-2 (Day 42) milestone report was sent.';
