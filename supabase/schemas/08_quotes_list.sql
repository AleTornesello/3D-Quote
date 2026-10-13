-- The quotes list (home page). security_invoker: the caller's RLS on every joined table applies.
-- total is null while the quote has no items or any item has no price, so the list shows "—".

create view public.quotes_list
with (security_invoker = true) as
select
  q.id,
  q.number,
  q.number_year,
  q.number_seq,
  q.status,
  q.client_id,
  c.name as client_name,
  c.company as client_company,
  q.valid_until,
  q.sent_at,
  q.created_at,
  (q.created_at at time zone 'Europe/Rome')::date as created_on,
  q.created_by,
  s.display_name as created_by_name,
  i.item_count,
  case when i.item_count > 0 and i.unpriced_count = 0 then i.total end as total
from public.quotes q
join public.clients c on c.id = q.client_id
join public.staff s on s.user_id = q.created_by
cross join lateral (
  select
    count(*)::integer as item_count,
    count(*) filter (where qi.item_total is null)::integer as unpriced_count,
    sum(qi.item_total) as total
  from public.quote_items qi
  where qi.quote_id = q.id
) i;
