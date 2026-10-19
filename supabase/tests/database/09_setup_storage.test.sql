begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'operator@test.local'),
  ('00000000-0000-4000-8000-0000000000a3', 'outsider@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Test Owner', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', 'Test Operator', 'operator');
insert into public.clients (id, name) overriding system value values (900001, 'Test Client');
insert into public.quotes (id, client_id, created_by, status, sent_at, vat_rate_pct) overriding system value values
  (900001, 900001, '00000000-0000-4000-8000-0000000000a1', 'draft', null, null),
  (900002, 900001, '00000000-0000-4000-8000-0000000000a1', 'sent', now(), 22);
insert into storage.objects (bucket_id, name) values
  ('models', '900001/seed/existing.stl'),
  ('models', '900002/seed/sent.stl'),
  ('models', '900002/seed/sent-delete.stl'),
  ('branding', 'test-logo.png');

-- What the migration sets up
select is((select count(*)::int from public.settings), 1, 'settings has its single row');
select ok(not exists (select 1 from pgmq.list_queues() where queue_name = 'slicing_jobs'), 'the slicing_jobs queue is gone');
select results_eq(
  $$select id, public, file_size_limit, allowed_mime_types from storage.buckets
    where id in ('branding', 'models') order by id$$,
  $$values ('branding'::text, false, 1048576::bigint, array['image/png', 'image/jpeg', 'image/svg+xml']::text[]),
           ('models'::text, false, 104857600::bigint, null::text[])$$,
  'both buckets are private with their size limits'
);
select results_eq(
  $$select schedule, command from cron.job where jobname = 'expire-quotes'$$,
  $$values ('15 0 * * *'::text, 'select private.expire_quotes()'::text)$$,
  'quotes are expired by a daily cron job'
);
select is(
  array(
    select policyname::text from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (policyname like 'models:%' or policyname like 'branding:%')
    order by 1
  ),
  array[
    'branding: owner delete', 'branding: owner update', 'branding: owner upload', 'branding: staff read',
    'models: staff delete', 'models: staff read', 'models: staff update in draft quotes',
    'models: staff upload to draft quotes'
  ],
  'all storage policies are in place'
);

-- Operator
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('models', '900001/u1/part.stl')$$,
  'staff can upload into a draft quote''s folder'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('models', '900002/u1/part.stl')$$,
  '42501', null, 'not into a sent quote''s folder'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('models', 'loose/part.stl')$$,
  '42501', null, 'not outside a quote folder'
);
select ok(exists (select 1 from storage.objects where name = '900001/seed/existing.stl'), 'staff can read models');
select ok(exists (select 1 from storage.objects where name = 'test-logo.png'), 'staff can read branding');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('branding', 'other.png')$$,
  '42501', null, 'operators cannot upload branding'
);

set local storage.allow_delete_query to 'true';
select results_eq(
  $$with u as (
      update storage.objects set name = '900001/seed/moved.stl'
      where bucket_id = 'models' and name = '900002/seed/sent.stl' returning 1
    ) select count(*)::int from u$$,
  $$values (0)$$,
  'staff cannot move the model of a sent quote'
);
select results_eq(
  $$with d as (delete from storage.objects where bucket_id = 'models' and name = '900002/seed/sent-delete.stl' returning 1)
    select count(*)::int from d$$,
  $$values (0)$$,
  'or delete it'
);
select results_eq(
  $$with d as (delete from storage.objects where bucket_id = 'models' and name = '900001/u1/part.stl' returning 1)
    select count(*)::int from d$$,
  $$values (1)$$,
  'staff can delete a model in a draft quote''s folder'
);

-- Signed in without a staff row
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
select ok(
  not exists (select 1 from storage.objects where bucket_id in ('models', 'branding')),
  'non-staff see no files'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('models', '900001/u2/part.stl')$$,
  '42501', null, 'non-staff cannot upload models'
);

-- Owner
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('branding', 'logo2.png')$$,
  'owners can upload branding'
);

select * from finish();
rollback;
