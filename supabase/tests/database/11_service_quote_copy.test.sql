begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'owner.copy@test.local'),
  ('00000000-0000-4000-8000-0000000000c2', 'operator.copy@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000c1', 'Copy Owner', 'owner'),
  ('00000000-0000-4000-8000-0000000000c2', 'Copy Operator', 'operator');
insert into public.printers (id, name, model, hourly_rate, power_w)
  overriding system value values (910001, 'Copy MK4', 'Prusa MK4', 1.50, 120);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (910001, 'Copy PETG', 'PETG', 1.27, 25.00);
insert into public.clients (id, name) overriding system value values (910001, 'Copy Client');
insert into public.quotes (id, client_id, created_by, notes, markup_override_pct) overriding system value values
  (910001, 910001, '00000000-0000-4000-8000-0000000000c1', 'Rush job', 12.50);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg, active)
  overriding system value values (910002, 'Copy TPU', 'TPU', 1.21, 40.00, true);
insert into public.quote_plates (id, quote_id, description, printer_id, print_time_s, quantity)
overriding system value values
  (910101, 910001, 'Full plate', 910001, 19800, 3),
  (910102, 910001, 'Printer only', 910001, null, 1),
  (910103, 910001, 'Bare plate', null, null, 1);
insert into public.quote_plate_materials (plate_id, material_id, grams) values
  (910101, 910001, 120.00),
  (910101, 910002, 15.50);
-- Priced after the material rows, whose inserts clear the price.
update public.quote_plates
  set material_cost = 3.0000, computed_total = 39.24, markup_pct = 30.00, priced_at = now(),
      override_total = 50.00, override_reason = 'Agreed price'
  where id = 910101;
update public.quotes set status = 'sent', sent_at = now(), vat_rate_pct = 22 where id = 910001;
-- A material retired after the quote was sent is still copied: inactive is only refused when adding.
update public.materials set active = false where id = 910002;

-- Privileges
select is(
  array(
    select f from unnest(array[
      'public.service_create_quote_copy(bigint,uuid)',
      'private.service_create_quote_copy(bigint,uuid)',
      'public.service_copy_quote_plates(bigint,bigint)',
      'private.service_copy_quote_plates(bigint,bigint)'
    ]) as f
    where has_function_privilege('authenticated', f, 'execute')
  ),
  array[]::text[],
  'authenticated cannot execute the service functions'
);
select ok(
  has_function_privilege('service_role', 'public.service_create_quote_copy(bigint,uuid)', 'execute')
    and has_function_privilege('service_role', 'public.service_copy_quote_plates(bigint,bigint)', 'execute'),
  'the service role can execute them'
);

-- Creating the copy
set local role service_role;
select lives_ok(
  $$select public.service_create_quote_copy(910001, '00000000-0000-4000-8000-0000000000c2')$$,
  'the service role creates a copy of a sent quote'
);
select throws_ok(
  $$select public.service_create_quote_copy(999999999, '00000000-0000-4000-8000-0000000000c1')$$,
  'P0002', 'quote_not_found', 'an unknown source is rejected'
);
reset role;

select results_eq(
  $$select status, client_id, notes, markup_override_pct, created_by, valid_until, sent_at
    from public.quotes where client_id = 910001 and id <> 910001$$,
  $$select 'draft'::text, 910001::bigint, 'Rush job'::text, 12.50::numeric,
           '00000000-0000-4000-8000-0000000000c2'::uuid,
           private.shop_today() + (select default_validity_days from public.settings where id = 1),
           null::timestamptz$$,
  'the copy is a draft with the client, notes, markup and creator, and the default validity'
);
select isnt(
  (select number from public.quotes where client_id = 910001 and id <> 910001),
  (select number from public.quotes where id = 910001),
  'the copy gets its own number'
);

-- Copying the plates
set local role service_role;
select throws_ok(
  $$select public.service_copy_quote_plates(910001, 910001)$$,
  'P0001', 'quote_not_draft', 'the target must be a draft'
);
select lives_ok(
  $$select public.service_copy_quote_plates(910001, c.id)
    from public.quotes c where c.client_id = 910001 and c.id <> 910001$$,
  'the service role copies the plates'
);
reset role;

select results_eq(
  $$select description, printer_id, print_time_s, quantity, override_total, override_reason
    from public.quote_plates
    where quote_id = (select id from public.quotes where client_id = 910001 and id <> 910001)
    order by id$$,
  $$select description, printer_id, print_time_s, quantity, override_total, override_reason
    from public.quote_plates where quote_id = 910001 order by id$$,
  'plates carry their inputs and overrides, in the source order'
);
select results_eq(
  $$select p.description, m.material_id, m.grams
    from public.quote_plate_materials m
    join public.quote_plates p on p.id = m.plate_id
    where p.quote_id = (select id from public.quotes where client_id = 910001 and id <> 910001)
    order by m.material_id$$,
  $$values ('Full plate'::text, 910001::bigint, 120.00::numeric), ('Full plate', 910002, 15.50)$$,
  'material rows are copied, an inactive material included'
);
select is(
  (select count(*)::int from public.quote_plates
   where quote_id = (select id from public.quotes where client_id = 910001 and id <> 910001)
     and (material_cost is not null or computed_total is not null or markup_pct is not null or priced_at is not null)),
  0,
  'the price breakdown is not copied'
);
select is(
  (select count(*)::int from public.quote_plate_materials m
   join public.quote_plates p on p.id = m.plate_id where p.quote_id = 910001),
  2,
  'the source keeps its material rows'
);

select * from finish();
rollback;
