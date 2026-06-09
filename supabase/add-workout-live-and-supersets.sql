-- ----------------------------------------------------------------------------
-- Migration: live/pending workouts + supersets — June 2026
--
-- workout_sessions.status     'in_progress' (pending, autosaving) until the
--                             athlete presses Save, then 'completed'. So an
--                             accidental close never loses data and the workout
--                             stays open to resume where they left off.
-- workout_sessions.completed_at  when Save finalized it.
-- workout_set_logs.superset_group  set logs sharing a value are a superset.
--
-- Ad-hoc "workout on the fly" sessions are just sessions with workout_day_id
-- null (no template) — no schema needed for that.
--
-- Applied to Supabase project dodfgknznxripagqncpd via the MCP connector.
-- Safe to run more than once.
-- ----------------------------------------------------------------------------

alter table public.workout_sessions
  add column if not exists status text not null default 'in_progress',
  add column if not exists completed_at timestamptz;

-- Existing sessions predate this feature and were effectively saved.
update public.workout_sessions
  set status = 'completed',
      completed_at = coalesce(updated_at, created_at)
  where status = 'in_progress';

alter table public.workout_set_logs
  add column if not exists superset_group text;
