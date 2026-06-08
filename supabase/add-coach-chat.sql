-- ----------------------------------------------------------------------------
-- Migration: coach chat (two-way messages between athlete and coach) — June 2026
--
-- A standalone, free-form conversation. The athlete sends a message; the AI
-- coach replies (inserted via the service role, since RLS forbids an athlete
-- from writing a 'coach' row). A human coach can also reply from the admin.
--
-- Safe to run more than once.
-- ----------------------------------------------------------------------------

create table if not exists public.coach_messages (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  role         text not null check (role in ('athlete', 'coach')),
  body         text not null,
  ai_generated boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists idx_coach_messages_user
  on public.coach_messages (user_id, created_at);

alter table public.coach_messages enable row level security;

-- Read your own conversation (admins see all).
drop policy if exists coach_messages_select on public.coach_messages;
create policy coach_messages_select on public.coach_messages for select
  using (user_id = auth.uid() or public.is_admin());

-- Athletes may only post their own 'athlete' messages. Coach replies are
-- written with the service role (bypasses RLS) or by an admin.
drop policy if exists coach_messages_insert on public.coach_messages;
create policy coach_messages_insert on public.coach_messages for insert
  with check (
    (user_id = auth.uid() and role = 'athlete') or public.is_admin()
  );
