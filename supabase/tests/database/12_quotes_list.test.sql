begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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
insert into public.quote_items (
  id, quote_id, model_path, original_filename, description, computed_total, override_total, override_reason
) overriding system value values
  (920101, 920001, '920001/a/a.stl', 'a.stl', 'A', 10.50, null, null),
  (920102, 920001, '920001/b/b.stl', 'b.stl', 'B', 15.00, 20.00, 'Agreed'),
  (920103, 920002, '920002/c/c.stl', 'c.stl', 'C', 12.00, null, null),
  (920104, 920002, '920002/d/d.stl', 'd.stl', 'D', null, null, null);

-- Active staff
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}';
select results_eq(
  $$select client_name, client_company, created_by_name, item_count, total
    from public.quotes_list where id = 920001$$,
  $$values ('List Client'::text, 'List Srl'::text, 'Lia List'::text, 2, 30.50::numeric)$$,
  'a fully priced quote sums its item totals, overrides included'
);
select results_eq(
  $$select item_count, total from public.quotes_list where id = 920002$$,
  $$values (2, null::numeric)$$,
  'one unpriced item leaves the total empty'
);
select results_eq(
  $$select item_count, total from public.quotes_list where id = 920003$$,
  $$values (0, null::numeric)$$,
  'a quote without items has no total'
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
  $$values ('quote_items'), ('slicing_jobs')$$,
  'quote_items and slicing_jobs publish Realtime changes'
);

select * from finish();
rollback;
