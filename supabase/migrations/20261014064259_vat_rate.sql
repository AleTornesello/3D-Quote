alter table "public"."settings" add column "vat_rate_pct" numeric(5,2) not null default 22;

alter table "public"."quotes" add column "vat_rate_pct" numeric(5,2);

-- Backfill: existing non-draft quotes would otherwise violate quotes_vat_rate_check. The guard and updated_at
-- triggers are switched off so history is left as it was.
alter table public.quotes disable trigger quotes_guard;
alter table public.quotes disable trigger quotes_set_updated_at;
update public.quotes
set vat_rate_pct = (select vat_rate_pct from public.settings where id = 1)
where status <> 'draft';
alter table public.quotes enable trigger quotes_guard;
alter table public.quotes enable trigger quotes_set_updated_at;

alter table "public"."quotes" add constraint "quotes_vat_rate_check" CHECK (((status = 'draft'::text) = (vat_rate_pct IS NULL))) not valid;

alter table "public"."quotes" validate constraint "quotes_vat_rate_check";

alter table "public"."quotes" add constraint "quotes_vat_rate_pct_check" CHECK (((vat_rate_pct >= (0)::numeric) AND (vat_rate_pct <= (100)::numeric))) not valid;

alter table "public"."quotes" validate constraint "quotes_vat_rate_pct_check";

alter table "public"."settings" add constraint "settings_vat_rate_pct_check" CHECK (((vat_rate_pct >= (0)::numeric) AND (vat_rate_pct <= (100)::numeric))) not valid;

alter table "public"."settings" validate constraint "settings_vat_rate_pct_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION private.mark_quote_sent(p_quote_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_staff();
  perform private.require_draft_quote(p_quote_id);
  if exists (select 1 from private.get_quote_send_blockers(p_quote_id)) then
    raise exception 'quote_not_sendable';
  end if;
  update public.quotes
  set status = 'sent',
      sent_at = now(),
      vat_rate_pct = (select vat_rate_pct from public.settings where id = 1)
  where id = p_quote_id;
end;
$function$
;
