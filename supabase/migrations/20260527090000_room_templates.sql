-- room_templates — a host's private, account-scoped library of reusable
-- board layouts. A template stores a tldraw TLContent blob (the shapes,
-- assets and bindings of one page) so the host can save a prepared page
-- once and drop it into any room later. Owner-only: not shared with
-- students, not room-scoped.

create table if not exists public.room_templates (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  content jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists room_templates_owner_idx
  on public.room_templates (owner_user_id, created_at desc);

alter table public.room_templates enable row level security;

-- Owner-only across the board (templates are a private library, so unlike
-- the other app tables there is no public read).
drop policy if exists "Owner read room_templates" on public.room_templates;
create policy "Owner read room_templates" on public.room_templates for select
  to authenticated using (owner_user_id = (select auth.uid()));

drop policy if exists "Owner insert room_templates" on public.room_templates;
create policy "Owner insert room_templates" on public.room_templates for insert
  to authenticated with check (owner_user_id = (select auth.uid()));

drop policy if exists "Owner update room_templates" on public.room_templates;
create policy "Owner update room_templates" on public.room_templates for update
  to authenticated
  using (owner_user_id = (select auth.uid()))
  with check (owner_user_id = (select auth.uid()));

drop policy if exists "Owner delete room_templates" on public.room_templates;
create policy "Owner delete room_templates" on public.room_templates for delete
  to authenticated using (owner_user_id = (select auth.uid()));
