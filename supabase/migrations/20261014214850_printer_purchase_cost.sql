alter table "public"."printers" add column "lifetime_hours" integer;

alter table "public"."printers" add column "purchase_cost" numeric(12,2);

alter table "public"."printers" add constraint "printers_lifetime_hours_check" CHECK ((lifetime_hours > 0)) not valid;

alter table "public"."printers" validate constraint "printers_lifetime_hours_check";

alter table "public"."printers" add constraint "printers_purchase_cost_check" CHECK ((purchase_cost > (0)::numeric)) not valid;

alter table "public"."printers" validate constraint "printers_purchase_cost_check";

alter table "public"."printers" add constraint "printers_purchase_pair" CHECK (((purchase_cost IS NULL) = (lifetime_hours IS NULL))) not valid;

alter table "public"."printers" validate constraint "printers_purchase_pair";
