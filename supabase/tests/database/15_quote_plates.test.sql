begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

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

-- Data copy of the quote_plates migration, run against fresh items: a complete item, an item with a material but
-- no filament weight, and an item with a zero print time.
insert into public.quotes (id, client_id, created_by) overriding system value values
  (930003, 930001, '00000000-0000-4000-8000-0000000000f1');
insert into public.quote_items (
  id, quote_id, model_path, original_filename, description, printer_id, material_id, print_time_s, filament_g
) overriding system value values
  (930101, 930003, '930003/a/a.stl', 'a.stl', 'Complete', 930001, 930001, 3600, 25),
  (930102, 930003, '930003/a/b.stl', 'b.stl', 'No grams', 930001, 930001, 3600, null),
  (930103, 930003, '930003/a/c.stl', 'c.stl', 'Zero time', 930001, null, 0, 10);

insert into public.quote_plates (
  id, quote_id, description, printer_id, print_time_s, quantity,
  material_cost, machine_cost, energy_cost, failure_cost, setup_fee, markup_amount, markup_pct,
  computed_total, override_total, override_reason, priced_at, created_at, updated_at
) overriding system value
select id, quote_id, description, printer_id, nullif(print_time_s, 0), quantity,
  material_cost, machine_cost, energy_cost, failure_cost, setup_fee, markup_amount, markup_pct,
  computed_total, override_total, override_reason, priced_at, created_at, updated_at
from public.quote_items where quote_id = 930003;
insert into public.quote_plate_materials (plate_id, material_id, grams, created_at, updated_at)
select id, material_id, filament_g, created_at, updated_at
from public.quote_items
where quote_id = 930003 and material_id is not null and filament_g > 0;

select is((select count(*)::int from public.quote_plates where quote_id = 930003), 3, 'every item becomes a plate');
select results_eq(
  $$select plate_id, grams from public.quote_plate_materials where plate_id between 930101 and 930103$$,
  $$values (930101::bigint, 25.00::numeric)$$,
  'only the item with a material and grams gets a material row'
);
select is(
  (select print_time_s from public.quote_plates where id = 930103), null::integer,
  'a zero print time becomes no print time'
);

select * from finish();
rollback;
