-- =============================================================================
-- 0004 — Controle de abas (Melhoria #5)
--
-- Registro dos módulos fica em código (src/lib/modules.ts); aqui guardamos
-- apenas o estado ligado/desligado. Ausência de linha = habilitado, o que
-- torna a migration retrocompatível (nenhum backfill necessário).
-- =============================================================================

begin;

create table if not exists public.user_modules (
  user_id    uuid    not null references auth.users (id) on delete cascade,
  module_key text    not null,
  enabled    boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, module_key),
  constraint user_modules_key_not_blank check (btrim(module_key) <> '')
);

comment on table public.user_modules is
  'Abas ligadas/desligadas por usuário. Ausência de linha = habilitado (padrão).';

create index if not exists user_modules_user_id_idx on public.user_modules (user_id);

drop trigger if exists trg_user_modules_updated_at on public.user_modules;
create trigger trg_user_modules_updated_at
  before update on public.user_modules
  for each row execute function public.set_updated_at();

drop trigger if exists trg_user_modules_lock_user_id on public.user_modules;
create trigger trg_user_modules_lock_user_id
  before update on public.user_modules
  for each row execute function public.prevent_user_id_change();

alter table public.user_modules enable row level security;

drop policy if exists user_modules_select on public.user_modules;
create policy user_modules_select on public.user_modules
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists user_modules_insert on public.user_modules;
create policy user_modules_insert on public.user_modules
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists user_modules_update on public.user_modules;
create policy user_modules_update on public.user_modules
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists user_modules_delete on public.user_modules;
create policy user_modules_delete on public.user_modules
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.user_modules to authenticated;
grant all on public.user_modules to service_role;

commit;
