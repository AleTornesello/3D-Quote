begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'owner.copy@test.local'),
  ('00000000-0000-4000-8000-0000000000c2', 'operator.copy@test.local');
insert into public.staff (user_id, display_name, role) values
  ('00000000-0000-4000-8000-0000000000c1', 'Copy Owner', 'owner'),
  ('00000000-0000-4000-8000-0000000000c2', 'Copy Operator', 'operator');
insert into public.printers (id, name, model, build_x_mm, build_y_mm, build_z_mm, hourly_rate, power_w)
  overriding system value values (910001, 'Copy MK4', 'Prusa MK4', 250, 210, 220, 1.50, 120);
insert into public.materials (id, name, type, density_g_cm3, cost_per_kg)
  overriding system value values (910001, 'Copy PETG', 'PETG', 1.27, 25.00);
insert into public.clients (id, name) overriding system value values (910001, 'Copy Client');
insert into public.quotes (id, client_id, created_by, notes, markup_override_pct) overriding system value values
  (910001, 910001, '00000000-0000-4000-8000-0000000000c1', 'Rush job', 12.50);
insert into storage.objects (bucket_id, name) values
  ('models', '910001/s1/sliced.stl'),
  ('models', '910001/s2/waiting.stl'),
  ('models', '910001/s3/bare.stl');
insert into public.quote_items (
  id, quote_id, model_path, original_filename, description, printer_id, material_id, quantity,
  layer_height_mm, infill_percent, supports, print_time_s, filament_g, bbox_x_mm, bbox_y_mm, bbox_z_mm,
  material_cost, computed_total, markup_pct, priced_at, override_total, override_reason
) overriding system value values
  (910101, 910001, '910001/s1/sliced.stl', 'sliced.stl', 'Sliced part', 910001, 910001, 3,
   0.15, 30, true, 19800, 120.00, 100.0, 80.0, 40.0, 3.0000, 39.24, 30.00, now(), 50.00, 'Agreed price'),
  (910102, 910001, '910001/s2/waiting.stl', 'waiting.stl', 'Waiting part', 910001, 910001, 1,
   0.20, 20, false, null, null, null, null, null, null, null, null, null, null, null),
  (910103, 910001, '910001/s3/bare.stl', 'bare.stl', 'Bare part', null, null, 1,
   0.20, 20, false, null, null, null, null, null, null, null, null, null, null, null);
-- An older failed attempt, then the newest succeeded one.
insert into public.slicing_jobs (
  quote_item_id, status, attempts, print_time_s, filament_g, filament_mm, layer_count,
  bbox_x_mm, bbox_y_mm, bbox_z_mm, slicer_version, started_at, finished_at
) values
  (910101, 'failed', 1, null, null, null, null, null, null, null, null, now(), now()),
  (910101, 'succeeded', 2, 19800, 120.00, 40000.00, 266, 100.0, 80.0, 40.0, 'PrusaSlicer 2.9.0', now(), now());
update public.quotes set status = 'sent', sent_at = now(), vat_rate_pct = 22 where id = 910001;
do $$ begin perform pgmq.purge_queue('slicing_jobs'); end $$;

-- Privileges
select is(
  array(
    select f from unnest(array[
      'public.service_create_quote_copy(bigint,uuid)',
      'private.service_create_quote_copy(bigint,uuid)',
      'public.service_copy_quote_items(bigint,bigint,jsonb)',
      'private.service_copy_quote_items(bigint,bigint,jsonb)'
    ]) as f
    where has_function_privilege('authenticated', f, 'execute')
  ),
  array[]::text[],
  'authenticated cannot execute the service functions'
);
select ok(
  has_function_privilege('service_role', 'public.service_create_quote_copy(bigint,uuid)', 'execute')
    and has_function_privilege('service_role', 'public.service_copy_quote_items(bigint,bigint,jsonb)', 'execute'),
  'the service role can execute them'
);

-- Creating the copy
set local role service_role;
select lives_ok(
  $$select public.service_create_quote_copy(910001, '00000000-0000-4000-8000-0000000000c2')$$,
  'the service role creates a copy of a sent quote'
);
select throws_ok(
  $$select public.service_create_quote_copy(999999999, '00000000-0000-4000-8000-0000000000c1')$$,
  'P0002', 'quote_not_found', 'an unknown source is rejected'
);
reset role;

select results_eq(
  $$select status, client_id, notes, markup_override_pct, created_by, valid_until, sent_at
    from public.quotes where client_id = 910001 and id <> 910001$$,
  $$select 'draft'::text, 910001::bigint, 'Rush job'::text, 12.50::numeric,
           '00000000-0000-4000-8000-0000000000c2'::uuid,
           private.shop_today() + (select default_validity_days from public.settings where id = 1),
           null::timestamptz$$,
  'the copy is a draft with the client, notes, markup and creator, and the default validity'
);
select isnt(
  (select number from public.quotes where client_id = 910001 and id <> 910001),
  (select number from public.quotes where id = 910001),
  'the copy gets its own number'
);

-- Copying the items (the Edge Function copies the files first)
insert into storage.objects (bucket_id, name)
select 'models', q.id || p.path
from public.quotes q, unnest(array['/n1/sliced.stl', '/n2/waiting.stl', '/n3/bare.stl']) as p (path)
where q.client_id = 910001 and q.id <> 910001;

set local role service_role;
select throws_ok(
  $$select public.service_copy_quote_items(910001, c.id, jsonb_build_array(
      jsonb_build_object('item_id', 910101, 'model_path', c.id || '/n1/sliced.stl'),
      jsonb_build_object('item_id', 910102, 'model_path', c.id || '/n2/waiting.stl')))
    from public.quotes c where c.client_id = 910001 and c.id <> 910001$$,
  '22023', 'invalid_copy', 'every source item must be listed'
);
select throws_ok(
  $$select public.service_copy_quote_items(910001, c.id, jsonb_build_array(
      jsonb_build_object('item_id', 910101, 'model_path', c.id || '/n1/sliced.stl'),
      jsonb_build_object('item_id', 910102, 'model_path', c.id || '/n2/waiting.stl'),
      jsonb_build_object('item_id', 999999, 'model_path', c.id || '/n3/bare.stl')))
    from public.quotes c where c.client_id = 910001 and c.id <> 910001$$,
  '22023', 'invalid_copy', 'items of other quotes are rejected'
);
select throws_ok(
  $$select public.service_copy_quote_items(910001, c.id, jsonb_build_array(
      jsonb_build_object('item_id', 910101, 'model_path', c.id || '/n1/sliced.stl'),
      jsonb_build_object('item_id', 910102, 'model_path', c.id || '/n2/waiting.stl'),
      jsonb_build_object('item_id', 910103, 'model_path', '910001/s3/bare.stl')))
    from public.quotes c where c.client_id = 910001 and c.id <> 910001$$,
  '22023', 'invalid_model_path', 'files must be in the new quote''s folder'
);
select throws_ok(
  $$select public.service_copy_quote_items(910001, c.id, jsonb_build_array(
      jsonb_build_object('item_id', 910101, 'model_path', c.id || '/n1/sliced.stl'),
      jsonb_build_object('item_id', 910102, 'model_path', c.id || '/n2/waiting.stl'),
      jsonb_build_object('item_id', 910103, 'model_path', c.id || '/n9/missing.stl')))
    from public.quotes c where c.client_id = 910001 and c.id <> 910001$$,
  'P0002', 'model_not_found', 'files must have been copied'
);
select throws_ok(
  $$select public.service_copy_quote_items(910001, 910001, '[]'::jsonb)$$,
  'P0001', 'quote_not_draft', 'the target must be a draft'
);
select lives_ok(
  $$select public.service_copy_quote_items(910001, c.id, jsonb_build_array(
      jsonb_build_object('item_id', 910101, 'model_path', c.id || '/n1/sliced.stl'),
      jsonb_build_object('item_id', 910102, 'model_path', c.id || '/n2/waiting.stl'),
      jsonb_build_object('item_id', 910103, 'model_path', c.id || '/n3/bare.stl')))
    from public.quotes c where c.client_id = 910001 and c.id <> 910001$$,
  'the service role copies the items'
);
reset role;

select results_eq(
  $$select original_filename, description, printer_id, material_id, quantity, layer_height_mm, infill_percent,
           supports, print_time_s, filament_g, bbox_x_mm, bbox_y_mm, bbox_z_mm, override_total, override_reason
    from public.quote_items
    where quote_id = (select id from public.quotes where client_id = 910001 and id <> 910001)
    order by id$$,
  $$select original_filename, description, printer_id, material_id, quantity, layer_height_mm, infill_percent,
           supports, print_time_s, filament_g, bbox_x_mm, bbox_y_mm, bbox_z_mm, override_total, override_reason
    from public.quote_items where quote_id = 910001 order by id$$,
  'items carry settings, results and overrides, in the source order'
);
select is(
  array(
    select model_path from public.quote_items
    where quote_id = (select id from public.quotes where client_id = 910001 and id <> 910001)
    order by id
  ),
  array(
    select (select id from public.quotes where client_id = 910001 and id <> 910001) || u.path
    from unnest(array['/n1/sliced.stl', '/n2/waiting.stl', '/n3/bare.stl']) with ordinality as u (path, n)
    order by u.n
  ),
  'items point at the copied files'
);
select is(
  (select count(*)::int from public.quote_items
   where quote_id = (select id from public.quotes where client_id = 910001 and id <> 910001)
     and (material_cost is not null or computed_total is not null or markup_pct is not null or priced_at is not null)),
  0,
  'the price breakdown is not copied'
);
select results_eq(
  $$select j.status, j.attempts, j.print_time_s, j.filament_g, j.filament_mm, j.layer_count,
           j.bbox_x_mm, j.bbox_y_mm, j.bbox_z_mm, j.slicer_version, j.finished_at is not null
    from public.slicing_jobs j
    join public.quote_items i on i.id = j.quote_item_id
    where i.quote_id = (select id from public.quotes where client_id = 910001 and id <> 910001)
      and i.description = 'Sliced part'$$,
  $$values ('succeeded'::text, 2::smallint, 19800, 120.00::numeric, 40000.00::numeric, 266,
            100.0::numeric, 80.0::numeric, 40.0::numeric, 'PrusaSlicer 2.9.0'::text, true)$$,
  'a sliced item gets one succeeded job, with the newest succeeded job''s details'
);
select is(
  (select count(*)::int from public.slicing_jobs j
   join public.quote_items i on i.id = j.quote_item_id
   where i.quote_id = (select id from public.quotes where client_id = 910001 and id <> 910001)
     and i.description = 'Waiting part' and j.status = 'queued'),
  1,
  'an unsliced item with printer and material is queued'
);
select is(
  (select (message ->> 'job_id')::bigint from pgmq.q_slicing_jobs),
  (select j.id from public.slicing_jobs j
   join public.quote_items i on i.id = j.quote_item_id
   where i.quote_id = (select id from public.quotes where client_id = 910001 and id <> 910001)
     and i.description = 'Waiting part'),
  'its queue message is sent'
);
select is(
  (select count(*)::int from public.slicing_jobs j
   join public.quote_items i on i.id = j.quote_item_id
   where i.quote_id = (select id from public.quotes where client_id = 910001 and id <> 910001)
     and i.description = 'Bare part'),
  0,
  'an item without printer or material gets no job'
);

select * from finish();
rollback;
