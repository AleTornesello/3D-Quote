-- Row level security policies. Every policy targets `authenticated`; anon has no grants at all. Helpers are wrapped
-- in (select …) so they run once per statement, not once per row.

-- staff
create policy staff_select on public.staff
  for select to authenticated
  using ((select private.is_staff()));

create policy staff_insert on public.staff
  for insert to authenticated
  with check ((select private.is_owner()));

create policy staff_update on public.staff
  for update to authenticated
  using ((select private.is_owner()) or (user_id = (select auth.uid()) and (select private.is_staff())))
  with check ((select private.is_owner()) or (user_id = (select auth.uid()) and (select private.is_staff())));
