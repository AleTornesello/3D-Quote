begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'operator@test.local'),
  ('00000000-0000-4000-8000-0000000000a3', 'outsider@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Test Owner', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', 'Test Operator', 'operator');
insert into public.printers (id, name, model, hourly_rate, power_w, active)
  overriding system value values
  (900001, 'Test MK4', 'Prusa MK4', 1.50, 120, true),
  (900002, 'Old MK3', 'Prusa MK3', 1.00, 100, true);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (900001, 'Test PLA', 'PLA', 1.24, 25.00);
insert into public.clients (id, name) overriding system value values (900001, 'Test Client');
insert into public.quotes (id, client_id, created_by) overriding system value values
  (900001, 900001, '00000000-0000-4000-8000-0000000000a1'),
  (900002, 900001, '00000000-0000-4000-8000-0000000000a1');
-- Plate 900002 belongs to the quote that is sent below.
insert into public.quote_plates (id, quote_id, description, printer_id, print_time_s) overriding system value values
  (900001, 900001, 'No printer', null, 3600),
  (900002, 900002, 'Sent', 900002, 3600);
insert into public.quote_plate_materials (plate_id, material_id, grams) values (900001, 900001, 10), (900002, 900001, 10);
update public.quotes set status = 'sent', sent_at = now(), vat_rate_pct = 22 where id = 900002;
-- The printer of the sent plate is retired afterwards.
update public.printers set active = false where id = 900002;

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';

-- Send blockers, one plate at a time
select results_eq(
  $$select quote_plate_id, code from public.get_quote_send_blockers(900001)$$,
  $$values (900001::bigint, 'plate_incomplete'::text)$$,
  'a plate without a printer is incomplete'
);
select lives_ok($$select public.set_plate_printer(900001, 900001)$$, 'staff can choose a printer');
select results_eq(
  $$select quote_plate_id, code from public.get_quote_send_blockers(900001)$$,
  $$values (900001::bigint, 'not_priced'::text)$$,
  'a complete plate without a price is not priced'
);
reset role;
update public.quote_plates set computed_total = 10, priced_at = now() where id = 900001;
set local role authenticated;
select is_empty($$select * from public.get_quote_send_blockers(900001)$$, 'a complete priced plate blocks nothing');
select lives_ok($$select public.set_plate_printer(900001, 900001)$$, 'choosing the same printer again is accepted');
select isnt(
  (select computed_total from public.quote_plates where id = 900001), null,
  'and keeps the price'
);
select throws_ok(
  $$select public.set_plate_printer(900001, 900002)$$,
  '22023', 'printer_inactive', 'an inactive printer cannot be chosen'
);
select throws_ok(
  $$select public.set_plate_printer(-1, 900001)$$,
  'P0002', 'plate_not_found', 'an unknown plate is reported'
);

-- Sent quotes are frozen
select throws_ok(
  $$select public.create_quote_plate(900002, 'Late')$$,
  'P0001', 'quote_not_draft', 'plates can only be added to drafts'
);
select throws_ok(
  $$select public.set_plate_printer(900002, 900001)$$,
  'P0001', 'quote_not_draft', 'the printer of a sent plate cannot change'
);
select throws_ok(
  $$select public.save_plate_material(900002, 900001, 20)$$,
  'P0001', 'quote_not_draft', 'nor its materials'
);

-- The plate is gone: the quote has no plates
reset role;
delete from public.quote_plates where id = 900001;
set local role authenticated;
select results_eq(
  $$select quote_plate_id, code from public.get_quote_send_blockers(900001)$$,
  $$values (null::bigint, 'no_plates'::text)$$,
  'a quote without plates cannot be sent'
);

-- Access
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$select public.create_quote_plate(900001, 'Plate')$$,
  '42501', 'not_staff', 'non-staff cannot add plates'
);
select throws_ok(
  $$select public.save_plate_material(900002, 900001, 1)$$,
  '42501', 'not_staff', 'non-staff cannot add materials'
);
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok(
  $$select public.create_quote_plate(900001, 'Plate')$$,
  '42501', null, 'anon cannot call the API functions'
);
select throws_ok(
  $$select public.get_quote_send_blockers(900001)$$,
  '42501', null, 'anon cannot read the send check'
);

select * from finish();
rollback;
