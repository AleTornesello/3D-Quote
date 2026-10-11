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

-- printers, materials: staff read, owners write
create policy printers_select on public.printers
  for select to authenticated using ((select private.is_staff()));
create policy printers_insert on public.printers
  for insert to authenticated with check ((select private.is_owner()));
create policy printers_update on public.printers
  for update to authenticated using ((select private.is_owner())) with check ((select private.is_owner()));
create policy printers_delete on public.printers
  for delete to authenticated using ((select private.is_owner()));

create policy materials_select on public.materials
  for select to authenticated using ((select private.is_staff()));
create policy materials_insert on public.materials
  for insert to authenticated with check ((select private.is_owner()));
create policy materials_update on public.materials
  for update to authenticated using ((select private.is_owner())) with check ((select private.is_owner()));
create policy materials_delete on public.materials
  for delete to authenticated using ((select private.is_owner()));

-- settings: staff read, owners update the single row
create policy settings_select on public.settings
  for select to authenticated using ((select private.is_staff()));
create policy settings_update on public.settings
  for update to authenticated using ((select private.is_owner())) with check ((select private.is_owner()));

-- clients: staff read and write, owners delete
create policy clients_select on public.clients
  for select to authenticated using ((select private.is_staff()));
create policy clients_insert on public.clients
  for insert to authenticated with check ((select private.is_staff()));
create policy clients_update on public.clients
  for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy clients_delete on public.clients
  for delete to authenticated using ((select private.is_owner()));
