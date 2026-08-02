-- =============================================================================
-- 0002 — Avatar / foto de perfil (Melhoria #1)
--
-- `profiles.avatar_url` já existe desde a 0001; aqui criamos apenas o bucket
-- privado e as policies de storage. Guardamos em avatar_url o CAMINHO do
-- storage (ex.: "<uuid>/abc.webp"), nunca a URL assinada — ela expira.
-- =============================================================================

begin;

-- Bucket privado, 2 MB, allowlist de MIME.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152,
        array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- RLS: o primeiro segmento do caminho é o uuid do dono.
drop policy if exists avatars_select_own on storage.objects;
create policy avatars_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars'
              and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

comment on column public.profiles.avatar_url is
  'Caminho do objeto no bucket "avatars" (ex.: "<user_id>/<uuid>.webp"). NUNCA guardar URL assinada.';

commit;
