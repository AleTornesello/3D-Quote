begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000f1', 'op.plates@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000f1', 'Plate Operator', 'operator');
insert into public.printers (id, name, model, hourly_rate, power_w)
  overriding system value values (930001, 'Plate MK4', 'Prusa MK4', 1.50, 120);
insert into public.printers (id, name, model, hourly_rate, power_w, active)
  overriding system value values (930002, 'Old printer', 'Old', 1.50, 120, false);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (930001, 'Plate PLA', 'PLA', 1.24, 25.00), (930002, 'Plate PETG', 'PETG', 1.27, 30.00);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg, active)
  overriding system value values (930003, 'Old PLA', 'PLA', 1.24, 20.00, false);
insert into public.clients (id, name) overriding system value values (930001, 'Plate Client');
insert into public.quotes (id, client_id, created_by) overriding system value values
  (930001, 930001, '00000000-0000-4000-8000-0000000000f1'),
  (930002, 930001, '00000000-0000-4000-8000-0000000000f1');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}';

-- Creation
select lives_ok($$select public.create_quote_plate(930001, 'Plate A')$$, 'staff can create a plate in a draft quote');
select results_eq(
  $$select printer_id, print_time_s, quantity from public.quote_plates where quote_id = 930001$$,
  $$values (null::bigint, null::integer, 1)$$,
  'a new plate has no printer or print time and quantity 1'
);
select throws_ok($$select public.create_quote_plate(930001, '  ')$$, '22023', null, 'the description is required');
select throws_ok($$select public.create_quote_plate(930001, 'X', 930002)$$, '22023', 'printer_inactive', 'an inactive printer is refused');

-- Printer and materials
select lives_ok(
  $$select public.set_plate_printer((select id from public.quote_plates where quote_id = 930001), 930001)$$,
  'a printer can be chosen'
);
select lives_ok(
  $$select public.save_plate_material((select id from public.quote_plates where quote_id = 930001), 930001, 12.5)$$,
  'a material with grams can be added'
);
select lives_ok(
  $$select public.save_plate_material((select id from public.quote_plates where quote_id = 930001), 930001, 20)$$,
  'saving the same material again updates its grams'
);
select results_eq(
  $$select material_id, grams from public.quote_plate_materials m
    join public.quote_plates p on p.id = m.plate_id where p.quote_id = 930001$$,
  $$values (930001::bigint, 20.00::numeric)$$,
  'there is still one row for that material'
);
select throws_ok(
  $$select public.save_plate_material((select id from public.quote_plates where quote_id = 930001), 930002, 0)$$,
  '22023', 'invalid_grams', 'grams must be above zero'
);
select throws_ok(
  $$select public.save_plate_material((select id from public.quote_plates where quote_id = 930001), 930003, 5)$$,
  '22023', 'material_inactive', 'an inactive material is refused'
);
select throws_ok(
  $$select public.save_plate_material(-1, 930001, 5)$$,
  'P0002', 'plate_not_found', 'an unknown plate is reported'
);

-- Price invalidation (as postgres: the price columns are not writable by staff)
reset role;
update public.quote_plates set computed_total = 9.99, material_cost = 1, priced_at = now(), print_time_s = 3600
  where quote_id = 930001;
select is(
  (select computed_total from public.quote_plates where quote_id = 930001), null::numeric,
  'changing the print time clears the computed price'
);
update public.quote_plates set computed_total = 9.99, priced_at = now() where quote_id = 930001;
insert into public.quote_plate_materials (plate_id, material_id, grams)
  select id, 930002, 5 from public.quote_plates where quote_id = 930001;
select is(
  (select computed_total from public.quote_plates where quote_id = 930001), null::numeric,
  'adding a material clears the computed price'
);
update public.quote_plates set computed_total = 9.99, priced_at = now() where quote_id = 930001;
delete from public.quote_plate_materials where material_id = 930002;
select is(
  (select computed_total from public.quote_plates where quote_id = 930001), null::numeric,
  'removing a material clears the computed price'
);
update public.quote_plates set override_total = 5, override_reason = 'x' where quote_id = 930001;
update public.quote_plates set quantity = 2 where quote_id = 930001;
select is(
  (select override_total from public.quote_plates where quote_id = 930001), 5.00::numeric,
  'the override survives a change'
);

-- Constraints
select throws_ok(
  $$insert into public.quote_plate_materials (plate_id, material_id, grams)
    select id, 930001, 1 from public.quote_plates where quote_id = 930001$$,
  '23505', null, 'a material appears once per plate'
);
select throws_ok(
  $$update public.quote_plates set print_time_s = 0 where quote_id = 930001$$,
  '23514', null, 'print time must be above zero'
);

-- Non-draft quotes are frozen
do $$ begin perform public.create_quote_plate(930002, 'Frozen'); end $$;
update public.quotes set status = 'sent', sent_at = now(), vat_rate_pct = 22 where id = 930002;
select throws_ok(
  $$update public.quote_plates set quantity = 3 where quote_id = 930002$$,
  'P0001', 'quote_not_draft', 'a plate of a sent quote cannot change'
);
select throws_ok(
  $$insert into public.quote_plate_materials (plate_id, material_id, grams)
    select id, 930001, 1 from public.quote_plates where quote_id = 930002$$,
  'P0001', 'quote_not_draft', 'nor can its materials'
);

-- Totals, column grants and RLS
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000f3', 'outsider.plates@test.local');
insert into public.quotes (id, client_id, created_by) overriding system value values
  (930011, 930001, '00000000-0000-4000-8000-0000000000f1'),
  (930012, 930001, '00000000-0000-4000-8000-0000000000f1');
insert into public.quote_plates (id, quote_id, description, printer_id, print_time_s) overriding system value values
  (930011, 930011, 'Part', 930001, 3600),
  (930012, 930012, 'Part', 930001, 3600);
insert into public.quote_plate_materials (id, plate_id, material_id, grams) overriding system value values
  (930011, 930011, 930001, 25),
  (930012, 930012, 930001, 25);
update public.quote_plates set computed_total = 10.00, priced_at = now() where id in (930011, 930012);
update public.quotes set status = 'sent', sent_at = now(), vat_rate_pct = 22 where id = 930012;

select is((select plate_total from public.quote_plates where id = 930011), 10.00::numeric, 'plate_total is the computed total');
select throws_ok(
  $$update public.quote_plates set override_total = 12 where id = 930011$$,
  '23514', null, 'an override needs a reason'
);
update public.quote_plates set override_total = 12, override_reason = 'Repeat customer' where id = 930011;
select is((select plate_total from public.quote_plates where id = 930011), 12.00::numeric, 'plate_total is the override when set');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}';
select results_eq(
  $$with u as (update public.quote_plates set description = 'Bracket' where id = 930011 returning 1) select count(*)::int from u$$,
  $$values (1)$$,
  'operators can edit the description of a draft plate'
);
select results_eq(
  $$with u as (update public.quote_plates set print_time_s = 7200 where id = 930011 returning 1) select count(*)::int from u$$,
  $$values (1)$$,
  'operators can change the print time of a draft plate'
);
select results_eq(
  $$with u as (update public.quote_plate_materials set grams = 30 where id = 930011 returning 1) select count(*)::int from u$$,
  $$values (1)$$,
  'operators can change the grams of a material row'
);
select throws_ok(
  $$update public.quote_plates set computed_total = 1 where id = 930011$$,
  '42501', null, 'price columns cannot be written through the API'
);
select throws_ok(
  $$update public.quote_plates set printer_id = null where id = 930011$$,
  '42501', null, 'the printer changes only through set_plate_printer'
);
select throws_ok(
  $$insert into public.quote_plates (quote_id, description) values (930011, 'y')$$,
  '42501', null, 'plates are created only through create_quote_plate'
);
select throws_ok(
  $$insert into public.quote_plate_materials (plate_id, material_id, grams) values (930011, 930002, 1)$$,
  '42501', null, 'material rows are added only through save_plate_material'
);
select results_eq(
  $$with u as (update public.quote_plates set description = 'Late' where id = 930012 returning 1) select count(*)::int from u$$,
  $$values (0)$$,
  'plates of a sent quote cannot be edited'
);
select results_eq(
  $$with d as (delete from public.quote_plate_materials where id = 930012 returning 1) select count(*)::int from d$$,
  $$values (0)$$,
  'material rows of a sent quote cannot be deleted'
);
select results_eq(
  $$with d as (delete from public.quote_plates where id = 930012 returning 1) select count(*)::int from d$$,
  $$values (0)$$,
  'plates of a sent quote cannot be deleted'
);

-- Signed in without a staff row
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000f3","role":"authenticated"}';
select is((select count(*)::int from public.quote_plates), 0, 'non-staff see no plates');
select is((select count(*)::int from public.quote_plate_materials), 0, 'non-staff see no material rows');

-- The service role bypasses RLS but not the freeze
set local role service_role;
set local request.jwt.claims to '{"role":"service_role"}';
select throws_ok(
  $$update public.quote_plates set computed_total = 1 where id = 930012$$,
  'P0001', 'quote_not_draft', 'even the service role cannot reprice a plate of a sent quote'
);
select throws_ok(
  $$delete from public.quote_plates where id = 930012$$,
  'P0001', 'quote_not_draft', 'even the service role cannot delete a plate of a sent quote'
);
select lives_ok(
  $$update public.quote_plates set computed_total = 11 where id = 930011$$,
  'the service role can price draft plates'
);

-- Operator removes a material row and a plate from a draft
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}';
select results_eq(
  $$with d as (delete from public.quote_plate_materials where id = 930011 returning 1) select count(*)::int from d$$,
  $$values (1)$$,
  'operators can remove a material row from a draft plate'
);
select results_eq(
  $$with d as (delete from public.quote_plates where id = 930011 returning 1) select count(*)::int from d$$,
  $$values (1)$$,
  'operators can remove plates from a draft'
);

-- Deleting a draft quote takes its plates and material rows with it; catalog rows in use stay
reset role;
insert into public.quote_plates (id, quote_id, description) overriding system value values (930013, 930011, 'Part');
insert into public.quote_plate_materials (id, plate_id, material_id, grams)
  overriding system value values (930013, 930013, 930001, 5);
select lives_ok($$delete from public.quotes where id = 930011$$, 'a draft quote with plates can be deleted');
select is(
  (select count(*)::int from public.quote_plate_materials where id = 930013), 0,
  'its plates and material rows are deleted with it'
);
select throws_ok($$delete from public.printers where id = 930001$$, '23503', null, 'a printer used by a plate cannot be deleted');
select throws_ok($$delete from public.materials where id = 930001$$, '23503', null, 'a material used by a plate cannot be deleted');

select * from finish();
rollback;
