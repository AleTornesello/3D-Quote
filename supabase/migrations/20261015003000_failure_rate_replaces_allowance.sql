-- The failure allowance is now per printer. Carry the shop-wide value over so existing prices stay the same.
update public.printers set failure_rate = round(s.failure_allowance_pct)::integer
from public.settings s
where s.id = 1;

alter table "public"."settings" drop constraint "settings_failure_allowance_pct_check";

alter table "public"."settings" drop column "failure_allowance_pct";
