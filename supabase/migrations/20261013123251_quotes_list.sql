create or replace view "public"."quotes_list" as  SELECT q.id,
    q.number,
    q.number_year,
    q.number_seq,
    q.status,
    q.client_id,
    c.name AS client_name,
    c.company AS client_company,
    q.valid_until,
    q.sent_at,
    q.created_at,
    ((q.created_at AT TIME ZONE 'Europe/Rome'::text))::date AS created_on,
    q.created_by,
    s.display_name AS created_by_name,
    i.item_count,
        CASE
            WHEN ((i.item_count > 0) AND (i.unpriced_count = 0)) THEN i.total
            ELSE NULL::numeric
        END AS total
   FROM (((public.quotes q
     JOIN public.clients c ON ((c.id = q.client_id)))
     JOIN public.staff s ON ((s.user_id = q.created_by)))
     CROSS JOIN LATERAL ( SELECT (count(*))::integer AS item_count,
            (count(*) FILTER (WHERE (qi.item_total IS NULL)))::integer AS unpriced_count,
            sum(qi.item_total) AS total
           FROM public.quote_items qi
          WHERE (qi.quote_id = q.id)) i);



