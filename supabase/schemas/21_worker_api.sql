-- Functions used by the slicer-worker (service role only). Each changes the job, the item and the queue message in
-- one transaction. See docs/services/slicer-worker.md#processing-loop.

-- Reads the next message and marks its job running. Messages read more than max_attempts times (the worker died on
-- every attempt) fail their job and are archived; messages whose job no longer exists are archived. Returns no rows
-- when nothing is ready.
create or replace function private.worker_claim_job(p_visibility_timeout_s integer, p_max_attempts integer)
returns table (msg_id bigint, read_ct integer, message jsonb)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_msg record;
  v_job_id bigint;
begin
  loop
    select m.msg_id, m.read_ct, m.message into v_msg
    from pgmq.read('slicing_jobs', p_visibility_timeout_s, 1) as m;
    if not found then
      return;
    end if;

    select j.id into v_job_id
    from public.slicing_jobs j
    where j.id = (v_msg.message ->> 'job_id')::bigint
    for update;

    if not found then
      perform pgmq.archive('slicing_jobs', v_msg.msg_id);
    elsif v_msg.read_ct > p_max_attempts then
      update public.slicing_jobs
      set status = 'failed', error = 'worker stopped on every attempt', finished_at = now()
      where id = v_job_id;
      perform pgmq.archive('slicing_jobs', v_msg.msg_id);
    else
      update public.slicing_jobs
      set status = 'running', started_at = now(), attempts = v_msg.read_ct
      where id = v_job_id;
      return query select v_msg.msg_id, v_msg.read_ct, v_msg.message;
      return;
    end if;
  end loop;
end;
$$;

create or replace function public.worker_claim_job(visibility_timeout_s integer, max_attempts integer)
returns table (msg_id bigint, read_ct integer, message jsonb)
language sql
security invoker
set search_path = ''
as $$
  select * from private.worker_claim_job($1, $2);
$$;

-- Stores the results, deletes the message, and copies the results onto the item only when this is the item's
-- newest job and the quote is still a draft, so a slow older job never overwrites newer results.
create or replace function private.worker_complete_job(p_msg_id bigint, p_job_id bigint, p_results jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.slicing_jobs;
begin
  if p_results is null
     or p_results ->> 'print_time_s' is null
     or p_results ->> 'filament_g' is null
     or p_results ->> 'bbox_x_mm' is null
     or p_results ->> 'bbox_y_mm' is null
     or p_results ->> 'bbox_z_mm' is null then
    raise exception 'invalid_results' using errcode = '22023';
  end if;

  select * into v_job from public.slicing_jobs where id = p_job_id for update;
  if not found then
    -- The item (and its jobs) was deleted while the job ran.
    perform pgmq.archive('slicing_jobs', p_msg_id);
    return;
  end if;

  update public.slicing_jobs set
    status = 'succeeded',
    error = null,
    finished_at = now(),
    print_time_s = (p_results ->> 'print_time_s')::integer,
    filament_g = (p_results ->> 'filament_g')::numeric,
    filament_mm = (p_results ->> 'filament_mm')::numeric,
    layer_count = (p_results ->> 'layer_count')::integer,
    bbox_x_mm = (p_results ->> 'bbox_x_mm')::numeric,
    bbox_y_mm = (p_results ->> 'bbox_y_mm')::numeric,
    bbox_z_mm = (p_results ->> 'bbox_z_mm')::numeric,
    slicer_version = p_results ->> 'slicer_version'
  where id = p_job_id;

  update public.quote_items i set
    print_time_s = (p_results ->> 'print_time_s')::integer,
    filament_g = (p_results ->> 'filament_g')::numeric,
    bbox_x_mm = (p_results ->> 'bbox_x_mm')::numeric,
    bbox_y_mm = (p_results ->> 'bbox_y_mm')::numeric,
    bbox_z_mm = (p_results ->> 'bbox_z_mm')::numeric
  where i.id = v_job.quote_item_id
    and p_job_id = (select max(j.id) from public.slicing_jobs j where j.quote_item_id = i.id)
    and exists (select 1 from public.quotes q where q.id = i.quote_id and q.status = 'draft');

  perform pgmq.delete('slicing_jobs', p_msg_id);
end;
$$;

create or replace function public.worker_complete_job(msg_id bigint, job_id bigint, results jsonb)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.worker_complete_job($1, $2, $3);
$$;

-- Records an error. Final: the job fails and the message is archived. Otherwise the job goes back to queued and
-- the message reappears after its visibility timeout.
create or replace function private.worker_fail_job(p_msg_id bigint, p_job_id bigint, p_error text, p_final boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.slicing_jobs where id = p_job_id for update;
  if not found then
    perform pgmq.archive('slicing_jobs', p_msg_id);
    return;
  end if;

  if p_final then
    update public.slicing_jobs set status = 'failed', error = p_error, finished_at = now() where id = p_job_id;
    perform pgmq.archive('slicing_jobs', p_msg_id);
  else
    update public.slicing_jobs set status = 'queued', error = p_error where id = p_job_id;
  end if;
end;
$$;

create or replace function public.worker_fail_job(msg_id bigint, job_id bigint, error text, final boolean)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.worker_fail_job($1, $2, $3, $4);
$$;
