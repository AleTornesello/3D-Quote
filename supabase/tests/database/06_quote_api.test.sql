begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-4000-8000-0000000000a2', 'operator@test.local'),
  ('00000000-0000-4000-8000-0000000000a3', 'outsider@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'Test Owner', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', 'Test Operator', 'operator');
insert into public.printers (id, name, model, build_x_mm, build_y_mm, build_z_mm, hourly_rate, power_w, active)
  overriding system value values
  (900001, 'Test MK4', 'Prusa MK4', 250, 210, 220, 1.50, 120, true),
  (900002, 'Old MK3', 'Prusa MK3', 250, 210, 210, 1.00, 100, false);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (900001, 'Test PLA', 'PLA', 1.24, 25.00);
insert into public.clients (id, name) overriding system value values (900001, 'Test Client');
insert into public.quotes (id, client_id, created_by) overriding system value values
  (900001, 900001, '00000000-0000-4000-8000-0000000000a1'),
  (900002, 900001, '00000000-0000-4000-8000-0000000000a1');
update public.quotes set status = 'sent', sent_at = now() where id = 900002;
insert into storage.objects (bucket_id, name) values
  ('models', '900001/u1/bare.stl'),
  ('models', '900001/u2/ready.stl'),
  ('models', '900002/u3/late.stl');
do $$ begin perform pgmq.purge_queue('slicing_jobs'); end $$;

-- Operator creates items
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select lives_ok(
  $$select public.create_quote_item(900001, '900001/u1/bare.stl', 'bare.stl', 'bare')$$,
  'staff can add an item without printer and material'
);
select lives_ok(
  $$select public.create_quote_item(900001, '900001/u2/ready.stl', 'ready.stl', 'ready', 900001, 900001)$$,
  'staff can add an item with printer and material'
);
select throws_ok(
  $$select public.create_quote_item(900001, '900002/u3/late.stl', 'late.stl', 'late')$$,
  '22023', 'invalid_model_path', 'the model must be in the quote''s folder'
);
select throws_ok(
  $$select public.create_quote_item(900001, '900001/u9/missing.stl', 'missing.stl', 'missing')$$,
  'P0002', 'model_not_found', 'the model must have been uploaded'
);
select throws_ok(
  $$select public.create_quote_item(900002, '900002/u3/late.stl', 'late.stl', 'late')$$,
  'P0001', 'quote_not_draft', 'items can only be added to drafts'
);
select throws_ok(
  $$select public.create_quote_item(900001, '900001/u1/bare.stl', 'bare.stl', 'again', 900002, 900001)$$,
  '22023', 'printer_inactive', 'inactive printers cannot be chosen'
);

reset role;
select results_eq(
  $$select quantity, layer_height_mm::numeric, infill_percent::int, supports
    from public.quote_items where model_path = '900001/u1/bare.stl'$$,
  $$values (1, 0.20, 20, false)$$,
  'new items get the default print settings'
);
select is(
  (select count(*)::int from public.slicing_jobs j
   join public.quote_items i on i.id = j.quote_item_id
   where i.model_path = '900001/u1/bare.stl'),
  0,
  'no job is queued without printer and material'
);
select is(
  (select count(*)::int from public.slicing_jobs j
   join public.quote_items i on i.id = j.quote_item_id
   where i.model_path = '900001/u2/ready.stl' and j.status = 'queued'),
  1,
  'a queued job is created when printer and material are set'
);
select is((select count(*)::int from pgmq.q_slicing_jobs), 1, 'one queue message is sent');
select is(
  (select message from pgmq.q_slicing_jobs),
  (select jsonb_build_object(
            'job_id', j.id, 'quote_item_id', i.id, 'model_path', i.model_path,
            'printer_id', 900001, 'material_id', 900001,
            'settings', jsonb_build_object('layer_height_mm', 0.20, 'infill_percent', 20, 'supports', false))
   from public.slicing_jobs j
   join public.quote_items i on i.id = j.quote_item_id
   where i.model_path = '900001/u2/ready.stl'),
  'the message carries the job and item ids, the model path and the settings'
);

-- Pretend the ready item was sliced and priced
update public.quote_items
  set print_time_s = 3600, filament_g = 25, bbox_x_mm = 50, bbox_y_mm = 40, bbox_z_mm = 30, computed_total = 10
  where model_path = '900001/u2/ready.stl';
update public.slicing_jobs set status = 'succeeded'
  where quote_item_id = (select id from public.quote_items where model_path = '900001/u2/ready.stl');

-- Settings changes
set local role authenticated;
select lives_ok(
  $$select public.update_quote_item_settings(
      (select id from public.quote_items where model_path = '900001/u2/ready.stl'), 900001, 900001, 0.20, 20, false)$$,
  'an unchanged settings call is accepted'
);
reset role;
select is(
  (select count(*)::int from public.slicing_jobs
   where quote_item_id = (select id from public.quote_items where model_path = '900001/u2/ready.stl')),
  1,
  'and does not slice again'
);
set local role authenticated;
select lives_ok(
  $$select public.update_quote_item_settings(
      (select id from public.quote_items where model_path = '900001/u2/ready.stl'), 900001, 900001, 0.20, 40, false)$$,
  'staff can change the infill'
);
reset role;
select is(
  (select print_time_s from public.quote_items where model_path = '900001/u2/ready.stl'),
  null::integer,
  'changing a setting clears the slicing results'
);
select is(
  (select computed_total from public.quote_items where model_path = '900001/u2/ready.stl'),
  null::numeric,
  'and the price'
);
select is(
  (select count(*)::int from public.slicing_jobs
   where quote_item_id = (select id from public.quote_items where model_path = '900001/u2/ready.stl')
     and status = 'queued'),
  1,
  'and queues a new job'
);
select is((select count(*)::int from pgmq.q_slicing_jobs), 2, 'with a new message');
set local role authenticated;
select lives_ok(
  $$select public.update_quote_item_settings(
      (select id from public.quote_items where model_path = '900001/u2/ready.stl'), null, 900001, 0.20, 40, false)$$,
  'the printer can be cleared'
);
reset role;
select is(
  (select count(*)::int from public.slicing_jobs
   where quote_item_id = (select id from public.quote_items where model_path = '900001/u2/ready.stl')),
  2,
  'without a printer nothing is queued'
);

-- Retry
set local role authenticated;
select throws_ok(
  $$select public.retry_slicing((select id from public.quote_items where model_path = '900001/u1/bare.stl'))$$,
  'P0001', 'retry_not_allowed', 'retry needs a failed job'
);
reset role;
update public.quote_items set printer_id = 900001 where model_path = '900001/u2/ready.stl';
update public.slicing_jobs set status = 'failed'
  where id = (select max(id) from public.slicing_jobs
              where quote_item_id = (select id from public.quote_items where model_path = '900001/u2/ready.stl'));
set local role authenticated;
select lives_ok(
  $$select public.retry_slicing((select id from public.quote_items where model_path = '900001/u2/ready.stl'))$$,
  'staff can retry a failed job'
);
reset role;
select is(
  (select status from public.slicing_jobs
   where quote_item_id = (select id from public.quote_items where model_path = '900001/u2/ready.stl')
   order by id desc limit 1),
  'queued',
  'the retry queues a new job'
);

-- Access
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$select public.create_quote_item(900001, '900001/u1/bare.stl', 'bare.stl', 'bare')$$,
  '42501', 'not_staff', 'non-staff cannot add items'
);
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok(
  $$select public.create_quote_item(900001, '900001/u1/bare.stl', 'bare.stl', 'bare')$$,
  '42501', null, 'anon cannot call the API functions'
);

select * from finish();
rollback;
