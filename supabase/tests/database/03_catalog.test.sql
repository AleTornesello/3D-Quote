begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'operator@test.local'),
  ('00000000-0000-4000-8000-0000000000a3', 'outsider@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Test Owner', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', 'Test Operator', 'operator');
insert into public.printers (id, name, model, build_x_mm, build_y_mm, build_z_mm, hourly_rate, power_w)
  overriding system value values (900001, 'Test MK4', 'Prusa MK4', 250, 210, 220, 1.50, 120);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (900001, 'Test PLA', 'PLA', 1.24, 25.00);
insert into public.clients (id, name)
  overriding system value values (900001, 'Test Client'), (900002, 'Second Client');

-- Signed in without a staff row
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from public.printers), 0, 'non-staff see no printers');
select is((select count(*)::int from public.materials), 0, 'non-staff see no materials');
select is((select count(*)::int from public.settings), 0, 'non-staff see no settings');
select is((select count(*)::int from public.clients), 0, 'non-staff see no clients');

-- Operator
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select ok(exists (select 1 from public.printers where id = 900001), 'operators see printers');
select ok(exists (select 1 from public.materials where id = 900001), 'operators see materials');
select is((select count(*)::int from public.settings), 1, 'operators see the settings row');
select throws_ok(
  $$insert into public.printers (name, model, build_x_mm, build_y_mm, build_z_mm, hourly_rate, power_w)
    values ('X', 'Y', 1, 1, 1, 1, 1)$$,
  '42501', null, 'operators cannot add printers'
);
select results_eq(
  $$with u as (update public.printers set hourly_rate = 0 where id = 900001 returning 1) select count(*)::int from u$$,
  $$values (0)$$,
  'operators cannot edit printers'
);
select results_eq(
  $$with u as (update public.settings set shop_name = 'Mine' returning 1) select count(*)::int from u$$,
  $$values (0)$$,
  'operators cannot edit settings'
);
select lives_ok(
  $$insert into public.clients (name, email) values ('New Client', 'new@example.com')$$,
  'operators can add clients'
);
select results_eq(
  $$with u as (update public.clients set phone = '123' where id = 900001 returning 1) select count(*)::int from u$$,
  $$values (1)$$,
  'operators can edit clients'
);
select results_eq(
  $$with d as (delete from public.clients where id = 900002 returning 1) select count(*)::int from d$$,
  $$values (0)$$,
  'operators cannot delete clients'
);

-- Owner
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$insert into public.materials (name, type, density_g_cm3, cost_per_kg) values ('Owner PETG', 'PETG', 1.27, 27)$$,
  'owners can add materials'
);
select results_eq(
  $$with u as (update public.printers set hourly_rate = 2 where id = 900001 returning 1) select count(*)::int from u$$,
  $$values (1)$$,
  'owners can edit printers'
);
select results_eq(
  $$with u as (update public.settings set shop_name = 'Test Shop' returning 1) select count(*)::int from u$$,
  $$values (1)$$,
  'owners can edit settings'
);
select results_eq(
  $$with d as (delete from public.clients where id = 900002 returning 1) select count(*)::int from d$$,
  $$values (1)$$,
  'owners can delete clients'
);
select throws_ok($$update public.settings set id = 2$$, '42501', null, 'the settings id cannot be changed');
select throws_ok(
  $$update public.settings set quote_prefix = 'Q-1'$$,
  '23514', null, 'the quote prefix is letters and digits only'
);
select throws_ok(
  $$insert into public.materials (name, type, density_g_cm3, cost_per_kg) values ('Wood', 'WOOD', 1, 1)$$,
  '23514', null, 'material types are a fixed list'
);
select throws_ok(
  $$insert into public.printers (name, model, build_x_mm, build_y_mm, build_z_mm, hourly_rate, power_w)
    values ('Zero', 'Z', 0, 1, 1, 1, 1)$$,
  '23514', null, 'the build volume must be positive'
);

reset role;
select throws_ok($$insert into public.settings (id) values (2)$$, '23514', null, 'settings has a single row');

select * from finish();
rollback;
