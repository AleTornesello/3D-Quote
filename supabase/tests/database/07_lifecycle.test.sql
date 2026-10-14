begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'operator@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Test Owner', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', 'Test Operator', 'operator');
insert into public.printers (id, name, model, hourly_rate, power_w)
  overriding system value values (900001, 'Test MK4', 'Prusa MK4', 1.50, 120);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (900001, 'Test PLA', 'PLA', 1.24, 25.00);
insert into public.clients (id, name) overriding system value values (900001, 'Test Client');
-- 900001 complete draft · 900002 draft with problems · 900003 empty draft, past due
-- 900004 sent, past due · 900005 sent, valid today · 900006 sent
insert into public.quotes (id, client_id, created_by, status, sent_at, valid_until, vat_rate_pct) overriding system value values
  (900001, 900001, '00000000-0000-4000-8000-0000000000a1', 'draft', null, (now() at time zone 'Europe/Rome')::date + 30, null),
  (900002, 900001, '00000000-0000-4000-8000-0000000000a1', 'draft', null, (now() at time zone 'Europe/Rome')::date + 30, null),
  (900003, 900001, '00000000-0000-4000-8000-0000000000a1', 'draft', null, (now() at time zone 'Europe/Rome')::date - 1, null),
  (900004, 900001, '00000000-0000-4000-8000-0000000000a1', 'sent', now(), (now() at time zone 'Europe/Rome')::date - 1, 22),
  (900005, 900001, '00000000-0000-4000-8000-0000000000a1', 'sent', now(), (now() at time zone 'Europe/Rome')::date, 22),
  (900006, 900001, '00000000-0000-4000-8000-0000000000a1', 'sent', now(), (now() at time zone 'Europe/Rome')::date + 30, 22);
insert into public.quote_items (
  id, quote_id, model_path, original_filename, description, printer_id, material_id,
  print_time_s, filament_g, bbox_x_mm, bbox_y_mm, bbox_z_mm, computed_total
) overriding system value values
  (900001, 900001, '900001/a/ok.stl', 'ok.stl', 'OK', 900001, 900001, 3600, 25, 50, 40, 30, 10.00),
  (900002, 900002, '900002/a/nomat.stl', 'nomat.stl', 'No material', 900001, null, null, null, null, null, null, null),
  (900003, 900002, '900002/b/big.stl', 'big.stl', 'Too big', 900001, 900001, 3600, 25, 300, 40, 30, null);
insert into public.slicing_jobs (quote_item_id, status) values (900001, 'succeeded'), (900003, 'failed');

-- Operator: send checks and outcomes
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select is_empty($$select * from public.get_quote_send_blockers(900001)$$, 'a complete quote has no blockers');
select results_eq(
  $$select quote_item_id, code from public.get_quote_send_blockers(900002)$$,
  $$values (900002::bigint, 'missing_printer_or_material'::text), (900002, 'not_priced'), (900002, 'not_sliced'),
           (900003, 'not_priced'), (900003, 'not_sliced')$$,
  'each incomplete item is reported with its reasons'
);
select results_eq(
  $$select quote_item_id, code from public.get_quote_send_blockers(900003)$$,
  $$values (null::bigint, 'no_items'::text), (null::bigint, 'valid_until_past'::text)$$,
  'quote-level problems are reported without an item'
);
select results_eq(
  $$select quote_item_id, code from public.get_quote_send_blockers(900004)$$,
  $$values (null::bigint, 'not_draft'::text)$$,
  'a sent quote reports only not_draft'
);
select throws_ok($$select public.mark_quote_sent(900002)$$, 'P0001', 'quote_not_sendable', 'a quote with blockers cannot be sent');
select lives_ok($$select public.mark_quote_sent(900001)$$, 'a complete quote can be sent');
select is((select status from public.quotes where id = 900001), 'sent', 'its status is sent');
select isnt((select sent_at from public.quotes where id = 900001), null, 'and the sent date is recorded');
select throws_ok($$select public.mark_quote_sent(900001)$$, 'P0001', 'quote_not_draft', 'a quote is sent only once');
select throws_ok($$select public.mark_quote_accepted(900002)$$, 'P0001', 'quote_not_sent', 'only sent quotes can be accepted');
select lives_ok($$select public.mark_quote_accepted(900001)$$, 'a sent quote can be accepted');
select throws_ok($$select public.mark_quote_rejected(900001)$$, 'P0001', 'quote_not_sent', 'an accepted quote cannot be rejected');
select lives_ok($$select public.mark_quote_rejected(900006)$$, 'a sent quote can be rejected');

-- Daily expiry
reset role;
select is(private.expire_quotes(), 1, 'one past-due sent quote expires');
select is((select status from public.quotes where id = 900004), 'expired', 'the past-due sent quote is expired');
select is((select status from public.quotes where id = 900005), 'sent', 'a quote valid until today stays sent');
select is((select status from public.quotes where id = 900003), 'draft', 'drafts never expire');

-- Overrides
insert into public.quote_items (
  id, quote_id, model_path, original_filename, description, printer_id, material_id, computed_total
) overriding system value values (900007, 900002, '900002/c/priced.stl', 'priced.stl', 'Priced', 900001, 900001, 10.00);
set local role authenticated;
select throws_ok(
  $$select public.set_price_override(900003, 50, 'Friend')$$,
  '42501', 'owner_required', 'operators cannot override prices'
);
select throws_ok(
  $$select public.set_markup_override(900002, 10)$$,
  '42501', 'owner_required', 'operators cannot override the markup'
);
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$select public.set_price_override(900003, 50, '  ')$$,
  '22023', 'invalid_override', 'an override needs a reason'
);
select throws_ok(
  $$select public.set_price_override(900003, -1, 'Oops')$$,
  '22023', 'invalid_override', 'an override cannot be negative'
);
select lives_ok($$select public.set_price_override(900003, 50, 'Friend')$$, 'owners can override a draft item');
select is((select item_total from public.quote_items where id = 900003), 50.00::numeric, 'the override becomes the item total');
select lives_ok($$select public.clear_price_override(900003)$$, 'owners can remove an override');
select is((select override_total from public.quote_items where id = 900003), null::numeric, 'the override is gone');
select throws_ok(
  $$select public.set_price_override(900001, 50, 'Late')$$,
  'P0001', 'quote_not_draft', 'prices of a sent quote are frozen'
);
select throws_ok(
  $$select public.set_markup_override(900002, -5)$$,
  '22023', 'invalid_markup', 'the markup cannot be negative'
);
select lives_ok($$select public.set_markup_override(900002, 25)$$, 'owners can override the markup of a draft');
select is((select markup_override_pct from public.quotes where id = 900002), 25.00::numeric, 'the markup override is saved');
select is((select computed_total from public.quote_items where id = 900007), null::numeric, 'and every item is re-priced');
select lives_ok($$select public.set_markup_override(900002, null)$$, 'the markup override can be removed');

select * from finish();
rollback;
