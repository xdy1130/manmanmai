create table if not exists public.app_state (
  id text primary key,
  user_id uuid,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_state
add column if not exists user_id uuid;

alter table public.app_state enable row level security;

drop policy if exists "app_state_select_anon" on public.app_state;
drop policy if exists "app_state_insert_anon" on public.app_state;
drop policy if exists "app_state_update_anon" on public.app_state;
drop policy if exists "app_state_select_own" on public.app_state;
drop policy if exists "app_state_insert_own" on public.app_state;
drop policy if exists "app_state_update_own" on public.app_state;
drop policy if exists "app_state_delete_own" on public.app_state;

create policy "app_state_select_own"
on public.app_state for select
to authenticated
using (user_id = auth.uid());

create policy "app_state_insert_own"
on public.app_state for insert
to authenticated
with check (user_id = auth.uid());

create policy "app_state_update_own"
on public.app_state for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "app_state_delete_own"
on public.app_state for delete
to authenticated
using (user_id = auth.uid());
