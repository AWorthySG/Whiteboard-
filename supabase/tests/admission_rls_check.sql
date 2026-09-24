-- Verifies the join_requests admission RLS (migration 20260924120000).
-- Run it in the SQL editor / Supabase MCP after applying the migration.
-- It changes NOTHING: every probe runs inside one DO block that ends by
-- raising an exception, so all probe rows are rolled back and the results
-- come back as that exception's message ("ADMISSION RLS CHECK: ...").
-- Each line reads PASS/FAIL <check> — every line should be PASS.
do $$
declare
  r record;
  n int;
  stranger uuid := gen_random_uuid();
  out text := '';
  probe_id uuid;
begin
  select id, host_user_id into r
  from public.rooms where host_user_id is not null
  order by updated_at desc limit 1;
  if r.id is null then raise exception 'no owned room to test against'; end if;

  -- 1. Anonymous guest inserts an ADMITTED row → must be refused.
  begin
    set local role anon;
    insert into public.join_requests (room_id, user_id, user_name, status)
      values (r.id, 'rls-probe-anon', 'probe', 'admitted');
    reset role;
    out := out || E'\nFAIL anon cannot self-insert admitted';
  exception when others then
    reset role;
    out := out || E'\n' || case when sqlstate = '42501' then 'PASS' else 'FAIL(' || sqlstate || ')' end
      || ' anon cannot self-insert admitted';
  end;

  -- 2. Anonymous guest knocks (pending) → must be allowed.
  begin
    set local role anon;
    insert into public.join_requests (room_id, user_id, user_name, status)
      values (r.id, 'rls-probe-knock', 'probe', 'pending') returning id into probe_id;
    reset role;
    out := out || E'\nPASS anon can knock (pending)';
  exception when others then
    reset role;
    out := out || E'\nFAIL anon can knock (pending): ' || sqlerrm;
  end;

  -- 3. Anonymous guest flips the knock to admitted → must affect 0 rows.
  set local role anon;
  update public.join_requests set status = 'admitted' where id = probe_id;
  get diagnostics n = row_count;
  reset role;
  out := out || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' anon cannot admit';

  -- 4. A signed-in account that does NOT own the room tries to admit → 0 rows.
  perform set_config('request.jwt.claims',
    json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.join_requests set status = 'admitted' where id = probe_id;
  get diagnostics n = row_count;
  reset role;
  out := out || E'\n' || case when n = 0 then 'PASS' else 'FAIL' end || ' non-owner account cannot admit';

  -- 5. Same stranger inserts an admitted row → must be refused.
  begin
    set local role authenticated;
    insert into public.join_requests (room_id, user_id, user_name, status)
      values (r.id, 'rls-probe-stranger', 'probe', 'admitted');
    reset role;
    out := out || E'\nFAIL non-owner cannot insert admitted';
  exception when others then
    reset role;
    out := out || E'\n' || case when sqlstate = '42501' then 'PASS' else 'FAIL(' || sqlstate || ')' end
      || ' non-owner cannot insert admitted';
  end;

  -- 6. The room's owner admits the knock → 1 row.
  perform set_config('request.jwt.claims',
    json_build_object('sub', r.host_user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.join_requests set status = 'admitted' where id = probe_id;
  get diagnostics n = row_count;
  reset role;
  out := out || E'\n' || case when n = 1 then 'PASS' else 'FAIL' end || ' owner can admit';

  -- 7. The owner self-admits (insert admitted) → allowed.
  begin
    set local role authenticated;
    insert into public.join_requests (room_id, user_id, user_name, status)
      values (r.id, 'rls-probe-owner', 'probe', 'admitted');
    reset role;
    out := out || E'\nPASS owner can self-admit';
  exception when others then
    reset role;
    out := out || E'\nFAIL owner can self-admit: ' || sqlerrm;
  end;

  raise exception 'ADMISSION RLS CHECK (all probe rows rolled back):%', out;
end $$;
