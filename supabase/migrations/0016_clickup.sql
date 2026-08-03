-- =============================================================================
-- 0016 — Integração ClickUp (leitura, status e comentário)
--
-- Duas tabelas, espelhando a separação que o Google já usa desde a 0001:
-- metadado não sensível numa tabela com RLS pelo dono, e o SEGREDO numa tabela
-- que a sessão do navegador não alcança de jeito nenhum.
--
-- =============================================================================
-- ⚠️ POR QUE OS `revoke` ABAIXO NÃO SÃO ZELO
-- =============================================================================
-- A 0014 fechou o acesso de `anon` com um `revoke all on ALL TABLES in schema
-- public` — uma varredura sobre o que existia NAQUELE momento. Tabela criada
-- depois dela não herda nada: o Supabase configura
-- `alter default privileges ... grant all on tables to anon, authenticated`,
-- então toda tabela nova no schema `public` NASCE alcançável.
--
-- A 0014 também acrescentou `alter default privileges ... revoke all on tables
-- from anon`, o que já cobre `anon` para objetos futuros — mas só se a 0014
-- tiver sido aplicada ANTES desta, e só para o papel que a executou. Repetir o
-- revoke aqui torna a garantia local ao arquivo: quem ler a 0016 sozinha vê a
-- tabela nascer fechada, sem precisar auditar a ordem de aplicação.
--
-- Para `clickup_credentials` a repetição não é opcional em hipótese nenhuma:
-- `authenticated` NUNCA teve revoke em massa (é o papel da aplicação), então
-- sem a linha explícita a tabela do token nasceria legível pela sessão do
-- navegador.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- clickup_accounts — metadado. Nada aqui é segredo.
--
-- `user_id` é UNIQUE: uma conexão por pessoa, garantido no banco e não na
-- aplicação. Duas conexões simultâneas não teriam significado (qual token o
-- `listarMinhasTarefas` usaria?), e uma constraint fecha o caso que um
-- `if (jaExiste)` na action perderia numa corrida entre duas abas.
--
-- `clickup_user_id` é `text` e não uuid: o id do ClickUp é numérico, vem como
-- string na API, e o formato é deles. Guardar como texto evita uma conversão
-- que só existiria para ser desfeita na hora de montar `assignees[]`.
-- -----------------------------------------------------------------------------
create table if not exists public.clickup_accounts (
  id                uuid primary key default extensions.gen_random_uuid(),
  user_id           uuid not null unique references auth.users (id) on delete cascade,

  -- Quem eu sou no ClickUp. `clickup_user_id` é o filtro de `assignees[]` —
  -- é ele que faz "minhas tarefas" significar minhas.
  clickup_user_id   text not null,
  clickup_username  text,
  clickup_email     extensions.citext,

  -- O `team_id` da API v2. O ClickUp chama de "team" na rota e de "workspace"
  -- na interface; o nome da coluna segue a interface, que é o que o usuário lê.
  workspace_id      text not null,
  workspace_name    text,

  -- O liga/desliga. Diferente de desconectar: `enabled = false` esconde a aba e
  -- para as chamadas, mas o token continua gravado.
  enabled           boolean not null default true,

  -- Filtro opcional por Space. Vazio = todos. `text[]` e não tabela de junção
  -- porque é uma lista curta de ids opacos, sem atributo próprio e sem
  -- integridade referencial possível (os ids são do ClickUp, não daqui).
  space_ids         text[] not null default '{}',

  -- connected | invalid | error. `invalid` é token recusado (401); `error` é
  -- falha de rede ou 5xx. A distinção importa na tela: um pede reconectar, o
  -- outro pede esperar.
  status            text not null default 'connected'
                    constraint clickup_accounts_status_check
                    check (status in ('connected', 'invalid', 'error')),
  last_error        text,
  last_checked_at   timestamptz,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.clickup_accounts is
  'Metadado da conexao com o ClickUp (quem sou la, qual workspace, ligado ou nao). NAO contem segredo: o token vive em clickup_credentials. RLS pelo dono. user_id UNIQUE = uma conexao por pessoa.';
comment on column public.clickup_accounts.clickup_user_id is
  'Meu id no ClickUp. E o filtro de assignees[] em toda listagem e a base da verificacao de responsabilidade antes de qualquer escrita.';
comment on column public.clickup_accounts.enabled is
  'Liga/desliga. Diferente de desconectar: false esconde a aba e para as chamadas, mas o token permanece gravado.';

create trigger trg_clickup_accounts_updated_at
  before update on public.clickup_accounts
  for each row execute function public.set_updated_at();

-- Impede que uma linha existente troque de dono. Existe desde a 0001 e vale
-- aqui pelo mesmo motivo das outras tabelas pessoais.
create trigger trg_clickup_accounts_lock_user_id
  before update on public.clickup_accounts
  for each row execute function public.prevent_user_id_change();

alter table public.clickup_accounts enable row level security;

drop policy if exists clickup_accounts_select on public.clickup_accounts;
create policy clickup_accounts_select on public.clickup_accounts
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists clickup_accounts_insert on public.clickup_accounts;
create policy clickup_accounts_insert on public.clickup_accounts
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists clickup_accounts_update on public.clickup_accounts;
create policy clickup_accounts_update on public.clickup_accounts
  for update to authenticated using ((select auth.uid()) = user_id)
                                with check ((select auth.uid()) = user_id);

drop policy if exists clickup_accounts_delete on public.clickup_accounts;
create policy clickup_accounts_delete on public.clickup_accounts
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.clickup_accounts to authenticated;
revoke all on table public.clickup_accounts from anon;


-- -----------------------------------------------------------------------------
-- clickup_credentials — o token pessoal do ClickUp, cifrado.
--
-- O MOLDE É `google_oauth_credentials` (0001), literalmente, e a combinação
-- abaixo é o que fecha a tabela:
--
--   RLS LIGADA + NENHUMA POLICY  → toda consulta de `authenticated` ou `anon`
--     devolve zero linhas, porque sem policy não há nada que autorize.
--   GRANTS REVOGADOS             → a operação nem chega a ser tentada. É a
--     segunda camada: se um dia alguém criar uma policy aqui por engano, o
--     privilégio ausente ainda barra.
--   service_role                 → ignora RLS, e é o único caminho. Só código
--     de servidor (src/lib/clickup/credentials.ts) o usa.
--
-- POR QUE UM TOKEN PESSOAL DO CLICKUP MERECE ESSE CUIDADO: ele não tem escopo.
-- É a chave da conta inteira no workspace da empresa — apagar tarefa, criar,
-- mexer em qualquer coisa que a pessoa possa mexer. A limitação do aplicativo a
-- oito operações mora no CÓDIGO (src/lib/clickup/capabilities.ts) e não no
-- token; quem obtiver o token não fica limitado a nada.
--
-- `crypto_version` default 2 (e não 1 como na 0001): esta tabela nasce depois
-- da 0015, então nunca terá linha no formato legado. O default declara isso.
-- -----------------------------------------------------------------------------
create table if not exists public.clickup_credentials (
  clickup_account_id uuid primary key
                     references public.clickup_accounts (id) on delete cascade,
  token_ciphertext   bytea not null,
  token_iv           bytea not null,
  crypto_version     smallint not null default 2,
  key_id             text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.clickup_credentials is
  'SERVER ONLY. Token pessoal do ClickUp cifrado (AES-256-GCM, AAD com namespace "clickup:"). RLS ligada SEM policy + grants revogados => inacessivel a anon e authenticated. Alcancavel so via service_role. ON DELETE CASCADE: apagar a conta apaga o token.';
comment on column public.clickup_credentials.key_id is
  'Qual chave de TOKEN_ENCRYPTION_KEYS cifrou esta linha. Mesma mecanica da 0015 — permite rotacionar sem reconectar.';
comment on column public.clickup_credentials.crypto_version is
  'Formato da cifragem. Nasce em 2 (AAD + key_id): esta tabela e posterior a 0015 e nunca tera linha no formato legado.';

create trigger trg_clickup_credentials_updated_at
  before update on public.clickup_credentials
  for each row execute function public.set_updated_at();

alter table public.clickup_credentials enable row level security;
-- NENHUMA POLICY, de propósito. Ver o comentário acima.

revoke all on table public.clickup_credentials from anon, authenticated;
grant all on table public.clickup_credentials to service_role;


-- -----------------------------------------------------------------------------
-- Índice
--
-- Só um, e só o que é consultado: toda leitura desta integração começa por
-- "qual é a conexão DESTE usuário?". O UNIQUE de `user_id` já cria o índice que
-- atende essa consulta, então não há índice a acrescentar — registrado aqui
-- para que a ausência seja lida como conclusão, não como esquecimento.
-- -----------------------------------------------------------------------------
