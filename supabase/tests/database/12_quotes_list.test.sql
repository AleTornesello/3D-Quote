begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'staff.ql@test.local'),
  ('00000000-0000-4000-8000-0000000000d2', 'outsider.ql@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000d1', 'Lia List', 'operator');
insert into public.clients (id, name, company) overriding system value values (920001, 'List Client', 'List Srl');
-- 22:30 UTC on 12 October is 00:30 on 13 October in Rome (CEST).
insert into public.quotes (id, client_id, created_by, created_at) overriding system value values
  (920001, 920001, '00000000-0000-4000-8000-0000000000d1', '2026-10-12 08:00:00+00'),
  (920002, 920001, '00000000-0000-4000-8000-0000000000d1', '2026-10-12 08:00:00+00'),
  (920003, 920001, '00000000-0000-4000-8000-0000000000d1', '2026-10-12 22:30:00+00');
insert into public.printers (id, name, model, hourly_rate, power_w)
  overriding system value values (920001, 'List MK4', 'Prusa MK4', 1.50, 120);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (920001, 'List PLA', 'PLA', 1.24, 25.00);
insert into public.quotes (id, client_id, created_by) overriding system value values
  (920004, 920001, '00000000-0000-4000-8000-0000000000d1');
insert into public.quote_plates (id, quote_id, description, printer_id, print_time_s) overriding system value values
  (920101, 920001, 'A', 920001, 3600),
  (920102, 920001, 'B', 920001, 3600),
  (920103, 920002, 'C', 920001, 3600),
  (920104, 920002, 'D', 920001, 3600),
  (920105, 920004, 'E', 920001, 3600),
  (920106, 920004, 'F', null, 3600);
insert into public.quote_plate_materials (plate_id, material_id, grams)
  select id, 920001, 10 from public.quote_plates where id between 920101 and 920106;
-- Priced after the material rows, whose inserts clear the price. D stays unpriced; F has no printer but an override.
update public.quote_plates p set computed_total = v.total, override_total = v.override, override_reason = v.reason
from (values
  (920101, 10.50, null, null),
  (920102, 15.00, 20.00, 'Agreed'),
  (920103, 12.00, null, null),
  (920105, 10.00, null, null),
  (920106, null, 5.00, 'Agreed')
) as v (id, total, override, reason)
where p.id = v.id;

-- Active staff
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}';
select results_eq(
  $$select client_name, client_company, created_by_name, plate_count, total
    from public.quotes_list where id = 920001$$,
  $$values ('List Client'::text, 'List Srl'::text, 'Lia List'::text, 2, 30.50::numeric)$$,
  'a fully priced quote sums its plate totals, overrides included'
);
select results_eq(
  $$select plate_count, total from public.quotes_list where id = 920002$$,
  $$values (2, null::numeric)$$,
  'one unpriced plate leaves the total empty'
);
select results_eq(
  $$select plate_count, total from public.quotes_list where id = 920004$$,
  $$values (2, null::numeric)$$,
  'an incomplete plate leaves the total empty, even with an override'
);
select results_eq(
  $$select plate_count, total from public.quotes_list where id = 920003$$,
  $$values (0, null::numeric)$$,
  'a quote without plates has no total'
);
select is(
  (select created_on from public.quotes_list where id = 920003),
  '2026-10-13'::date,
  'created_on is the creation date in Europe/Rome'
);
select is(
  (select number from public.quotes_list where id = 920001),
  (select number from public.quotes where id = 920001),
  'rows carry the quote number'
);

-- Signed in without a staff row: the view runs with the caller's RLS.
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}';
select is((select count(*)::int from public.quotes_list), 0, 'users without a staff row see no quotes');

-- Anonymous
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok($$select * from public.quotes_list$$, '42501', null, 'anon cannot read the view');
reset role;

select set_has(
  $$select tablename::text from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'$$,
  $$values ('quote_plates'), ('quote_plate_materials')$$,
  'quote_plates and quote_plate_materials publish Realtime changes'
);

select * from finish();
rollback;
