begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'owner.cs@test.local'),
  ('00000000-0000-4000-8000-0000000000e2', 'operator.cs@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000e1', 'Cons Owner', 'owner'),
  ('00000000-0000-4000-8000-0000000000e2', 'Cons Operator', 'operator');
insert into public.printers (id, name, model, hourly_rate, power_w)
  overriding system value values (930001, 'Cons MK4', 'Prusa MK4', 1.50, 120);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (930001, 'Cons PLA', 'PLA', 1.24, 25.00);
insert into public.clients (id, name) overriding system value values (930001, 'Cons Client');
insert into public.consumables (id, name, unit, unit_price, stock) overriding system value values
  (930001, 'Bolt M3', 'pcs', 0.10, 10),
  (930002, 'Insert M3', 'pcs', 0.50, 2);
-- Quotes 930001 (the main one), 930002 and 930003 (expiry and acceptance), 930004/930005 (copy).
insert into public.quotes (id, client_id, created_by, valid_until) overriding system value values
  (930001, 930001, '00000000-0000-4000-8000-0000000000e1', (now() at time zone 'Europe/Rome')::date + 30),
  (930002, 930001, '00000000-0000-4000-8000-0000000000e1', (now() at time zone 'Europe/Rome')::date + 30),
  (930003, 930001, '00000000-0000-4000-8000-0000000000e1', (now() at time zone 'Europe/Rome')::date + 30),
  (930004, 930001, '00000000-0000-4000-8000-0000000000e1', (now() at time zone 'Europe/Rome')::date + 30),
  (930005, 930001, '00000000-0000-4000-8000-0000000000e1', (now() at time zone 'Europe/Rome')::date + 30);
insert into public.quote_plates (id, quote_id, description, printer_id, print_time_s)
  overriding system value values (930001, 930001, 'OK', 930001, 3600);
insert into public.quote_plate_materials (plate_id, material_id, grams) values (930001, 930001, 25);
-- Priced after the material row, whose insert clears the price.
update public.quote_plates set computed_total = 10.00, priced_at = now() where id = 930001;

-- Constraints
select throws_ok(
  $$insert into public.consumables (name, unit, unit_price, stock) values ('Bad', 'pcs', 1, -1)$$,
  '23514', null, 'stock cannot be negative'
);
select throws_ok(
  $$insert into public.consumables (name, unit, unit_price, stock) values ('Bolt M3', 'pcs', 1, 1)$$,
  '23505', null, 'names are unique'
);

-- Catalog access
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}';
select is((select count(*)::int from public.consumables where id in (930001, 930002)), 2, 'staff read consumables');
select throws_ok(
  $$insert into public.consumables (name, unit, unit_price, stock) values ('Op', 'pcs', 1, 1)$$,
  '42501', null, 'an operator cannot create a consumable'
);
select results_eq(
  $$with u as (update public.consumables set stock = 99 where id = 930001 returning 1) select count(*)::int from u$$,
  $$values (0)$$,
  'an operator cannot change stock'
);

-- Quote lines
select lives_ok($$select public.add_quote_consumable(930001, 930001, 4)$$, 'staff add a consumable to a draft');
select is(
  (select line_total from public.quote_consumables where quote_id = 930001 and consumable_id = 930001),
  0.40::numeric, 'the line total is quantity times the frozen price'
);
select lives_ok($$select public.add_quote_consumable(930001, 930001, 2)$$, 'adding it again is accepted');
select results_eq(
  $$select count(*)::int, sum(quantity)::int from public.quote_consumables where quote_id = 930001$$,
  $$values (1, 6)$$,
  'adding again raises the quantity of the one line'
);
select is((select stock from public.consumables where id = 930001), 10, 'a draft does not touch stock');
select throws_ok(
  $$update public.quote_consumables set quantity = 0 where quote_id = 930001$$,
  '23514', null, 'a line needs a positive quantity'
);

-- An inactive consumable cannot be added, but a line already on the draft stays
reset role;
update public.consumables set active = false where id = 930002;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}';
select throws_ok(
  $$select public.add_quote_consumable(930001, 930002, 1)$$,
  '22023', 'consumable_inactive', 'an inactive consumable cannot be added'
);
reset role;
update public.consumables set active = true where id = 930002;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000e2","role":"authenticated"}';

-- Sending: not enough stock blocks, enough stock deducts
select lives_ok($$select public.add_quote_consumable(930001, 930002, 5)$$, 'a line above the stock can be drafted');
select results_eq(
  $$select quote_plate_id, code from public.get_quote_send_blockers(930001)$$,
  $$values (null::bigint, 'insufficient_stock'::text)$$,
  'the blockers report the missing stock'
);
select throws_ok($$select public.mark_quote_sent(930001)$$, 'P0001', 'quote_not_sendable', 'sending is refused');
update public.quote_consumables set quantity = 2 where quote_id = 930001 and consumable_id = 930002;
update public.quote_consumables set quantity = 3 where quote_id = 930001 and consumable_id = 930001;
select lives_ok($$select public.mark_quote_sent(930001)$$, 'sending works once the stock is enough');
select results_eq(
  $$select id::int, stock from public.consumables where id in (930001, 930002) order by id$$,
  $$values (930001, 7), (930002, 0)$$,
  'sending deducts the stock'
);
select is(
  (select total from public.quotes_list where id = 930001),
  11.30::numeric, 'the list total adds the consumable lines to the items'
);
select results_eq(
  $$with u as (update public.quote_consumables set quantity = 1 where quote_id = 930001 returning 1) select count(*)::int from u$$,
  $$values (0)$$,
  'lines of a sent quote cannot be changed'
);

-- Rejected gives the stock back
select lives_ok($$select public.mark_quote_rejected(930001)$$, 'the sent quote is rejected');
select results_eq(
  $$select id::int, stock from public.consumables where id in (930001, 930002) order by id$$,
  $$values (930001, 10), (930002, 2)$$,
  'rejecting gives the stock back'
);

reset role;

-- Expired gives the stock back; accepted keeps it deducted
insert into public.quote_consumables (quote_id, consumable_id, quantity, unit_price) values
  (930002, 930001, 2, 0.10),
  (930003, 930001, 1, 0.10);
update public.consumables set stock = stock - 3 where id = 930001;
update public.quotes set status = 'sent', sent_at = now(), vat_rate_pct = 22,
  valid_until = (now() at time zone 'Europe/Rome')::date - 1 where id = 930002;
update public.quotes set status = 'sent', sent_at = now(), vat_rate_pct = 22 where id = 930003;
select private.expire_quotes();
select is((select stock from public.consumables where id = 930001), 9, 'expiring gives the stock back');
select private.mark_quote_accepted(930003);
select is((select stock from public.consumables where id = 930001), 9, 'accepting keeps the stock deducted');

-- The guard also stops roles that bypass RLS
select throws_ok(
  $$update public.quote_consumables set quantity = 1 where quote_id = 930003$$,
  'P0001', 'quote_not_draft', 'lines of a non-draft quote are guarded even for a role that bypasses RLS'
);

-- Deleting a consumable that a quote uses is refused; copying skips inactive ones
select throws_ok(
  $$delete from public.consumables where id = 930001$$,
  '23503', null, 'a consumable used by a quote cannot be deleted'
);
insert into public.quote_consumables (quote_id, consumable_id, quantity, unit_price) values
  (930004, 930001, 3, 0.05),
  (930004, 930002, 1, 0.50);
update public.consumables set active = false where id = 930002;
select private.service_copy_quote_plates(930004, 930005);
select results_eq(
  $$select consumable_id::int, quantity, unit_price from public.quote_consumables where quote_id = 930005$$,
  $$values (930001, 3, 0.10::numeric)$$,
  'a copy takes the active lines at the current price and skips inactive ones'
);

select * from finish();
rollback;
