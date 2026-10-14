begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email, last_sign_in_at) values
  ('00000000-0000-4000-8000-0000000000b1', 'owner.ls@test.local', now()),
  ('00000000-0000-4000-8000-0000000000b2', 'operator.ls@test.local', null),
  ('00000000-0000-4000-8000-0000000000b3', 'outsider.ls@test.local', null),
  ('00000000-0000-4000-8000-0000000000b4', 'inactive.ls@test.local', null);
insert into public.staff (user_id, display_name, role, active) values
  ('00000000-0000-4000-8000-0000000000b1', 'Ada Owner', 'owner', true),
  ('00000000-0000-4000-8000-0000000000b2', 'Bea Operator', 'operator', true),
  ('00000000-0000-4000-8000-0000000000b4', 'Cleo Inactive', 'owner', false);

-- Owner
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000b1","role":"authenticated"}';
select is(
  (select count(*)::int from public.list_staff()),
  (select count(*)::int from public.staff),
  'an owner gets every staff row'
);
select results_eq(
  $$select display_name, email, role, active from public.list_staff()
    where user_id in ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2',
                      '00000000-0000-4000-8000-0000000000b4')
    order by display_name$$,
  $$values ('Ada Owner'::text, 'owner.ls@test.local'::text, 'owner'::text, true),
           ('Bea Operator', 'operator.ls@test.local', 'operator', true),
           ('Cleo Inactive', 'inactive.ls@test.local', 'owner', false)$$,
  'rows carry the login email, role and active flag'
);
select is(
  array(select display_name from public.list_staff()),
  array(select display_name from public.staff order by display_name, user_id),
  'rows are ordered by display name'
);
select is(
  (select last_sign_in_at is not null from public.list_staff() where user_id = '00000000-0000-4000-8000-0000000000b1'),
  true,
  'a person who has signed in has a last sign-in time'
);
select is(
  (select last_sign_in_at from public.list_staff() where user_id = '00000000-0000-4000-8000-0000000000b2'),
  null::timestamptz,
  'a person who never signed in has none'
);

-- Operator
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000b2","role":"authenticated"}';
select throws_ok($$select * from public.list_staff()$$, '42501', 'owner_required', 'operators cannot list staff');

-- Signed in without a staff row
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000b3","role":"authenticated"}';
select throws_ok(
  $$select * from public.list_staff()$$, '42501', 'owner_required', 'users without a staff row cannot list staff'
);

-- Inactive owner
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000b4","role":"authenticated"}';
select throws_ok($$select * from public.list_staff()$$, '42501', 'owner_required', 'inactive owners cannot list staff');

-- Anonymous
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok($$select * from public.list_staff()$$, '42501', null, 'anon cannot call list_staff');
reset role;
select ok(
  not has_function_privilege('anon', 'private.list_staff()', 'execute'),
  'anon cannot execute the private function'
);

select * from finish();
rollback;
