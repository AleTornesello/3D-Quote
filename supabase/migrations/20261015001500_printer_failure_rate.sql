alter table "public"."printers" add column "failure_rate" integer not null default 0;

alter table "public"."printers" add constraint "printers_failure_rate_check" CHECK (((failure_rate >= 0) AND (failure_rate <= 100))) not valid;

alter table "public"."printers" validate constraint "printers_failure_rate_check";
