-- Security: scope join_requests admission to the room's authenticated host.
--
-- The 20260525 security migration only tightened the UPDATE *role*; two
-- waiting-room bypasses remained (both let someone reach the live board and
-- the A/V call without the host's approval, because /api/sync-token and
-- /api/livekit/token trust "an admitted join_requests row exists"):
--
--   1. INSERT was `with check (true)`. The anon key ships in the client
--      bundle, so anyone who knows an 8-char room id could POST a brand-new
--      row { room_id, user_id: <self>, status: 'admitted' } to the REST API.
--   2. UPDATE was `to authenticated using (true)`: ANY signed-in account
--      could flip ANY row to 'admitted' — including their own pending knock.
--
-- Fix: authorize admission against room ownership. rooms.host_user_id is the
-- Supabase auth uid written by markAsHost(), so auth.uid() = host_user_id
-- means "the caller's session owns this room" (independent of the browser
-- wb_user_id stored in join_requests.user_id — a different namespace).
--
-- Still works: guests INSERT their own 'pending' knock; the signed-in host
-- self-admits and admits / denies / removes / re-admits; /api/invite/redeem
-- uses the service-role key (bypasses RLS).
-- Changes (accepted): a host who is NOT signed in can no longer admit
-- students, and can't self-admit into a NEW room (an existing admitted row
-- keeps working). The app now says "sign in" in both cases instead of
-- failing silently.
--
-- Reads stay public (KnockGate subscribes to its own row as a guest).

drop policy if exists "Public insert join_requests" on public.join_requests;
drop policy if exists "Insert join_requests" on public.join_requests;
create policy "Insert join_requests" on public.join_requests
  for insert
  with check (
    status = 'pending'
    or (select auth.uid()) = (
      select host_user_id from public.rooms where id = room_id
    )
  );

drop policy if exists "Public update join_requests" on public.join_requests;
drop policy if exists "Auth update join_requests" on public.join_requests;
drop policy if exists "Host update join_requests" on public.join_requests;
create policy "Host update join_requests" on public.join_requests
  for update
  to authenticated
  using (
    (select auth.uid()) = (
      select host_user_id from public.rooms where id = room_id
    )
  )
  with check (
    (select auth.uid()) = (
      select host_user_id from public.rooms where id = room_id
    )
  );
