begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'operator@test.local'),
  ('00000000-0000-4000-8000-0000000000a3', 'outsider@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Test Owner', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', 'Test Operator', 'operator');
insert into public.printers (id, name, model, hourly_rate, power_w)
  overriding system value values (900001, 'Test MK4', 'Prusa MK4', 1.50, 120);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (900001, 'Test PLA', 'PLA', 1.24, 25.00);
insert into public.clients (id, name) overriding system value values (900001, 'Test Client');
insert into public.quotes (id, client_id, created_by) overriding system value values
  (900001, 900001, '00000000-0000-4000-8000-0000000000a1'),
  (900002, 900001, '00000000-0000-4000-8000-0000000000a1');
insert into public.quote_items (
  id, quote_id, model_path, original_filename, description, printer_id, material_id,
  print_time_s, filament_g, bbox_x_mm, bbox_y_mm, bbox_z_mm,
  material_cost, machine_cost, energy_cost, failure_cost, setup_fee, markup_amount, markup_pct,
  computed_total, priced_at
) overriding system value values
  (900001, 900001, '900001/a/part.stl', 'part.stl', 'Part', 900001, 900001, 3600, 25, 50, 40, 30,
   0.625, 1.5, 0.036, 0, 3, 2.06, 40, 10.00, now()),
  (900002, 900002, '900002/b/part.stl', 'part.stl', 'Part', 900001, 900001, 3600, 25, 50, 40, 30,
   0.625, 1.5, 0.036, 0, 3, 2.06, 40, 10.00, now());
insert into public.slicing_jobs (id, quote_item_id, status)
  overriding system value values (900001, 900001, 'succeeded');
update public.quotes set status = 'sent', sent_at = now(), vat_rate_pct = 22 where id = 900002;

-- Totals and overrides (as postgres)
select is((select item_total from public.quote_items where id = 900001), 10.00::numeric, 'item_total is the computed total');
select throws_ok(
  $$update public.quote_items set override_total = 12 where id = 900001$$,
  '23514', null, 'an override needs a reason'
);
update public.quote_items set override_total = 12, override_reason = 'Repeat customer' where id = 900001;
select is((select item_total from public.quote_items where id = 900001), 12.00::numeric, 'item_total is the override when set');

-- Operator
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select results_eq(
  $$with u as (update public.quote_items set description = 'Bracket' where id = 900001 returning 1) select count(*)::int from u$$,
  $$values (1)$$,
  'operators can edit the description of a draft item'
);
select results_eq(
  $$with u as (update public.quote_items set quantity = 3 where id = 900001 returning 1) select count(*)::int from u$$,
  $$values (1)$$,
  'operators can change the quantity of a draft item'
);
reset role;
select is((select computed_total from public.quote_items where id = 900001), null::numeric, 'changing the quantity clears the computed price');
select is((select item_total from public.quote_items where id = 900001), 12.00::numeric, 'and keeps the override');

set local role authenticated;
select throws_ok(
  $$update public.quote_items set computed_total = 1 where id = 900001$$,
  '42501', null, 'price columns cannot be written through the API'
);
select throws_ok(
  $$update public.quote_items set printer_id = null where id = 900001$$,
  '42501', null, 'slicing inputs change only through update_quote_item_settings'
);
select throws_ok(
  $$insert into public.quote_items (quote_id, model_path, original_filename, description)
    values (900001, '900001/x/y.stl', 'y.stl', 'y')$$,
  '42501', null, 'items are created only through create_quote_item'
);
select ok(exists (select 1 from public.slicing_jobs where id = 900001), 'staff can read slicing jobs');
select throws_ok(
  $$update public.slicing_jobs set status = 'failed' where id = 900001$$,
  '42501', null, 'slicing jobs are read-only through the API'
);
select results_eq(
  $$with u as (update public.quote_items set description = 'Late' where id = 900002 returning 1) select count(*)::int from u$$,
  $$values (0)$$,
  'items of a sent quote cannot be edited'
);
select results_eq(
  $$with d as (delete from public.quote_items where id = 900002 returning 1) select count(*)::int from d$$,
  $$values (0)$$,
  'items of a sent quote cannot be deleted'
);

-- Signed in without a staff row
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from public.quote_items), 0, 'non-staff see no items');
select is((select count(*)::int from public.slicing_jobs), 0, 'non-staff see no slicing jobs');

-- The service role bypasses RLS but not the freeze
set local role service_role;
set local request.jwt.claims to '{"role":"service_role"}';
select throws_ok(
  $$update public.quote_items set computed_total = 1 where id = 900002$$,
  'P0001', 'quote_not_draft', 'even the service role cannot reprice an item of a sent quote'
);
select throws_ok(
  $$delete from public.quote_items where id = 900002$$,
  'P0001', 'quote_not_draft', 'even the service role cannot delete an item of a sent quote'
);
select lives_ok(
  $$update public.quote_items set computed_total = 11 where id = 900001$$,
  'the service role can price draft items'
);

-- Operator removes an item from a draft
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select results_eq(
  $$with d as (delete from public.quote_items where id = 900001 returning 1) select count(*)::int from d$$,
  $$values (1)$$,
  'operators can remove items from a draft'
);

-- Deleting a draft quote takes its items and jobs with it
reset role;
insert into public.quote_items (id, quote_id, model_path, original_filename, description)
  overriding system value values (900003, 900001, '900001/c/part.stl', 'part.stl', 'Part');
insert into public.slicing_jobs (id, quote_item_id) overriding system value values (900003, 900003);
select lives_ok($$delete from public.quotes where id = 900001$$, 'a draft quote with items can be deleted');
select is((select count(*)::int from public.slicing_jobs where id = 900003), 0, 'its items and jobs are deleted with it');

-- Owner: printers in use stay
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$delete from public.printers where id = 900001$$, '23503', null, 'a printer used by an item cannot be deleted');

select * from finish();
rollback;
