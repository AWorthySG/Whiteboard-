-- Security: scope join_requests admission to the room's authenticated host.
--
-- Background — the 20260525120000 migration closed the *UPDATE* self-admit
-- path (required the `authenticated` role) but two holes remained:
--
--   1. INSERT was still `with check (true)`. Because the public anon key
--      ships in the client bundle, anyone who knows an 8-char room id could
--      POST a BRAND-NEW row `{ room_id, user_id: <self>, status: 'admitted' }`
--      straight to the Supabase REST API. It's a fresh (room_id, user_id)
--      key so there's no conflict and the INSERT succeeds — the guest is now
--      "admitted" without the host ever approving them, and /api/sync-token
--      + /api/livekit/token (which trust an admitted row) mint real tokens.
--
--   2. UPDATE was `to authenticated using (true)` — ANY authenticated user,
--      not just the host, could flip ANY row to 'admitted'. A guest who
--      signs up (username+password) could self-admit by updating their own
--      pending row.
--
-- Fix: authorize admission against the room's owner. `rooms.host_user_id`
-- is the Supabase auth uid written by markAsHost() when a signed-in host
-- creates/claims a room, so `auth.uid() = rooms.host_user_id` means "the
-- caller's session owns this room". This is independent of the browser
-- `wb_user_id` stored in join_requests.user_id (a different namespace).
--
-- What still works after this change:
--   - Guests INSERT their own knock row as 'pending' (the only status they
--     can self-assign).
--   - The signed-in host self-admits (INSERT 'admitted' for their own row)
--     and admits/denies guests (UPDATE), because auth.uid() = host_user_id.
--   - /api/invite/redeem uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
--
-- What breaks (unchanged from 20260525120000's accepted trade-off):
--   - A localStorage-only (never-signed-in) host can no longer self-admit
--     or admit students until they sign in and claim the room. The
--     AdmissionPanel now surfaces this with a toast instead of failing
--     silently. This is inherent: the server cannot distinguish a legit
--     unauthenticated host from an attacker — admission requires auth.

-- INSERT: guests may only create 'pending' rows; the room's authenticated
-- host may insert any status (their own self-admit row).
drop policy if exists "Public insert join_requests" on public.join_requests;
create policy "Insert join_requests" on public.join_requests
  for insert
  with check (
    status = 'pending'
    or auth.uid() = (
      select host_user_id from public.rooms where id = room_id
    )
  );

-- UPDATE: only the room's authenticated host may change a row (admit / deny
-- / remove / re-admit). Replaces the previous `to authenticated using (true)`
-- which let any signed-in user update any row.
drop policy if exists "Public update join_requests" on public.join_requests;
drop policy if exists "Auth update join_requests" on public.join_requests;
create policy "Host update join_requests" on public.join_requests
  for update
  to authenticated
  using (
    auth.uid() = (
      select host_user_id from public.rooms where id = room_id
    )
  )
  with check (
    auth.uid() = (
      select host_user_id from public.rooms where id = room_id
    )
  );
