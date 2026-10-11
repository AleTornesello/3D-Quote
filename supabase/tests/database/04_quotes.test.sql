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
insert into public.clients (id, name) overriding system value values (900001, 'Test Client');
-- Clean numbering state; last year reached 57, which must not carry over.
delete from public.quotes;
delete from private.quote_counters;
insert into private.quote_counters (year, last_seq)
  values (extract(year from (now() at time zone 'Europe/Rome'))::smallint - 1, 57);
update public.settings set quote_prefix = 'T', default_validity_days = 30 where id = 1;

-- Operator
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select lives_ok($$insert into public.quotes (client_id, notes) values (900001, 'first')$$, 'operators can create a quote');
select lives_ok($$insert into public.quotes (client_id, notes) values (900001, 'second')$$, 'and another one');
select throws_ok(
  $$insert into public.quotes (client_id, number) values (900001, 'X-1')$$,
  '42501', null, 'the API cannot supply a quote number'
);
select throws_ok(
  $$insert into public.quotes (client_id, status) values (900001, 'sent')$$,
  '42501', null, 'the API cannot supply a status'
);
select results_eq(
  $$with u as (update public.quotes set notes = 'edited' where notes = 'first' returning 1) select count(*)::int from u$$,
  $$values (1)$$,
  'operators can edit a draft quote'
);
select throws_ok(
  $$update public.quotes set status = 'sent' where notes = 'edited'$$,
  '42501', null, 'status cannot be changed through the API'
);
select results_eq(
  $$with d as (delete from public.quotes where notes = 'second' returning 1) select count(*)::int from d$$,
  $$values (0)$$,
  'operators cannot delete quotes'
);
select throws_ok($$select * from private.quote_counters$$, '42501', null, 'the numbering counters are not readable');

-- Numbering and defaults, checked as postgres
reset role;
select is(
  (select number from public.quotes where notes = 'edited'),
  'T-' || to_char(now() at time zone 'Europe/Rome', 'YYYY') || '-0001',
  'the first quote of the year is number 1 with the prefix from settings'
);
select is(
  (select number from public.quotes where notes = 'second'),
  'T-' || to_char(now() at time zone 'Europe/Rome', 'YYYY') || '-0002',
  'numbers are sequential'
);
select is(
  (select created_by from public.quotes where notes = 'edited'),
  '00000000-0000-4000-8000-0000000000a2'::uuid,
  'created_by is the caller'
);
select is((select status from public.quotes where notes = 'edited'), 'draft', 'new quotes are drafts');
select is(
  (select valid_until from public.quotes where notes = 'edited'),
  (now() at time zone 'Europe/Rome')::date + 30,
  'valid_until defaults to today plus the validity days'
);

insert into public.quotes (client_id, created_by, number, number_seq, notes)
  values (900001, '00000000-0000-4000-8000-0000000000a1', 'X-1', 77, 'supplied');
select is(
  (select number from public.quotes where notes = 'supplied'),
  'T-' || to_char(now() at time zone 'Europe/Rome', 'YYYY') || '-0003',
  'supplied numbers are replaced'
);

update private.quote_counters set last_seq = 9999
  where year = extract(year from (now() at time zone 'Europe/Rome'))::smallint;
insert into public.quotes (client_id, created_by, notes)
  values (900001, '00000000-0000-4000-8000-0000000000a1', 'big');
select is(
  (select number from public.quotes where notes = 'big'),
  'T-' || to_char(now() at time zone 'Europe/Rome', 'YYYY') || '-10000',
  'numbers grow past 9999 without being cut'
);

-- Sent quotes are frozen for every role
update public.quotes set status = 'sent', sent_at = now() where notes = 'second';
select throws_ok(
  $$update public.quotes set notes = 'late edit' where notes = 'second'$$,
  'P0001', 'quote_not_draft', 'a sent quote cannot be edited, even bypassing RLS'
);
select lives_ok($$update public.quotes set status = 'accepted' where notes = 'second'$$, 'a sent quote can be accepted');
select throws_ok(
  $$update public.quotes set status = 'rejected' where notes = 'second'$$,
  'P0001', 'quote_not_draft', 'an accepted quote is final'
);
select throws_ok(
  $$delete from auth.users where id = '00000000-0000-4000-8000-0000000000a2'$$,
  '23503', null, 'an auth user who created quotes cannot be deleted'
);

-- Owner
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select results_eq(
  $$with d as (delete from public.quotes where notes = 'second' returning 1) select count(*)::int from d$$,
  $$values (0)$$,
  'owners cannot delete a non-draft quote'
);
select results_eq(
  $$with d as (delete from public.quotes where notes = 'big' returning 1) select count(*)::int from d$$,
  $$values (1)$$,
  'owners can delete a draft quote'
);
select throws_ok($$delete from public.clients where id = 900001$$, '23503', null, 'a client with quotes cannot be deleted');

-- Signed in without a staff row
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
select throws_ok($$insert into public.quotes (client_id) values (900001)$$, '42501', null, 'non-staff cannot create quotes');

select * from finish();
rollback;
