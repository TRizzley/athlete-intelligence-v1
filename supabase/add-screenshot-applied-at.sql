-- ----------------------------------------------------------------------------
-- Migration: gate OCR readings behind athlete confirmation — June 2026
--
-- OCR no longer auto-writes a screenshot's values into daily_checkins on upload.
-- The parsed values wait as a "pending review" until the athlete confirms (their
-- values then overwrite the day's check-in) or dismisses them. applied_at being
-- non-null means the reading has been handled and leaves the review queue.
--
-- Applied to Supabase project dodfgknznxripagqncpd via the MCP connector.
-- Safe to run more than once.
-- ----------------------------------------------------------------------------

alter table public.uploaded_screenshots
  add column if not exists applied_at timestamptz;

-- Existing parsed readings were already auto-applied under the old behavior —
-- mark them handled so they don't reappear as pending after deploy.
update public.uploaded_screenshots
  set applied_at = coalesce(parsed_at, created_at)
  where applied_at is null
    and parsed_json is not null;
