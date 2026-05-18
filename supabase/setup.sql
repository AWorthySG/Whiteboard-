-- Run this in the Supabase SQL editor once per project.
-- It creates the public buckets the app needs and makes them readable by anyone.

insert into storage.buckets (id, name, public)
values
  ('whiteboard-assets', 'whiteboard-assets', true),
  ('whiteboard-snapshots', 'whiteboard-snapshots', false)
on conflict (id) do nothing;

-- Allow anyone to read assets (they're embedded directly in tldraw canvases).
do $$ begin
  drop policy if exists "Public read whiteboard-assets" on storage.objects;
  create policy "Public read whiteboard-assets"
    on storage.objects for select
    using ( bucket_id = 'whiteboard-assets' );
end $$;

-- Snapshots are only touched by the service-role key, which bypasses RLS, so
-- no public policy is needed for them.
