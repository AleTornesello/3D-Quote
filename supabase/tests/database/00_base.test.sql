begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select has_schema('private', 'the private schema exists');
select ok(exists (select 1 from pg_extension where extname = 'pgmq'), 'pgmq is installed');
select ok(exists (select 1 from pg_extension where extname = 'pg_cron'), 'pg_cron is installed');
select is(private.shop_today(), (now() at time zone 'Europe/Rome')::date, 'shop_today is the date in Europe/Rome');
select has_function('private', 'set_updated_at', 'the updated_at trigger function exists');

select * from finish();
rollback;
