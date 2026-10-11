-- Storage policies for the models and branding buckets (the buckets themselves are rows, created by the
-- grants_and_setup migration). models: staff read and delete; uploads only into a draft quote's folder.
-- branding: staff read, owners write.

create policy "models: staff read" on storage.objects
  for select to authenticated
  using (bucket_id = 'models' and (select private.is_staff()));
create policy "models: staff upload to draft quotes" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'models' and private.can_upload_model(name));
create policy "models: staff update in draft quotes" on storage.objects
  for update to authenticated
  using (bucket_id = 'models' and (select private.is_staff()))
  with check (bucket_id = 'models' and private.can_upload_model(name));
create policy "models: staff delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'models' and (select private.is_staff()));

create policy "branding: staff read" on storage.objects
  for select to authenticated
  using (bucket_id = 'branding' and (select private.is_staff()));
create policy "branding: owner upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'branding' and (select private.is_owner()));
create policy "branding: owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'branding' and (select private.is_owner()))
  with check (bucket_id = 'branding' and (select private.is_owner()));
create policy "branding: owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'branding' and (select private.is_owner()));
