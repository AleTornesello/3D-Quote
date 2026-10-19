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

-- quotes: staff create and edit drafts, owners delete drafts
create policy quotes_select on public.quotes
  for select to authenticated using ((select private.is_staff()));
create policy quotes_insert on public.quotes
  for insert to authenticated with check ((select private.is_staff()));
create policy quotes_update on public.quotes
  for update to authenticated
  using ((select private.is_staff()) and status = 'draft')
  with check ((select private.is_staff()) and status = 'draft');
create policy quotes_delete on public.quotes
  for delete to authenticated using ((select private.is_owner()) and status = 'draft');

-- consumables: staff read, owners write
create policy consumables_select on public.consumables
  for select to authenticated using ((select private.is_staff()));
create policy consumables_insert on public.consumables
  for insert to authenticated with check ((select private.is_owner()));
create policy consumables_update on public.consumables
  for update to authenticated using ((select private.is_owner())) with check ((select private.is_owner()));
create policy consumables_delete on public.consumables
  for delete to authenticated using ((select private.is_owner()));

-- quote_consumables: staff read; staff edit and remove lines of draft quotes (adding goes through add_quote_consumable)
create policy quote_consumables_select on public.quote_consumables
  for select to authenticated using ((select private.is_staff()));
create policy quote_consumables_update on public.quote_consumables
  for update to authenticated
  using (
    (select private.is_staff())
    and exists (select 1 from public.quotes q where q.id = quote_id and q.status = 'draft')
  )
  with check (
    (select private.is_staff())
    and exists (select 1 from public.quotes q where q.id = quote_id and q.status = 'draft')
  );
create policy quote_consumables_delete on public.quote_consumables
  for delete to authenticated
  using (
    (select private.is_staff())
    and exists (select 1 from public.quotes q where q.id = quote_id and q.status = 'draft')
  );

-- quote_plates / quote_plate_materials: staff read; staff edit and remove rows of draft quotes (creation goes
-- through create_quote_plate and save_plate_material)
create policy quote_plates_select on public.quote_plates
  for select to authenticated using ((select private.is_staff()));
create policy quote_plates_update on public.quote_plates
  for update to authenticated
  using (
    (select private.is_staff())
    and exists (select 1 from public.quotes q where q.id = quote_id and q.status = 'draft')
  )
  with check (
    (select private.is_staff())
    and exists (select 1 from public.quotes q where q.id = quote_id and q.status = 'draft')
  );
create policy quote_plates_delete on public.quote_plates
  for delete to authenticated
  using (
    (select private.is_staff())
    and exists (select 1 from public.quotes q where q.id = quote_id and q.status = 'draft')
  );

create policy quote_plate_materials_select on public.quote_plate_materials
  for select to authenticated using ((select private.is_staff()));
create policy quote_plate_materials_update on public.quote_plate_materials
  for update to authenticated
  using (
    (select private.is_staff())
    and exists (
      select 1 from public.quote_plates p join public.quotes q on q.id = p.quote_id
      where p.id = plate_id and q.status = 'draft'
    )
  )
  with check (
    (select private.is_staff())
    and exists (
      select 1 from public.quote_plates p join public.quotes q on q.id = p.quote_id
      where p.id = plate_id and q.status = 'draft'
    )
  );
create policy quote_plate_materials_delete on public.quote_plate_materials
  for delete to authenticated
  using (
    (select private.is_staff())
    and exists (
      select 1 from public.quote_plates p join public.quotes q on q.id = p.quote_id
      where p.id = plate_id and q.status = 'draft'
    )
  );
