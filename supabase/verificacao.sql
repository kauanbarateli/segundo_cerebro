-- =============================================================================
-- Verificação — SOMENTE LEITURA. Nada aqui altera dados.
--
-- Este arquivo NÃO é uma migration e não deve ser aplicado por
-- `supabase db push`. Ele existe para responder, com evidência, "o banco está
-- no estado que a aplicação espera?".
--
-- Uso: abra o SQL Editor do Supabase e rode um bloco de cada vez.
--
-- Os números dos blocos são ESTÁVEIS: a migration 0008 e o plano de execução
-- citam "BLOCO 6" e "BLOCO 7" por número. Por isso os blocos novos (8 a 11)
-- entraram antes do 7 em vez de empurrá-lo para frente — o 7 é higiene e não
-- responde por nenhuma migration, então ficar por último não atrapalha.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- BLOCO 1 — Quais migrations já foram aplicadas?
--
-- Cada linha responde por uma migration. `false` em qualquer coluna significa
-- que aquela migration ainda não rodou.
-- -----------------------------------------------------------------------------
select
  to_regclass('public.profiles')          is not null as "0001_inicial",
  exists (select 1 from storage.buckets where id = 'avatars')
                                                      as "0002_avatar",
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'tasks'
            and column_name = 'board_position')       as "0003_kanban",
  to_regclass('public.user_modules')      is not null as "0004_modulos",
  to_regclass('public.finance_accounts')  is not null as "0005_financeiro",
  to_regclass('public.notification_deliveries')
                                          is not null as "0006_notificacoes",
  to_regclass('public.drive_files')       is not null as "0007_drive",
  to_regclass('public.tasks_user_scheduled_idx')
                                          is not null as "0008_indices",
  to_regclass('public.task_capture_links') is not null as "0009_vinculos",
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'finance_accounts'
            and column_name = 'credit_limit_cents')   as "0010_cartoes",
  to_regclass('public.knowledge_pages')   is not null as "0011_conhecimento",
  to_regclass('public.social_links')      is not null as "0012_redes",
  exists (select 1 from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname = 'purge_audit_events')       as "0013_retencao",
  -- A 0014 não cria objeto nenhum: ela só revoga. O sinal de que rodou é o
  -- privilégio ter SUMIDO — daí a negação.
  not has_table_privilege('anon', 'public.tasks', 'select')
                                                      as "0014_fecha_anon",
  exists (select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = 'google_oauth_credentials'
            and column_name = 'key_id')               as "0015_key_id",
  to_regclass('public.clickup_accounts')  is not null as "0016_clickup";


-- -----------------------------------------------------------------------------
-- BLOCO 2 — Diagnóstico do Drive (correção C3: "não dá para anexar arquivos")
--
-- Leia o resultado assim:
--   tabelas_ok = false            -> CAUSA A: rode 0007_drive.sql
--   bucket_ok  = false            -> CAUSA A: rode 0007_drive.sql
--   policies_storage < 4          -> CAUSA B: as policies do Storage não foram
--                                    criadas. O SQL Editor às vezes recusa
--                                    `create policy on storage.objects` com
--                                    "42501: must be owner of table objects".
--                                    Nesse caso crie as 4 pelo Dashboard, em
--                                    Storage -> Policies (bucket "drive").
-- -----------------------------------------------------------------------------
select
  (to_regclass('public.drive_files') is not null
   and to_regclass('public.drive_folders') is not null)          as tabelas_ok,
  exists (select 1 from storage.buckets where id = 'drive')      as bucket_ok,
  (select file_size_limit from storage.buckets where id = 'drive') as limite_bytes,
  (select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'drive\_%')                            as policies_storage;


-- -----------------------------------------------------------------------------
-- BLOCO 3 — RLS ativo em todas as tabelas pessoais
--
-- Toda tabela listada deve ter rls_ativo = true. Uma linha com `false` é um
-- vazamento em potencial entre usuários.
-- -----------------------------------------------------------------------------
select relname as tabela, relrowsecurity as rls_ativo
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r'
order by relrowsecurity, relname;


-- -----------------------------------------------------------------------------
-- BLOCO 4 — As views respeitam a RLS?
--
-- CRÍTICO. Sem `security_invoker=on` uma view roda com os privilégios do DONO e
-- IGNORA a RLS das tabelas de base — o que vazaria dados entre usuários.
-- As duas views devem aparecer com security_invoker=true.
-- -----------------------------------------------------------------------------
select c.relname as view_name,
       coalesce(
         (select true from unnest(c.reloptions) o where o = 'security_invoker=on'),
         false
       ) as security_invoker
from pg_class c
where c.relkind = 'v' and c.relnamespace = 'public'::regnamespace
order by c.relname;


-- -----------------------------------------------------------------------------
-- BLOCO 5 — As credenciais do Google continuam inacessíveis ao cliente?
--
-- `google_oauth_credentials` guarda o refresh token cifrado. Ela tem RLS
-- ligada e NENHUMA policy — de propósito. O resultado esperado é ZERO linhas.
-- Qualquer linha aqui é uma regressão grave.
-- -----------------------------------------------------------------------------
select policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'google_oauth_credentials';


-- -----------------------------------------------------------------------------
-- BLOCO 6 — Índices da 0008 presentes?
--
-- Devem aparecer as 2 linhas: tasks_user_scheduled_idx e captures_inbox_idx.
-- (A 0008 cria apenas dois. Os outros três da primeira versão foram
-- descartados por já existirem em 0001/0005 — ver o cabeçalho da migration.)
-- -----------------------------------------------------------------------------
select indexname
from pg_indexes
where schemaname = 'public'
  and indexname in ('tasks_user_scheduled_idx', 'captures_inbox_idx')
order by indexname;


-- -----------------------------------------------------------------------------
-- BLOCO 8 — Vínculos entre entidades (0009) e o soft delete de evento
--
-- A 0009 existe para que "esta tarefa nasceu daquela reunião" sobreviva ao
-- cancelamento do evento no Google. Duas coisas precisam ser verdade:
--
--   1. As três tabelas de junção existem, com RLS.
--   2. Evento cancelado CONTINUA na tabela, com status = 'cancelled'. Se
--      `cancelados` for sempre 0 e você sabe que desmarcou uma reunião, o
--      código voltou a apagar a linha — e o cascade levou o vínculo junto.
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.task_capture_links)    as vinculos_tarefa_captura,
  (select count(*) from public.task_event_links)      as vinculos_tarefa_evento,
  (select count(*) from public.capture_event_links)   as vinculos_captura_evento,
  (select count(*) from public.calendar_events
    where status = 'cancelled')                       as eventos_cancelados,
  (select count(*) from public.calendar_events
    where status is null or status <> 'cancelled')    as eventos_ativos;


-- -----------------------------------------------------------------------------
-- BLOCO 9 — Cartões de crédito (0010)
--
-- `constraint_valida = false` significa que a constraint ficou NOT VALID porque
-- existia cartão sem limite/fechamento/vencimento quando a migration rodou.
-- Ela JÁ VALE para dados novos; para validar o passado, preencha as colunas das
-- contas listadas em `cartoes_incompletos` e rode a 0010 de novo.
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.finance_accounts
    where kind = 'credit_card')                        as cartoes,
  (select count(*) from public.finance_accounts
    where kind = 'credit_card'
      and (credit_limit_cents is null
           or statement_closing_day is null
           or payment_due_day is null))                as cartoes_incompletos,
  (select convalidated from pg_constraint
    where conrelid = 'public.finance_accounts'::regclass
      and conname  = 'finance_accounts_credit_card_fields_check')
                                                       as constraint_valida,
  (select count(*) from public.finance_transactions
    where installment_group_id is not null)            as lancamentos_parcelados;


-- -----------------------------------------------------------------------------
-- BLOCO 10 — Conhecimento (0011): a busca está indexada de verdade?
--
-- `paginas_sem_texto` conta páginas com conteúdo mas sem texto extraído. Deve
-- ser ZERO: a trigger preenche content_text em toda escrita. Qualquer número
-- aqui significa página invisível na busca — e ninguém percebe, porque a busca
-- simplesmente não a devolve.
-- -----------------------------------------------------------------------------
select
  (select count(*) from public.knowledge_notebooks
    where deleted_at is null)                          as cadernos,
  (select count(*) from public.knowledge_pages
    where deleted_at is null)                          as paginas,
  (select count(*) from public.knowledge_pages
    where deleted_at is null
      and content <> '{}'::jsonb
      and coalesce(btrim(content_text), '') = '')      as paginas_sem_texto,
  (select count(*) from pg_indexes
    where schemaname = 'public' and tablename = 'knowledge_pages'
      and indexdef ilike '%gin%')                      as indices_gin;


-- -----------------------------------------------------------------------------
-- BLOCO 11 — Redes sociais (0012): nenhuma URL perigosa passou?
--
-- O resultado esperado é ZERO linhas. Qualquer linha aqui é uma URL que escapou
-- das três barreiras (Zod, CHECK do banco, e o rel="noopener") e vira um <a>
-- clicável no mesmo site onde mora o Cofre.
-- -----------------------------------------------------------------------------
select id, label, url
from public.social_links
where url !~* '^https://';


-- -----------------------------------------------------------------------------
-- BLOCO 12 — A 0014 fechou o que a internet alcança? (rode DEPOIS de aplicá-la)
--
-- Três perguntas independentes. Todas as colunas devem voltar `true`.
-- -----------------------------------------------------------------------------

-- 12a — Buckets privados (SB-SEC-020).
--
-- Isto é o que o `public = excluded.public` da 0014 passou a garantir. Um
-- bucket marcado como público por dois cliques no painel serve TODO objeto por
-- URL direta, sem sessão e sem RLS: os avatares e o Drive inteiro viram
-- conteúdo aberto. É a única linha desta verificação cujo `false` significa
-- vazamento em andamento, não risco futuro.
select id,
       public          is false as privado_ok,
       file_size_limit          as limite_bytes
from storage.buckets
where id in ('avatars', 'drive')
order by id;

-- 12b — Nenhum privilégio de `anon` em tabela ou view do schema (SB-SEC-025).
--
-- Esperado: ZERO linhas. Cada linha aqui é uma tabela que a chave anônima —
-- que é pública, vai no pacote do navegador — consegue tocar. A RLS ainda
-- barraria as linhas, mas o privilégio não deveria existir.
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon'
  and table_schema = 'public'
order by table_name, privilege_type;

-- 12c — Funções: quem pode executar o quê.
--
-- Leia assim:
--   anon_pode = true          -> FALHA. A função está aberta para a internet.
--   authenticated_pode        -> deve ser `true` SOMENTE em
--                                knowledge_extract_text e convert_capture_to_task.
--
-- ⚠️ `knowledge_extract_text` com `authenticated_pode = false` NÃO é um acerto:
-- é o salvamento de página do Conhecimento quebrado. A trigger
-- knowledge_pages_sync_content_text é `security invoker` e chama essa função no
-- corpo, então o EXECUTE é checado contra `authenticated` a cada gravação.
select p.proname                                             as funcao,
       pg_get_function_identity_arguments(p.oid)             as argumentos,
       has_function_privilege('anon',          p.oid, 'execute') as anon_pode,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_pode,
       has_function_privilege('service_role',  p.oid, 'execute') as service_role_pode
from pg_proc p
where p.pronamespace = 'public'::regnamespace
order by p.proname;


-- -----------------------------------------------------------------------------
-- BLOCO 13 — ClickUp (0016): a tabela do token nasceu fechada?
--
-- ⚠️ O plano deste módulo chamava este bloco de "BLOCO 12". O 12 já existe (é o
-- da 0014) e os números aqui são estáveis por decisão do topo do arquivo, então
-- o do ClickUp é o 13. Se algum documento citar "BLOCO 12 — ClickUp", é este.
--
-- A pergunta que este bloco responde não é "a migration rodou?" — é "a tabela
-- nova nasceu fechada?". Ela importa porque a 0014 fechou `anon` varrendo as
-- tabelas que existiam NAQUELE momento: tabela criada depois não herda nada, e
-- o padrão do Supabase é conceder. Uma 0016 sem os `revoke` desfaria parte da
-- 0014 em silêncio.
--
-- Esperado: as cinco primeiras colunas `true`/com o número indicado, e as três
-- últimas FALSE. Um `true` nas três últimas é o token do ClickUp — a chave da
-- conta inteira no workspace da empresa — alcançável pela sessão do navegador.
-- -----------------------------------------------------------------------------
select
  to_regclass('public.clickup_accounts')    is not null              as tabela_contas_ok,
  to_regclass('public.clickup_credentials') is not null              as tabela_cred_ok,

  (select relrowsecurity from pg_class
    where oid = 'public.clickup_credentials'::regclass)              as rls_cred_ligada,

  -- Deve ser 0. RLS ligada SEM policy é o que faz authenticated ler zero linhas.
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'clickup_credentials') as policies_cred,

  -- Deve ser 4 (select, insert, update, delete).
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'clickup_accounts')    as policies_contas,

  has_table_privilege('anon',          'public.clickup_credentials', 'select') as anon_le_cred,
  has_table_privilege('authenticated', 'public.clickup_credentials', 'select') as auth_le_cred,
  has_table_privilege('anon',          'public.clickup_accounts',    'select') as anon_le_contas;


-- -----------------------------------------------------------------------------
-- BLOCO 7 — Caça a índice redundante (higiene, roda quando quiser)
--
-- Lista pares de índices na mesma tabela cuja definição de colunas coincide.
-- Índice duplicado custa disco e deixa TODA escrita mais lenta, sem acelerar
-- leitura nenhuma. Se aparecer alguma linha aqui, avalie remover uma das duas.
-- -----------------------------------------------------------------------------
select a.indexrelid::regclass as indice_a,
       b.indexrelid::regclass as indice_b,
       a.indrelid::regclass   as tabela
from pg_index a
join pg_index b
  on a.indrelid = b.indrelid
 and a.indexrelid < b.indexrelid
 and a.indkey::text = b.indkey::text
where a.indrelid in (
  select oid from pg_class
  where relnamespace = 'public'::regnamespace and relkind = 'r'
);
