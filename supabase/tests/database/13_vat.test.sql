begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'operator@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Test Owner', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', 'Test Operator', 'operator');
insert into public.printers (id, name, model, build_x_mm, build_y_mm, build_z_mm, hourly_rate, power_w)
  overriding system value values (910001, 'Test MK4', 'Prusa MK4', 250, 210, 220, 1.50, 120);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (910001, 'Test PLA', 'PLA', 1.24, 25.00);
insert into public.clients (id, name) overriding system value values (910001, 'Test Client');
insert into public.quotes (id, client_id, created_by, status, sent_at, valid_until) overriding system value values
  (910001, 910001, '00000000-0000-4000-8000-0000000000a1', 'draft', null, (now() at time zone 'Europe/Rome')::date + 30);
insert into public.quote_items (
  id, quote_id, model_path, original_filename, description, printer_id, material_id,
  print_time_s, filament_g, bbox_x_mm, bbox_y_mm, bbox_z_mm, computed_total
) overriding system value values
  (910001, 910001, '910001/a/ok.stl', 'ok.stl', 'OK', 910001, 910001, 3600, 25, 50, 40, 30, 10.00);
insert into public.slicing_jobs (quote_item_id, status) values (910001, 'succeeded');

-- Settings
select is((select vat_rate_pct from public.settings where id = 1), 22::numeric, 'the VAT rate defaults to 22');
select throws_ok($$update public.settings set vat_rate_pct = -1$$, '23514', null, 'a negative rate is refused');
select throws_ok($$update public.settings set vat_rate_pct = 100.01$$, '23514', null, 'a rate above 100 is refused');

-- Constraint: a rate exactly when the quote is not a draft
select throws_ok(
  $$insert into public.quotes (client_id, created_by, status, vat_rate_pct)
    values (910001, '00000000-0000-4000-8000-0000000000a1', 'draft', 22)$$,
  '23514', null, 'a draft cannot carry a rate'
);
select throws_ok(
  $$insert into public.quotes (client_id, created_by, status, sent_at, vat_rate_pct)
    values (910001, '00000000-0000-4000-8000-0000000000a1', 'sent', now(), null)$$,
  '23514', null, 'a sent quote must carry a rate'
);

-- Operator: sending freezes the rate
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select is((select vat_rate_pct from public.quotes where id = 910001), null::numeric, 'a draft has no rate of its own');
select lives_ok($$select public.mark_quote_sent(910001)$$, 'the quote can be sent');
select is((select vat_rate_pct from public.quotes where id = 910001), 22::numeric, 'sending copies the settings rate');

-- A later change of the shop rate leaves the sent quote alone
reset role;
update public.settings set vat_rate_pct = 23 where id = 1;
select is((select vat_rate_pct from public.quotes where id = 910001), 22::numeric, 'the sent quote keeps its rate');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select results_eq(
  $$with u as (update public.settings set vat_rate_pct = 10 returning 1) select count(*)::int from u$$,
  $$values (0)$$,
  'an operator cannot change the shop rate'
);
select lives_ok($$select public.mark_quote_accepted(910001)$$, 'the quote can be accepted');
select is((select vat_rate_pct from public.quotes where id = 910001), 22::numeric, 'accepting keeps the rate');

-- Expiring keeps the rate; a copy of a sent quote is a draft without one
reset role;
insert into public.quotes (id, client_id, created_by, status, sent_at, valid_until, vat_rate_pct)
  overriding system value values
  (910002, 910001, '00000000-0000-4000-8000-0000000000a1', 'sent', now(), (now() at time zone 'Europe/Rome')::date - 1, 22);
select private.expire_quotes();
select is(
  (select status || ' ' || vat_rate_pct from public.quotes where id = 910002), 'expired 22.00',
  'expiring keeps the rate'
);
select is(
  (select vat_rate_pct from public.quotes where id = public.service_create_quote_copy(910002, '00000000-0000-4000-8000-0000000000a1')),
  null::numeric,
  'a copy of a sent quote is a draft without a rate'
);

select * from finish();
rollback;
