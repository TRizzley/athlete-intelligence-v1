-- ----------------------------------------------------------------------------
-- Migration: WHOOP OAuth integration
--
-- whoop_tokens   one row per connected WHOOP user; stores OAuth tokens
--                needed to call the WHOOP API on their behalf
-- ----------------------------------------------------------------------------

create table if not exists public.whoop_tokens (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references public.users(id) on delete cascade,
  whoop_user_id   bigint      not null,
  access_token    text        not null,
  refresh_token   text        not null,
  expires_at      timestamptz not null,
  scope           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint whoop_tokens_user_unique   unique (user_id),
  constraint whoop_tokens_whoop_unique  unique (whoop_user_id)
);

drop trigger if exists set_updated_at on public.whoop_tokens;
create trigger set_updated_at before update on public.whoop_tokens
  for each row execute function public.set_updated_at();

-- RLS: users see only their own token row; service role bypasses for sync jobs
alter table public.whoop_tokens enable row level security;

drop policy if exists whoop_tokens_select on public.whoop_tokens;
create policy whoop_tokens_select on public.whoop_tokens for select
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists whoop_tokens_insert on public.whoop_tokens;
create policy whoop_tokens_insert on public.whoop_tokens for insert
  with check (user_id = auth.uid());

drop policy if exists whoop_tokens_update on public.whoop_tokens;
create policy whoop_tokens_update on public.whoop_tokens for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists whoop_tokens_delete on public.whoop_tokens;
create policy whoop_tokens_delete on public.whoop_tokens for delete
  using (user_id = auth.uid());
