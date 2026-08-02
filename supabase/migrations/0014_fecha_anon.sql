-- =============================================================================
-- 0014 — Fecha o que a internet anônima alcança
--
-- Escopo: SB-SEC-021 (funções executáveis por anon), SB-SEC-025 (grants de anon
-- nas tabelas) e SB-SEC-020 (bucket privado não reafirmado no on-conflict).
--
-- POR QUE ISTO É BLOQUEADOR DE DEPLOY. Enquanto o aplicativo roda só em
-- localhost, `anon` é um papel que ninguém consegue assumir. Publicado, `anon` é
-- QUALQUER PESSOA NA INTERNET com a chave anônima — que é pública por desenho,
-- vai no pacote do navegador. Nada aqui tem a ver com quantos usuários existem;
-- tem a ver com estar exposto.
--
-- =============================================================================
-- A ARMADILHA QUE ESTA MIGRATION QUASE CRIOU — leia antes de mexer
-- =============================================================================
-- No Postgres, função nasce com EXECUTE concedido a PUBLIC. Além disso, o
-- Supabase configura `alter default privileges ... grant all on functions to
-- anon, authenticated, service_role`, então cada função criada em `public`
-- recebe TAMBÉM um grant DIRETO para `anon`. É por isso que os
-- `revoke ... from public` da 0001 não bastaram: eles removem a concessão via
-- PUBLIC e deixam a direta de pé. Todo revoke aqui cita os dois.
--
-- E o inverso: `knowledge_extract_text(jsonb)` NÃO é chamada só pela aplicação.
-- A trigger `trg_knowledge_pages_sync_content_text` chama, no corpo de
-- `knowledge_pages_sync_content_text()`:
--
--     new.content_text := public.knowledge_extract_text(new.content);
--
-- Essa função de trigger é `security invoker`. Quando o corpo de uma função
-- plpgsql chama outra função, o Postgres CHECA EXECUTE em tempo de execução,
-- contra o papel corrente — que ali é `authenticated`. Um
-- `revoke execute from public, anon` sem o `grant` correspondente derrubaria
-- todo salvamento de página do Conhecimento, e derrubaria em silêncio: nada
-- falha ao aplicar a migration, só na hora de gravar.
--
-- Por isso, e só por isso, `knowledge_extract_text` recebe grant explícito.
--
-- =============================================================================
-- O QUE NÃO É REVOGADO, E POR QUÊ
-- =============================================================================
-- 1. `authenticated` nas FUNÇÕES DE TRIGGER. Elas retornam `trigger` e por isso
--    não são chamáveis nem por SQL direto nem pelo PostgREST — o ganho de
--    revogar é nulo. Já o risco não é: se o Postgres checasse EXECUTE também na
--    invocação por trigger (ele não checa — a verificação acontece no CREATE
--    TRIGGER), revogar de `authenticated` derrubaria toda escrita do banco de
--    uma vez. Nulo contra não-nulo resolve sozinho. `anon` sai de todas, que é
--    o que fecha a superfície de internet.
--
-- 2. `usage on schema public from anon` — DELIBERADAMENTE INTOCADO. Revogar
--    quebraria a introspecção do PostgREST e o fluxo de login, que precisa
--    falar com o servidor antes de existir sessão. O grant de schema é a porta;
--    os grants de tabela é que são o cofre, e são esses que saem.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- PARTE A — Funções, uma a uma
--
-- As 15 criadas entre 0001 e 0013. `revoke ... from public, anon` em todas; o
-- grant volta só para quem comprovadamente chama.
-- -----------------------------------------------------------------------------

-- --- 0001 --------------------------------------------------------------------

-- Trigger de `updated_at`, usada por praticamente toda tabela do schema.
revoke all on function public.set_updated_at() from public, anon;

-- Trigger que impede troca de dono numa linha existente.
revoke all on function public.prevent_user_id_change() from public, anon;

-- Trigger em auth.users, e a única SECURITY DEFINER que dispara sozinha.
-- `authenticated` TAMBÉM sai: uma função que roda com os privilégios do dono não
-- pode ficar ao alcance de um papel de sessão. É seguro revogar aqui (e não nas
-- outras triggers) porque este trigger dispara durante o cadastro, executado
-- pelo papel do serviço de autenticação — nunca sob `authenticated`.
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Trigger que sincroniza started_at/completed_at conforme o status da tarefa.
revoke all on function public.sync_task_lifecycle_timestamps() from public, anon;

-- RPC de verdade: é a ÚNICA função deste schema chamada pela aplicação
-- (`supabase.rpc("convert_capture_to_task")` em capturar/actions.ts).
-- SECURITY DEFINER, então precisa estar fechada para anon com ainda mais rigor.
-- A 0001 e a 0009 já revogavam de `public`; o que faltava era o `anon` direto.
revoke all on function public.convert_capture_to_task(uuid) from public, anon;
grant execute on function public.convert_capture_to_task(uuid) to authenticated, service_role;

-- --- 0007 --------------------------------------------------------------------

-- Trigger que impede mover uma pasta para dentro dela mesma.
revoke all on function public.drive_prevent_folder_cycle() from public, anon;

-- --- 0009 --------------------------------------------------------------------

-- Trigger que exige mesmo dono nos dois lados de um vínculo.
revoke all on function public.enforce_link_same_owner() from public, anon;

-- --- 0011 --------------------------------------------------------------------

-- ⚠️ A EXCEÇÃO. Ver a seção "ARMADILHA" no topo antes de tocar nestas duas
-- linhas. Sem o grant a `authenticated`, salvar página do Conhecimento passa a
-- falhar com "permission denied for function knowledge_extract_text".
--
-- `service_role` entra porque ignora RLS mas NÃO ignora grants de função: uma
-- rotina administrativa que reescreva `knowledge_pages` dispararia a mesma
-- trigger e esbarraria na mesma checagem.
revoke all on function public.knowledge_extract_text(jsonb) from public, anon;
grant execute on function public.knowledge_extract_text(jsonb) to authenticated, service_role;

-- Trigger que deriva content_text de content (a que chama a função acima).
revoke all on function public.knowledge_pages_sync_content_text() from public, anon;

-- Trigger que impede ciclo na hierarquia de páginas.
revoke all on function public.knowledge_prevent_page_cycle() from public, anon;

-- Trigger que exige pai e filho no mesmo caderno.
revoke all on function public.knowledge_pages_check_same_notebook() from public, anon;

-- Trigger que propaga a troca de caderno para as páginas descendentes.
revoke all on function public.knowledge_pages_cascade_notebook() from public, anon;

-- --- 0012 --------------------------------------------------------------------

-- Trigger que aplica o teto de links sociais por usuário.
revoke all on function public.enforce_social_links_limit() from public, anon;

-- --- 0013 --------------------------------------------------------------------

-- A 0013 já fechou esta corretamente (public, anon e authenticated). Repetido
-- aqui por ser idempotente e para a lista da PARTE A ficar completa — quem ler
-- este arquivo procurando "todas as funções" precisa encontrar todas.
revoke all on function public.purge_audit_events(integer) from public, anon, authenticated;
grant execute on function public.purge_audit_events(integer) to service_role;


-- -----------------------------------------------------------------------------
-- PARTE B — Tabelas e views: nenhum privilégio para `anon`
--
-- A auditoria recebeu HTTP 200 com zero linhas em `profiles`, `tasks`,
-- `calendar_events`, `vault_items`, `vault_audit_events`, `user_modules` e
-- `notification_deliveries`. A RLS segurou — o 200 vazio é a RLS funcionando —,
-- mas o PRIVILÉGIO não deveria existir. São duas camadas independentes: a RLS
-- decide quais linhas, o grant decide se a tabela pode ser tocada. Com o grant
-- ausente, uma policy escrita errada no futuro ainda esbarra no privilégio.
--
-- `on all tables` cobre tabelas, views e materialized views de uma vez. As 32
-- tabelas e 2 views atingidas, para conferência:
--   0001: profiles, user_preferences, categories, tags, tasks, task_tags,
--         captures, calendar_accounts, calendar_sources, calendar_events,
--         google_oauth_credentials, vault_master_keys, vault_items,
--         vault_audit_events
--   0004: user_modules
--   0005: finance_accounts, finance_categories, finance_tags,
--         finance_transactions, finance_transaction_tags, finance_budgets,
--         finance_audit_events, view finance_account_balances
--   0006: notification_deliveries, push_subscriptions
--   0007: drive_folders, drive_files, view drive_usage
--   0009: task_capture_links, task_event_links, capture_event_links
--   0011: knowledge_notebooks, knowledge_pages
--   0012: social_links
--
-- Nada é revogado de `authenticated`: é o papel da sessão da aplicação, e as
-- policies da 0001 já restringem cada linha ao dono.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- O mesmo, para o que ainda não existe.
--
-- `alter default privileges` vale para os objetos criados PELO PAPEL QUE RODA
-- este comando. As migrations são aplicadas pelo SQL Editor do Supabase, que
-- roda como `postgres` — o mesmo papel cujos default privileges o Supabase
-- configurou concedendo a `anon`. Por isso as três linhas casam com a concessão
-- que se quer anular.
--
-- Consequência para migrations futuras: tabela nova NÃO nasce alcançável por
-- `anon` (nasce alcançável por `authenticated`, que continua intocado), e RPC
-- nova precisa de `grant execute ... to authenticated` explícito. É o padrão
-- correto — mas é uma mudança de comportamento e está escrita aqui para não ser
-- descoberta por acidente daqui a seis meses.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;


-- -----------------------------------------------------------------------------
-- PARTE C — Buckets: reafirmar que são privados
--
-- O `on conflict do update` da 0002 e da 0007 atualiza tamanho e MIME, mas NÃO
-- reafirma `public`. Consequência: se um bucket for marcado como público pelo
-- painel — dois cliques, sem confirmação —, reaplicar a migration original não
-- desfaz. A migration parece a fonte da verdade e não é.
--
-- Reexecutar os dois upserts com `public = excluded.public` fecha isso. Os
-- demais campos repetem os valores originais de propósito: o upsert precisa ser
-- a declaração completa do estado desejado, senão reaplicar esta migration
-- passaria a ser o que muda os limites sem querer.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152,
        array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit)
values ('drive', 'drive', false, 52428800)
on conflict (id) do update
  set public          = excluded.public,
      file_size_limit = excluded.file_size_limit;


-- -----------------------------------------------------------------------------
-- Registro
-- -----------------------------------------------------------------------------
comment on function public.knowledge_extract_text(jsonb) is
  'Extrai texto puro de um documento ProseMirror. EXECUTE concedido a authenticated e service_role NAO por escolha de API, mas porque a trigger knowledge_pages_sync_content_text (security invoker) a chama no corpo: revogar de authenticated quebra o salvamento de pagina. Fechada para public e anon na 0014.';

comment on function public.convert_capture_to_task(uuid) is
  'Converte uma captura em tarefa, de forma idempotente. Unica RPC deste schema chamada pela aplicacao. SECURITY DEFINER; fechada para public e anon na 0014.';
