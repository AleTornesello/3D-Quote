begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'owner@test.local');
insert into public.staff (user_id, display_name, role) values ('00000000-0000-4000-8000-0000000000a1', 'Test Owner', 'owner');
insert into public.printers (id, name, model, hourly_rate, power_w)
  overriding system value values (900001, 'Test MK4', 'Prusa MK4', 1.50, 120);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (900001, 'Test PLA', 'PLA', 1.24, 25.00);
insert into public.clients (id, name) overriding system value values (900001, 'Test Client');
insert into public.quotes (id, client_id, created_by)
  overriding system value values (900001, 900001, '00000000-0000-4000-8000-0000000000a1');
insert into public.quote_items (id, quote_id, model_path, original_filename, description, printer_id, material_id)
  overriding system value values
  (900001, 900001, '900001/a/one.stl', 'one.stl', 'One', 900001, 900001),
  (900002, 900001, '900001/b/two.stl', 'two.stl', 'Two', 900001, 900001);
do $$ begin
  perform pgmq.purge_queue('slicing_jobs');
  delete from pgmq.a_slicing_jobs;
  perform private.enqueue_slicing_job(900001);
end $$;

-- Claim and complete (as postgres; privileges are checked at the end)
select results_eq(
  $$select (message->>'job_id')::bigint, read_ct from public.worker_claim_job(600, 3)$$,
  $$select max(id), 1 from public.slicing_jobs where quote_item_id = 900001$$,
  'claim returns the next message'
);
select is((select status from public.slicing_jobs where quote_item_id = 900001), 'running', 'the claimed job is running');
select is((select attempts from public.slicing_jobs where quote_item_id = 900001), 1::smallint, 'with its attempt number');
select isnt((select started_at from public.slicing_jobs where quote_item_id = 900001), null, 'and its start time');
select is_empty($$select * from public.worker_claim_job(600, 3)$$, 'a claimed message is invisible to the next claim');
select lives_ok(
  $$select public.worker_complete_job(
      (select msg_id from pgmq.q_slicing_jobs order by msg_id limit 1),
      (select max(id) from public.slicing_jobs where quote_item_id = 900001),
      '{"print_time_s": 3600, "filament_g": 25.5, "filament_mm": 8500, "layer_count": 150,
        "bbox_x_mm": 50, "bbox_y_mm": 40, "bbox_z_mm": 30, "slicer_version": "PrusaSlicer 2.9.0"}')$$,
  'complete accepts the results'
);
select results_eq(
  $$select status, print_time_s, filament_g, layer_count, slicer_version
    from public.slicing_jobs where quote_item_id = 900001$$,
  $$values ('succeeded'::text, 3600, 25.50::numeric, 150, 'PrusaSlicer 2.9.0'::text)$$,
  'the job stores the results'
);
select results_eq(
  $$select print_time_s, filament_g, bbox_x_mm, bbox_y_mm, bbox_z_mm from public.quote_items where id = 900001$$,
  $$values (3600, 25.50::numeric, 50.0::numeric, 40.0::numeric, 30.0::numeric)$$,
  'the newest job''s results are copied onto the item'
);
select is((select count(*)::int from pgmq.q_slicing_jobs), 0, 'the message is deleted');
select is((select count(*)::int from pgmq.a_slicing_jobs), 0, 'not archived');

-- An older job never overwrites a newer one
do $$ begin
  perform private.enqueue_slicing_job(900002);
  perform private.enqueue_slicing_job(900002);
  perform * from public.worker_claim_job(600, 3);
  perform * from public.worker_claim_job(600, 3);
end $$;
select lives_ok(
  $$select public.worker_complete_job(
      (select msg_id from pgmq.q_slicing_jobs
       where (message->>'job_id')::bigint = (select max(id) from public.slicing_jobs where quote_item_id = 900002)),
      (select max(id) from public.slicing_jobs where quote_item_id = 900002),
      '{"print_time_s": 1000, "filament_g": 10, "bbox_x_mm": 10, "bbox_y_mm": 10, "bbox_z_mm": 10}')$$,
  'the newer job completes first'
);
select lives_ok(
  $$select public.worker_complete_job(
      (select msg_id from pgmq.q_slicing_jobs
       where (message->>'job_id')::bigint = (select min(id) from public.slicing_jobs where quote_item_id = 900002)),
      (select min(id) from public.slicing_jobs where quote_item_id = 900002),
      '{"print_time_s": 2000, "filament_g": 20, "bbox_x_mm": 20, "bbox_y_mm": 20, "bbox_z_mm": 20}')$$,
  'the older job completes later'
);
select is((select print_time_s from public.quote_items where id = 900002), 1000, 'an older job never overwrites newer results');
select is(
  (select status from public.slicing_jobs where id = (select min(id) from public.slicing_jobs where quote_item_id = 900002)),
  'succeeded',
  'the older job is still recorded as succeeded'
);

-- Failures
do $$ begin
  perform private.enqueue_slicing_job(900001);
  perform * from public.worker_claim_job(600, 3);
end $$;
select lives_ok(
  $$select public.worker_fail_job(
      (select msg_id from pgmq.q_slicing_jobs
       where (message->>'job_id')::bigint = (select max(id) from public.slicing_jobs where quote_item_id = 900001)),
      (select max(id) from public.slicing_jobs where quote_item_id = 900001),
      'slicer crashed', false)$$,
  'a non-final failure is recorded'
);
select results_eq(
  $$select status, error from public.slicing_jobs
    where id = (select max(id) from public.slicing_jobs where quote_item_id = 900001)$$,
  $$values ('queued'::text, 'slicer crashed'::text)$$,
  'the job goes back to queued with the error'
);
select is(
  (select count(*)::int from pgmq.q_slicing_jobs
   where (message->>'job_id')::bigint = (select max(id) from public.slicing_jobs where quote_item_id = 900001)),
  1,
  'the message stays for redelivery'
);
select lives_ok(
  $$select public.worker_fail_job(
      (select msg_id from pgmq.q_slicing_jobs
       where (message->>'job_id')::bigint = (select max(id) from public.slicing_jobs where quote_item_id = 900001)),
      (select max(id) from public.slicing_jobs where quote_item_id = 900001),
      'slicer crashed again', true)$$,
  'a final failure is recorded'
);
select results_eq(
  $$select status, finished_at is not null from public.slicing_jobs
    where id = (select max(id) from public.slicing_jobs where quote_item_id = 900001)$$,
  $$values ('failed'::text, true)$$,
  'the job is failed with its finish time'
);
select is(
  (select count(*)::int from pgmq.a_slicing_jobs
   where (message->>'job_id')::bigint = (select max(id) from public.slicing_jobs where quote_item_id = 900001)),
  1,
  'and its message is archived'
);

-- A message read more often than allowed (the worker died every time)
do $$ begin
  perform private.enqueue_slicing_job(900002);
  perform * from pgmq.read('slicing_jobs', 0, 1);
  perform * from pgmq.read('slicing_jobs', 0, 1);
  perform * from pgmq.read('slicing_jobs', 0, 1);
end $$;
select is_empty($$select * from public.worker_claim_job(600, 2)$$, 'a message read more than max_attempts times is not handed out');
select results_eq(
  $$select status, error from public.slicing_jobs
    where id = (select max(id) from public.slicing_jobs where quote_item_id = 900002)$$,
  $$values ('failed'::text, 'worker stopped on every attempt'::text)$$,
  'its job is failed'
);
select is(
  (select count(*)::int from pgmq.a_slicing_jobs
   where (message->>'job_id')::bigint = (select max(id) from public.slicing_jobs where quote_item_id = 900002)),
  1,
  'and its message archived'
);

select throws_ok(
  $$select public.worker_complete_job(1, 1, '{"print_time_s": 10}')$$,
  '22023', 'invalid_results', 'incomplete results are rejected'
);

-- A message must belong to the job it is reported for
do $$ begin
  perform private.enqueue_slicing_job(900001);
  perform private.enqueue_slicing_job(900002);
  perform * from public.worker_claim_job(600, 3);
  perform * from public.worker_claim_job(600, 3);
end $$;
select throws_ok(
  $$select public.worker_complete_job(
      (select msg_id from pgmq.q_slicing_jobs
       where (message->>'job_id')::bigint = (select max(id) from public.slicing_jobs where quote_item_id = 900001)),
      (select max(id) from public.slicing_jobs where quote_item_id = 900002),
      '{"print_time_s": 1, "filament_g": 1, "bbox_x_mm": 1, "bbox_y_mm": 1, "bbox_z_mm": 1}')$$,
  '22023', 'job_message_mismatch', 'complete refuses a message that belongs to another job'
);
select throws_ok(
  $$select public.worker_fail_job(
      (select msg_id from pgmq.q_slicing_jobs
       where (message->>'job_id')::bigint = (select max(id) from public.slicing_jobs where quote_item_id = 900001)),
      (select max(id) from public.slicing_jobs where quote_item_id = 900002),
      'wrong pairing', true)$$,
  '22023', 'job_message_mismatch', 'fail refuses a message that belongs to another job'
);
select results_eq(
  $$select j.status, count(m.msg_id)::int
    from public.slicing_jobs j
    left join pgmq.q_slicing_jobs m on (m.message->>'job_id')::bigint = j.id
    where j.id in (select max(id) from public.slicing_jobs where quote_item_id in (900001, 900002) group by quote_item_id)
    group by j.id, j.status order by j.id$$,
  $$values ('running'::text, 1), ('running'::text, 1)$$,
  'both jobs keep running with their own messages'
);

-- The item was deleted while its job ran
do $$ begin
  perform private.enqueue_slicing_job(900002);
  perform * from public.worker_claim_job(600, 3);
  perform set_config('test.job_id', (select max(id)::text from public.slicing_jobs where quote_item_id = 900002), true);
  perform set_config(
    'test.msg_id',
    (select msg_id::text from pgmq.q_slicing_jobs where message->>'job_id' = current_setting('test.job_id')),
    true
  );
  delete from public.quote_items where id = 900002;
end $$;
select lives_ok(
  $$select public.worker_complete_job(
      current_setting('test.msg_id')::bigint, current_setting('test.job_id')::bigint,
      '{"print_time_s": 1, "filament_g": 1, "bbox_x_mm": 1, "bbox_y_mm": 1, "bbox_z_mm": 1}')$$,
  'completing a job whose item was deleted does not fail'
);
select is(
  (select count(*)::int from pgmq.a_slicing_jobs where msg_id = current_setting('test.msg_id')::bigint),
  1,
  'its message is archived'
);

-- Privileges
select ok(has_function_privilege('service_role', 'public.worker_claim_job(integer, integer)', 'execute'), 'the service role can claim jobs');
select ok(not has_function_privilege('authenticated', 'public.worker_claim_job(integer, integer)', 'execute'), 'staff cannot claim jobs');
select ok(not has_function_privilege('authenticated', 'public.worker_complete_job(bigint, bigint, jsonb)', 'execute'), 'staff cannot complete jobs');
set local role service_role;
set local request.jwt.claims to '{"role":"service_role"}';
select is_empty($$select * from public.worker_claim_job(600, 3)$$, 'the service role reaches the worker functions through the wrappers');

select * from finish();
rollback;
