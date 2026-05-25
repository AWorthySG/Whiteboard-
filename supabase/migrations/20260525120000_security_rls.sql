-- Security: tighten UPDATE policies on join_requests and room_metadata.
--
-- Students join as unauthenticated guests (localStorage name only, no
-- Supabase auth session). Requiring the `authenticated` role to perform
-- UPDATE prevents them from self-admitting or seizing host controls
-- (leader mode, draw grant, timer) via the Supabase REST API with the
-- public anon key.
--
-- What still works after this change:
--   - Guests INSERT their own join_request row (public INSERT policy kept)
--   - Authenticated host admits/denies via AdmissionPanel (auth.uid() set)
--   - /api/invite/redeem uses SUPABASE_SERVICE_ROLE_KEY which bypasses RLS
--   - Authenticated host upserts/updates room_metadata for title,
--     leader_mode, draw_grant, timer (auth.uid() set)
--
-- What breaks for localStorage-only (unauthenticated) hosts:
--   - They can no longer admit/deny students or update room_metadata until
--     they sign in and claim the room. The UI still shows controls; writes
--     will silently fail with a console.error from useRoomMeta.

-- join_requests: drop open UPDATE, require auth
drop policy if exists "Public update join_requests" on public.join_requests;
create policy "Auth update join_requests" on public.join_requests
  for update to authenticated using (true);

-- room_metadata: drop open UPDATE, require auth
drop policy if exists "Public update room_metadata" on public.room_metadata;
create policy "Auth update room_metadata" on public.room_metadata
  for update to authenticated using (true);
