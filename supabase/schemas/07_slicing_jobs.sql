-- Slicing jobs: the durable record of each slicing request. The pgmq message carries job_id.

create table public.slicing_jobs (
  id bigint generated always as identity primary key,
  quote_item_id bigint not null references public.quote_items (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  attempts smallint not null default 0 check (attempts >= 0),
  error text,
  print_time_s integer,
  filament_g numeric(10,2),
  filament_mm numeric(10,2),
  layer_count integer,
  bbox_x_mm numeric(6,1),
  bbox_y_mm numeric(6,1),
  bbox_z_mm numeric(6,1),
  slicer_version text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- Serves the foreign key and "latest job of an item" lookups.
create index slicing_jobs_quote_item_id_idx on public.slicing_jobs (quote_item_id, id desc);

alter table public.slicing_jobs enable row level security;
