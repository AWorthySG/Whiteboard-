-- Run this in the Supabase SQL editor once per project.
-- It creates the public bucket the app needs and lets anyone upload + read.

insert into storage.buckets (id, name, public)
values ('whiteboard-assets', 'whiteboard-assets', true)
on conflict (id) do nothing;

do $$ begin
  drop policy if exists "Public read whiteboard-assets" on storage.objects;
  create policy "Public read whiteboard-assets"
    on storage.objects for select
    using ( bucket_id = 'whiteboard-assets' );

  drop policy if exists "Public insert whiteboard-assets" on storage.objects;
  create policy "Public insert whiteboard-assets"
    on storage.objects for insert
    to anon, authenticated
    with check ( bucket_id = 'whiteboard-assets' );
end $$;
