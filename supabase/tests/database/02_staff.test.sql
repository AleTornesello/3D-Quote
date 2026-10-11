begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- Fixtures. The seed owner is demoted so the test owner is the only active owner.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'operator@test.local'),
  ('00000000-0000-4000-8000-0000000000a3', 'outsider@test.local'),
  ('00000000-0000-4000-8000-0000000000a4', 'inactive@test.local'),
  ('00000000-0000-4000-8000-0000000000a5', 'newcomer@test.local');
insert into public.staff (user_id, display_name, role, active) values
  ('00000000-0000-4000-8000-0000000000a1', 'Test Owner', 'owner', true),
  ('00000000-0000-4000-8000-0000000000a2', 'Test Operator', 'operator', true),
  ('00000000-0000-4000-8000-0000000000a4', 'Test Inactive', 'operator', false);
update public.staff set role = 'operator'
where role = 'owner' and user_id <> '00000000-0000-4000-8000-0000000000a1';

-- Anonymous
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok($$select count(*) from public.staff$$, '42501', null, 'anon cannot read staff');

-- Signed in without a staff row
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from public.staff), 0, 'a user without a staff row sees no staff');

-- Inactive staff
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a4","role":"authenticated"}';
select is((select count(*)::int from public.staff), 0, 'inactive staff see no staff');

-- Operator
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select ok((select count(*) from public.staff) >= 3, 'operators see all staff');
select lives_ok(
  $$update public.staff set display_name = 'Renamed', language = 'en'
    where user_id = '00000000-0000-4000-8000-0000000000a2'$$,
  'operators can change their own name and language'
);
select is(
  (select language from public.staff where user_id = '00000000-0000-4000-8000-0000000000a2'),
  'en',
  'the language change is saved'
);
select throws_ok(
  $$update public.staff set role = 'owner' where user_id = '00000000-0000-4000-8000-0000000000a2'$$,
  '42501', 'owner_required', 'operators cannot change their own role'
);
select results_eq(
  $$with u as (
      update public.staff set display_name = 'Hacked'
      where user_id = '00000000-0000-4000-8000-0000000000a1' returning 1
    ) select count(*)::int from u$$,
  $$values (0)$$,
  'operators cannot edit other staff'
);
select throws_ok(
  $$insert into public.staff (user_id, display_name) values ('00000000-0000-4000-8000-0000000000a5', 'New')$$,
  '42501', null, 'operators cannot add staff'
);
select throws_ok(
  $$update public.staff set user_id = '00000000-0000-4000-8000-0000000000a5'
    where user_id = '00000000-0000-4000-8000-0000000000a2'$$,
  '42501', null, 'user_id cannot be changed through the API'
);
select throws_ok(
  $$delete from public.staff where user_id = '00000000-0000-4000-8000-0000000000a2'$$,
  '42501', null, 'staff rows cannot be deleted through the API'
);

-- Owner
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$update public.staff set role = 'operator' where user_id = '00000000-0000-4000-8000-0000000000a1'$$,
  'P0001', 'last_owner', 'the last owner cannot demote themselves'
);
select throws_ok(
  $$update public.staff set active = false where user_id = '00000000-0000-4000-8000-0000000000a1'$$,
  'P0001', 'last_owner', 'the last owner cannot deactivate themselves'
);
select lives_ok(
  $$insert into public.staff (user_id, display_name) values ('00000000-0000-4000-8000-0000000000a5', 'Newcomer')$$,
  'owners can add staff'
);
select lives_ok(
  $$update public.staff set role = 'owner' where user_id = '00000000-0000-4000-8000-0000000000a2'$$,
  'owners can promote an operator'
);
select lives_ok(
  $$update public.staff set role = 'operator' where user_id = '00000000-0000-4000-8000-0000000000a1'$$,
  'an owner can step down while another owner remains'
);

-- Database level: the last active owner (now the former operator) cannot be deleted either
reset role;
select throws_ok(
  $$delete from public.staff where user_id = '00000000-0000-4000-8000-0000000000a2'$$,
  'P0001', 'last_owner', 'the last active owner cannot be deleted'
);

select * from finish();
rollback;
