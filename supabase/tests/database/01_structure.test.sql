begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select is(
  array(
    select n.nspname || '.' || c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private') and c.relkind = 'r' and not c.relrowsecurity
    order by 1
  ),
  array[]::text[],
  'RLS is enabled on every table in public and private'
);

select is(
  array(
    select con.conrelid::regclass::text || ' ' || con.conname
    from pg_constraint con
    join pg_namespace n on n.oid = con.connamespace
    where con.contype = 'f' and n.nspname = 'public'
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = con.conrelid
          and (
            select array_agg(k order by ord)
            from unnest(i.indkey::int2[]) with ordinality as u (k, ord)
            where ord <= cardinality(con.conkey)
          ) = con.conkey
      )
    order by 1
  ),
  array[]::text[],
  'every foreign key in public has an index starting with its column'
);

select is(
  array(
    select c.relname::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
      and has_table_privilege('anon', c.oid, 'select, insert, update, delete')
    order by 1
  ),
  array[]::text[],
  'anon has no privileges on any public table'
);

select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
    order by 1
  ),
  array[]::text[],
  'anon cannot execute any function in public or private'
);

select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) as cfg where cfg like 'search_path=%'
      )
    order by 1
  ),
  array[]::text[],
  'every function in public and private pins its search_path'
);

select is(
  array(
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
    order by 1
  ),
  array[]::text[],
  'no security definer function is exposed in public'
);

select * from finish();
rollback;
