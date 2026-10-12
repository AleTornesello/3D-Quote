set check_function_bodies = off;

CREATE OR REPLACE FUNCTION private.list_staff()
 RETURNS TABLE(user_id uuid, display_name text, email text, role text, language text, active boolean, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  if not private.is_owner() then
    raise exception 'owner_required' using errcode = '42501';
  end if;
  return query
  select s.user_id, s.display_name, u.email::text, s.role, s.language, s.active, s.created_at
  from public.staff s
  join auth.users u on u.id = s.user_id
  order by s.display_name, s.user_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.list_staff()
 RETURNS TABLE(user_id uuid, display_name text, email text, role text, language text, active boolean, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select * from private.list_staff();
$function$
;


