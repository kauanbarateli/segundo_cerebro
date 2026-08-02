-- =============================================================================
-- 0007 — Drive (arquivos e pastas)
--
-- Metadados no Postgres, bytes no Supabase Storage (bucket privado "drive").
-- Convenção de caminho: "<user_id>/<uuid>" — o primeiro segmento é o dono, o
-- que permite escrever a policy de storage. O NOME real do arquivo vive só nos
-- metadados, então renomear NÃO move bytes.
--
-- Armadilhas tratadas aqui:
--   1. UNIQUE com parent_id NULL — NULLs são distintos entre si no Postgres,
--      então "unique (parent_id, name)" NÃO impediria duas pastas homônimas na
--      raiz. Resolvido com dois índices únicos parciais.
--   2. Ciclo ao mover pasta para dentro da própria descendente — trigger com
--      CTE recursiva.
--   3. Exclusão de pasta = os bytes no Storage NÃO somem sozinhos. O ON DELETE
--      CASCADE limpa só as linhas; a limpeza dos objetos é da aplicação.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Bucket privado. 50 MB por arquivo, sem allowlist de MIME (é um drive geral),
-- mas a aplicação bloqueia executáveis.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('drive', 'drive', false, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists drive_select_own on storage.objects;
create policy drive_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'drive'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists drive_insert_own on storage.objects;
create policy drive_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'drive'
              and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists drive_update_own on storage.objects;
create policy drive_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'drive'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists drive_delete_own on storage.objects;
create policy drive_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'drive'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

-- -----------------------------------------------------------------------------
-- Pastas (lista de adjacência). parent_id NULL = raiz.
-- -----------------------------------------------------------------------------
create table if not exists public.drive_folders (
  id         uuid primary key default extensions.gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  parent_id  uuid references public.drive_folders (id) on delete cascade,
  name       text not null,
  color_key  text not null default 'stone',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint drive_folders_name_not_blank check (btrim(name) <> ''),
  -- Barra quebraria a montagem de caminho na UI.
  constraint drive_folders_name_no_slash check (name !~ '/')
);
comment on table public.drive_folders is
  'Pastas do Drive. parent_id NULL = raiz. Hierarquia por lista de adjacência.';

create index if not exists drive_folders_user_idx   on public.drive_folders (user_id);
create index if not exists drive_folders_parent_idx on public.drive_folders (user_id, parent_id)
  where deleted_at is null;

-- Unicidade de nome por pasta. Dois índices parciais porque, no Postgres,
-- NULL <> NULL — um único UNIQUE(parent_id, name) deixaria passar duplicatas
-- na raiz.
create unique index if not exists drive_folders_unique_named
  on public.drive_folders (user_id, parent_id, lower(btrim(name)))
  where deleted_at is null and parent_id is not null;

create unique index if not exists drive_folders_unique_root
  on public.drive_folders (user_id, lower(btrim(name)))
  where deleted_at is null and parent_id is null;

-- -----------------------------------------------------------------------------
-- Arquivos
-- -----------------------------------------------------------------------------
create table if not exists public.drive_files (
  id           uuid primary key default extensions.gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  folder_id    uuid references public.drive_folders (id) on delete cascade,
  name         text not null,
  storage_path text not null,
  mime_type    text,
  size_bytes   bigint not null default 0,
  starred      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint drive_files_name_not_blank check (btrim(name) <> ''),
  constraint drive_files_name_no_slash check (name !~ '/'),
  constraint drive_files_size_non_negative check (size_bytes >= 0),
  constraint drive_files_storage_path_unique unique (storage_path)
);
comment on table public.drive_files is
  'Metadados dos arquivos. Bytes ficam no bucket "drive". Renomear altera só o metadado.';
comment on column public.drive_files.storage_path is
  'Caminho no bucket: "<user_id>/<uuid>". Imutável — desacopla nome de exibição do objeto.';

create index if not exists drive_files_user_idx   on public.drive_files (user_id);
create index if not exists drive_files_folder_idx on public.drive_files (user_id, folder_id)
  where deleted_at is null;
create index if not exists drive_files_trash_idx  on public.drive_files (user_id, deleted_at)
  where deleted_at is not null;

create unique index if not exists drive_files_unique_named
  on public.drive_files (user_id, folder_id, lower(btrim(name)))
  where deleted_at is null and folder_id is not null;

create unique index if not exists drive_files_unique_root
  on public.drive_files (user_id, lower(btrim(name)))
  where deleted_at is null and folder_id is null;

-- -----------------------------------------------------------------------------
-- Proteção contra ciclo: mover uma pasta para dentro de si mesma ou de uma
-- descendente criaria um ramo órfão e travaria a navegação (loop infinito na
-- montagem do breadcrumb).
-- -----------------------------------------------------------------------------
create or replace function public.drive_prevent_folder_cycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ancestor uuid := new.parent_id;
  v_guard    int  := 0;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'Uma pasta não pode ser pai de si mesma';
  end if;

  -- Sobe a cadeia de ancestrais procurando a própria pasta.
  while v_ancestor is not null loop
    v_guard := v_guard + 1;
    if v_guard > 256 then
      raise exception 'Hierarquia de pastas profunda demais (possível ciclo)';
    end if;

    if v_ancestor = new.id then
      raise exception 'Não é possível mover uma pasta para dentro de uma subpasta dela';
    end if;

    select parent_id into v_ancestor
    from public.drive_folders
    where id = v_ancestor;
  end loop;

  return new;
end;
$$;
comment on function public.drive_prevent_folder_cycle() is
  'Impede ciclos na hierarquia de pastas ao inserir/mover.';

drop trigger if exists trg_drive_folders_no_cycle on public.drive_folders;
create trigger trg_drive_folders_no_cycle
  before insert or update of parent_id on public.drive_folders
  for each row execute function public.drive_prevent_folder_cycle();

-- -----------------------------------------------------------------------------
-- Uso de armazenamento (para mostrar a cota consumida)
-- -----------------------------------------------------------------------------
create or replace view public.drive_usage as
select user_id,
       count(*)::bigint                     as file_count,
       coalesce(sum(size_bytes), 0)::bigint as total_bytes
from public.drive_files
where deleted_at is null
group by user_id;

alter view public.drive_usage set (security_invoker = on);
comment on view public.drive_usage is
  'Uso de armazenamento por usuário. security_invoker=on para respeitar a RLS.';

grant select on public.drive_usage to authenticated;
revoke all on public.drive_usage from anon;

-- -----------------------------------------------------------------------------
-- Triggers padrão
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  tbls text[] := array['drive_folders', 'drive_files'];
begin
  foreach t in array tbls loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$I;', t);
    execute format('create trigger trg_%1$s_updated_at before update on public.%1$I
      for each row execute function public.set_updated_at();', t);

    execute format('drop trigger if exists trg_%1$s_lock_user_id on public.%1$I;', t);
    execute format('create trigger trg_%1$s_lock_user_id before update on public.%1$I
      for each row execute function public.prevent_user_id_change();', t);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- RLS + grants
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  tbls text[] := array['drive_folders', 'drive_files'];
begin
  foreach t in array tbls loop
    execute format('alter table public.%I enable row level security;', t);

    execute format('drop policy if exists %1$s_select on public.%1$I;', t);
    execute format('create policy %1$s_select on public.%1$I
      for select to authenticated using ((select auth.uid()) = user_id);', t);

    execute format('drop policy if exists %1$s_insert on public.%1$I;', t);
    execute format('create policy %1$s_insert on public.%1$I
      for insert to authenticated with check ((select auth.uid()) = user_id);', t);

    execute format('drop policy if exists %1$s_update on public.%1$I;', t);
    execute format('create policy %1$s_update on public.%1$I
      for update to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);', t);

    execute format('drop policy if exists %1$s_delete on public.%1$I;', t);
    execute format('create policy %1$s_delete on public.%1$I
      for delete to authenticated using ((select auth.uid()) = user_id);', t);

    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
    execute format('grant all on public.%I to service_role;', t);
    execute format('revoke all on public.%I from anon;', t);
  end loop;
end
$$;

commit;
