-- The quotes list (home page). security_invoker: the caller's RLS on every joined table applies.
-- total is null while the quote has no plates or any plate is incomplete or unpriced, so the list shows "—";
-- otherwise it is the plates plus the quote's consumable lines.

create view public.quotes_list
with (security_invoker = true) as
select
  q.id, q.number, q.number_year, q.number_seq, q.status, q.client_id,
  c.name as client_name, c.company as client_company,
  q.valid_until, q.sent_at, q.created_at,
  (q.created_at at time zone 'Europe/Rome')::date as created_on,
  q.created_by, s.display_name as created_by_name,
  p.plate_count,
  case when p.plate_count > 0 and p.open_count = 0 then p.total + k.total end as total
from public.quotes q
join public.clients c on c.id = q.client_id
join public.staff s on s.user_id = q.created_by
cross join lateral (
  select
    count(*)::integer as plate_count,
    count(*) filter (
      where qp.plate_total is null
         or qp.printer_id is null
         or qp.print_time_s is null
         or not exists (select 1 from public.quote_plate_materials m where m.plate_id = qp.id)
    )::integer as open_count,
    sum(qp.plate_total) as total
  from public.quote_plates qp
  where qp.quote_id = q.id
) p
cross join lateral (
  select coalesce(sum(qc.line_total), 0) as total
  from public.quote_consumables qc
  where qc.quote_id = q.id
) k;
