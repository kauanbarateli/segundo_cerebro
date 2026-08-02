-- =============================================================================
-- 0008 — Índices de desempenho (correção C1: lentidão entre abas)
--
-- Esta migration cria DOIS índices. A primeira versão dela criava cinco; três
-- foram removidos após conferir o que 0001 e 0005 já haviam criado.
--
-- Índice redundante não é neutro: ele custa disco, é mantido em toda escrita
-- (INSERT/UPDATE/DELETE pagam por ele) e ainda polui as estatísticas do
-- planejador. "Criar índice por precaução" torna o banco mais lento, não mais
-- rápido.
--
-- Descartados, e por quê:
--
--   tasks (user_id, due_at)
--     -> 0001 já cria `tasks_due_at_idx` exatamente nessas colunas. Uma versão
--        parcial seria um pouco menor, mas não justifica um segundo índice
--        sobre as mesmas chaves.
--
--   calendar_events (user_id, start_at)
--     -> 0001 já cria `calendar_events_range_idx (user_id, start_at, end_at)`,
--        cujo prefixo atende a ordenação e o range de `getUpcomingEvents`.
--
--   finance_transactions (user_id, occurred_on desc)
--     -> 0005 já cria `finance_tx_period_idx` com chaves e ordem IDÊNTICAS.
--        Era duplicata exata.
--
-- Idempotente: `if not exists` em tudo.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- tasks — a perna que faltava da consulta "tarefas de hoje"
--
-- O shell filtra por DUAS colunas de data ligadas por OR:
--
--   or(and(due_at.gte.X, due_at.lte.Y),
--      and(scheduled_start_at.gte.X, scheduled_start_at.lte.Y))
--
-- Um OR entre colunas distintas precisa de um índice POR COLUNA para o
-- planejador montar um BitmapOr. A perna `due_at` já está coberta por
-- `tasks_due_at_idx` (0001); `scheduled_start_at` não tinha índice nenhum —
-- essa metade da consulta caía em varredura sequencial.
--
-- Parcial de propósito: indexa só o que a aplicação consulta. Fica menor, cabe
-- em cache, e linhas fora do predicado não pagam manutenção de índice.
-- O cast explícito para o enum mantém o predicado imutável, requisito do
-- Postgres para índice parcial.
-- -----------------------------------------------------------------------------
create index if not exists tasks_user_scheduled_idx
  on public.tasks (user_id, scheduled_start_at)
  where status <> 'archived'::public.task_status and scheduled_start_at is not null;

comment on index public.tasks_user_scheduled_idx is
  'Perna "scheduled_start_at" da consulta de tarefas de hoje. A perna "due_at" usa tasks_due_at_idx (0001). Ver 0008.';

-- -----------------------------------------------------------------------------
-- captures — caixa de entrada
--
-- 0001 tem `captures_status_idx (user_id, status)`, que filtra mas NÃO ordena:
-- a consulta pede `order by captured_at desc`, então sobrava um sort.
-- Este índice entrega o filtro e a ordem de uma vez.
-- -----------------------------------------------------------------------------
create index if not exists captures_inbox_idx
  on public.captures (user_id, captured_at desc)
  where status in ('draft', 'inbox');

comment on index public.captures_inbox_idx is
  'Caixa de entrada do Capturar: filtra por status e já entrega a ordem por captured_at. Ver 0008.';

commit;

-- =============================================================================
-- Verificação: use os BLOCOS 1 e 6 de supabase/verificacao.sql.
--
-- Para conferir se o planejador está de fato usando o índice novo (troque
-- <UUID> pelo seu id em auth.users):
--
--   explain analyze
--   select status, due_at, scheduled_start_at from public.tasks
--   where user_id = '<UUID>'
--     and status <> 'archived'
--     and (   (due_at             >= now() - interval '12 hours' and due_at             <= now() + interval '12 hours')
--          or (scheduled_start_at >= now() - interval '12 hours' and scheduled_start_at <= now() + interval '12 hours'));
--
-- Espera-se "Bitmap Heap Scan" com "BitmapOr", e não "Seq Scan on tasks".
--
-- Observação: em tabela pequena o Postgres escolhe Seq Scan DE PROPÓSITO —
-- varrer 50 linhas é mais barato que abrir um índice. Isso é o planejador
-- acertando, não o índice falhando. O ganho aparece conforme os dados crescem.
-- =============================================================================
