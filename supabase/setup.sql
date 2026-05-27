-- =================================================================
-- A Worthy Whiteboard — Supabase schema bootstrap
-- =================================================================
-- Run once on a fresh Supabase project (SQL editor). Idempotent —
-- safe to re-run; existing objects are preserved.
--
-- This file reflects the cumulative state of all production migrations
-- through 2026-05-21. New schema changes should ALSO be written to
-- supabase/migrations/<timestamp>_<name>.sql so the history stays
-- reproducible from git alone.

-- -----------------------------------------------------------------
-- Storage buckets
-- -----------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('whiteboard-assets', 'whiteboard-assets', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit)
values ('whiteboard-recordings', 'whiteboard-recordings', true, 5368709120)
on conflict (id) do nothing;

-- Storage policies. We intentionally do NOT grant a broad SELECT on
-- the public buckets — the public CDN path bypasses RLS so individual
-- object reads work, while anonymous LIST / filename enumeration
-- stays blocked.
drop policy if exists "Public insert whiteboard-assets" on storage.objects;
create policy "Public insert whiteboard-assets"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'whiteboard-assets');

drop policy if exists "Public insert whiteboard-recordings" on storage.objects;
create policy "Public insert whiteboard-recordings"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'whiteboard-recordings');

drop policy if exists "Public delete whiteboard-recordings" on storage.objects;
create policy "Public delete whiteboard-recordings"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'whiteboard-recordings');

-- -----------------------------------------------------------------
-- rooms — host-owned room metadata
-- -----------------------------------------------------------------
create table if not exists public.rooms (
  id text primary key,
  host_user_id uuid not null references auth.users(id) on delete cascade,
  host_email text,
  host_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists rooms_host_idx on public.rooms (host_user_id);
alter table public.rooms enable row level security;

drop policy if exists "Public read rooms" on public.rooms;
create policy "Public read rooms" on public.rooms for select using (true);

drop policy if exists "Authed insert own rooms" on public.rooms;
create policy "Authed insert own rooms" on public.rooms for insert
  to authenticated with check (host_user_id = (select auth.uid()));

drop policy if exists "Owner update rooms" on public.rooms;
create policy "Owner update rooms" on public.rooms for update
  to authenticated
  using (host_user_id = (select auth.uid()))
  with check (host_user_id = (select auth.uid()));

drop policy if exists "Owner delete rooms" on public.rooms;
create policy "Owner delete rooms" on public.rooms for delete
  to authenticated using (host_user_id = (select auth.uid()));

-- -----------------------------------------------------------------
-- room_metadata — per-room title + leader mode + draw grant
-- -----------------------------------------------------------------
create table if not exists public.room_metadata (
  room_id text primary key,
  title text,
  updated_at timestamptz default now(),
  leader_mode boolean not null default false,
  leader_user_id text,
  draw_grant_user_id text,
  -- Lesson timer (synced to all participants via realtime). See
  -- migration 20260524173814_room_timer.sql for the state model.
  timer_running boolean not null default false,
  timer_ends_at timestamptz,
  timer_remaining_ms integer,
  timer_duration_ms integer
);
alter table public.room_metadata enable row level security;
drop policy if exists "Public read room_metadata" on public.room_metadata;
create policy "Public read room_metadata" on public.room_metadata for select using (true);
drop policy if exists "Public upsert room_metadata" on public.room_metadata;
create policy "Public upsert room_metadata" on public.room_metadata for insert with check (true);
-- UPDATE restricted to authenticated users: students join as unauthenticated
-- guests and must not be able to seize leader mode, draw grant, or the timer
-- via the REST API. Authenticated hosts (signed-in users) can update freely.
drop policy if exists "Public update room_metadata" on public.room_metadata;
drop policy if exists "Auth update room_metadata" on public.room_metadata;
create policy "Auth update room_metadata" on public.room_metadata
  for update to authenticated using (true);

-- -----------------------------------------------------------------
-- room_documents — uploads visible in the Documents drawer
-- -----------------------------------------------------------------
create table if not exists public.room_documents (
  id uuid primary key default gen_random_uuid(),
  room_id text not null,
  name text not null,
  url text not null,
  mime_type text,
  uploaded_by_user_id text,
  uploaded_by_name text,
  uploaded_at timestamptz default now(),
  deleted_at timestamptz
);
create index if not exists room_documents_room_idx on public.room_documents (room_id, uploaded_at desc);
create index if not exists room_documents_room_deleted_idx on public.room_documents (room_id) where deleted_at is null;
alter table public.room_documents enable row level security;
drop policy if exists "Public read room_documents" on public.room_documents;
create policy "Public read room_documents" on public.room_documents for select using (true);
drop policy if exists "Public insert room_documents" on public.room_documents;
create policy "Public insert room_documents" on public.room_documents for insert with check (true);
drop policy if exists "Public delete room_documents" on public.room_documents;
create policy "Public delete room_documents" on public.room_documents for delete using (true);

-- -----------------------------------------------------------------
-- room_homework — homework assignments
-- -----------------------------------------------------------------
create table if not exists public.room_homework (
  id uuid primary key default gen_random_uuid(),
  room_id text not null,
  title text not null,
  description text,
  due_date date,
  created_by_user_id text,
  created_at timestamptz default now(),
  attachment_url text,
  attachment_name text
);
create index if not exists room_homework_room_idx on public.room_homework (room_id, created_at desc);
alter table public.room_homework enable row level security;
drop policy if exists "Public read room_homework" on public.room_homework;
create policy "Public read room_homework" on public.room_homework for select using (true);
drop policy if exists "Public insert room_homework" on public.room_homework;
create policy "Public insert room_homework" on public.room_homework for insert with check (true);
drop policy if exists "Public update room_homework" on public.room_homework;
create policy "Public update room_homework" on public.room_homework for update using (true);
drop policy if exists "Public delete room_homework" on public.room_homework;
create policy "Public delete room_homework" on public.room_homework for delete using (true);

-- -----------------------------------------------------------------
-- homework_submissions — student work + host feedback
-- -----------------------------------------------------------------
create table if not exists public.homework_submissions (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references public.room_homework(id) on delete cascade,
  room_id text not null,
  student_user_id text not null,
  student_name text not null,
  file_url text,
  file_name text,
  note text,
  submitted_at timestamptz default now(),
  feedback text,
  feedback_at timestamptz
);
create index if not exists homework_submissions_homework_id_idx on public.homework_submissions (homework_id);
create index if not exists homework_submissions_room_idx on public.homework_submissions (room_id, submitted_at desc);
alter table public.homework_submissions enable row level security;
drop policy if exists "Public read homework_submissions" on public.homework_submissions;
create policy "Public read homework_submissions" on public.homework_submissions for select using (true);
drop policy if exists "Public insert homework_submissions" on public.homework_submissions;
create policy "Public insert homework_submissions" on public.homework_submissions for insert with check (true);
drop policy if exists "Public delete homework_submissions" on public.homework_submissions;
create policy "Public delete homework_submissions" on public.homework_submissions for delete using (true);

-- -----------------------------------------------------------------
-- room_messages — compact chat log
-- -----------------------------------------------------------------
create table if not exists public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id text not null,
  user_id text not null,
  user_name text not null,
  text text not null,
  created_at timestamptz default now()
);
create index if not exists room_messages_room_idx on public.room_messages (room_id, created_at);
alter table public.room_messages enable row level security;
drop policy if exists "Public read room_messages" on public.room_messages;
create policy "Public read room_messages" on public.room_messages for select using (true);
drop policy if exists "Public insert room_messages" on public.room_messages;
create policy "Public insert room_messages" on public.room_messages for insert with check (true);
drop policy if exists "Public delete room_messages" on public.room_messages;
create policy "Public delete room_messages" on public.room_messages for delete using (true);

-- -----------------------------------------------------------------
-- room_recordings — lesson recording metadata
-- -----------------------------------------------------------------
create table if not exists public.room_recordings (
  id uuid primary key default gen_random_uuid(),
  room_id text not null,
  title text,
  file_url text not null,
  file_path text not null,
  mime_type text,
  size_bytes bigint,
  duration_sec integer,
  host_user_id text,
  host_name text,
  recorded_at timestamptz default now(),
  frames_url text
);
create index if not exists room_recordings_room_idx on public.room_recordings (room_id, recorded_at desc);
alter table public.room_recordings enable row level security;
drop policy if exists "Public read room_recordings" on public.room_recordings;
create policy "Public read room_recordings" on public.room_recordings for select using (true);
drop policy if exists "Public insert room_recordings" on public.room_recordings;
create policy "Public insert room_recordings" on public.room_recordings for insert with check (true);
drop policy if exists "Public delete room_recordings" on public.room_recordings;
create policy "Public delete room_recordings" on public.room_recordings for delete using (true);

-- -----------------------------------------------------------------
-- join_requests — knock/admission flow
-- -----------------------------------------------------------------
create table if not exists public.join_requests (
  id uuid primary key default gen_random_uuid(),
  room_id text not null,
  user_id text not null,
  user_name text not null,
  status text not null default 'pending',
  requested_at timestamptz default now(),
  decided_at timestamptz,
  unique (room_id, user_id)
);
create index if not exists join_requests_room_idx on public.join_requests (room_id, status, requested_at);
alter table public.join_requests enable row level security;
drop policy if exists "Public read join_requests" on public.join_requests;
create policy "Public read join_requests" on public.join_requests for select using (true);
drop policy if exists "Public insert join_requests" on public.join_requests;
create policy "Public insert join_requests" on public.join_requests for insert with check (true);
-- UPDATE restricted to authenticated users: prevents unauthenticated guests
-- from self-admitting via the REST API. /api/invite/redeem uses the
-- service_role key (bypasses RLS) for magic-link auto-admission.
drop policy if exists "Public update join_requests" on public.join_requests;
drop policy if exists "Auth update join_requests" on public.join_requests;
create policy "Auth update join_requests" on public.join_requests
  for update to authenticated using (true);

-- -----------------------------------------------------------------
-- room_templates — a host's private, account-scoped library of
-- reusable board layouts (one tldraw TLContent blob per template).
-- Owner-only: unlike the other app tables there is no public read,
-- and it's intentionally NOT in the realtime publication below.
-- -----------------------------------------------------------------
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

-- -----------------------------------------------------------------
-- Realtime publication — all app tables broadcast change events
-- -----------------------------------------------------------------
do $$
declare
  t text;
  app_tables text[] := array[
    'rooms', 'room_metadata', 'room_documents',
    'room_homework', 'homework_submissions',
    'room_messages', 'room_recordings', 'join_requests'
  ];
begin
  foreach t in array app_tables loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      -- already in publication, ignore
      null;
    end;
  end loop;
end $$;
