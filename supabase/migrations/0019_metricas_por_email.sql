-- =============================================================================
-- 0019 — Registro de envio do e-mail semanal de métricas
--
-- Uma tabela só, e ela existe por UM motivo: idempotência.
--
-- =============================================================================
-- ⚠️ A CONSTRAINT UNIQUE É A FUNÇÃO DESTA TABELA
-- =============================================================================
-- O molde é `notification_deliveries` (0006), e o raciocínio é o mesmo. Um
-- agendador pode disparar a mesma janela duas vezes — retentativa da
-- plataforma, deploy no meio da execução, alguém chamando a rota com o segredo
-- na mão para testar. Sem trava, cada disparo manda o e-mail de novo.
--
-- O despacho faz `insert ... on conflict do nothing returning id` ANTES de
-- chamar a Resend:
--   - voltou linha  → é a primeira vez, pode enviar;
--   - não voltou    → alguém já reservou aquela janela, não envia.
--
-- Reservar ANTES é o que torna isso atômico. Reservar depois do envio deixaria
-- a janela entre "enviei" e "registrei" aberta para um segundo disparo.
--
-- A consequência aceita de propósito: se a Resend falhar DEPOIS da reserva, a
-- semana não é reenviada automaticamente — a linha fica com `error` preenchido
-- e `delivered_at` nulo. Para um resumo semanal isso é o lado certo de errar:
-- um e-mail perdido é um aborrecimento, dois e-mails iguais na caixa de entrada
-- ensinam a ignorar o remetente. `delivered_at is null` é a consulta que mostra
-- o que falhou.
--
-- `period_start` é `date` e não `timestamptz`: a janela é uma SEMANA CIVIL, e
-- semana civil não tem hora. Guardar instante convidaria duas reservas da mesma
-- semana a diferirem por milissegundos e escaparem da UNIQUE.
--
-- `channel` já nasce na chave, como na 0006, para que um canal futuro (push,
-- resumo no aplicativo) não precise de migration nova nem colida com o e-mail.
-- =============================================================================

create table if not exists public.metric_email_deliveries (
  id            uuid primary key default extensions.gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,

  -- Segunda-feira da semana RESUMIDA (a anterior ao envio), no fuso do
  -- aplicativo. Ver `semanaAnterior` em src/lib/metrics.ts.
  period_start  date not null,
  period_end    date not null,

  channel       text not null default 'email'
                constraint metric_email_deliveries_channel_check
                check (channel in ('email')),

  -- Para onde foi. Guardado porque o endereço pode mudar, e um registro que não
  -- diz o destino não responde "por que não recebi?".
  destination   text,

  -- Nulo enquanto não confirmou. `delivered_at is null and error is not null`
  -- é a consulta de "o que falhou".
  delivered_at  timestamptz,
  error         text,

  created_at    timestamptz not null default now(),

  constraint metric_email_deliveries_unique unique (user_id, period_start, channel)
);

comment on table public.metric_email_deliveries is
  'Registro do e-mail semanal de metricas. A UNIQUE (usuario, semana, canal) e a trava atomica anti-duplicacao: o despacho reserva a linha ANTES de chamar o provedor.';
comment on column public.metric_email_deliveries.period_start is
  'Segunda-feira da semana resumida, no fuso do aplicativo. `date` e nao timestamptz: semana civil nao tem hora, e instante deixaria duas reservas da mesma semana diferirem por milissegundos.';
comment on column public.metric_email_deliveries.delivered_at is
  'Nulo enquanto o provedor nao confirmou. Reserva sem entrega e uma semana perdida, e essa e a troca deliberada: um e-mail perdido aborrece, dois iguais ensinam a ignorar o remetente.';

-- -----------------------------------------------------------------------------
-- Índice
--
-- Um só, e para a consulta que existe: "o que falhou?". A UNIQUE já cria o
-- índice de (user_id, period_start, channel), que atende a reserva e o
-- histórico por usuário — acrescentar outro para isso seria redundante, que é
-- exatamente o que a 0008 veio cortar.
-- -----------------------------------------------------------------------------
create index if not exists metric_email_deliveries_falhas_idx
  on public.metric_email_deliveries (user_id, period_start)
  where delivered_at is null;

comment on index public.metric_email_deliveries_falhas_idx is
  'Atende "quais semanas nao foram entregues?". Parcial: o caso comum e entregue, e indexar o comum aqui seria pagar por linha que ninguem consulta.';

-- -----------------------------------------------------------------------------
-- RLS e grants
--
-- QUEM ESCREVE É O CRON, via `service_role` — não há sessão numa execução
-- agendada. Por isso `authenticated` recebe apenas SELECT: dá para a pessoa ver
-- o próprio histórico de envios, e não dá para forjar uma reserva pelo
-- navegador (o que faria o e-mail daquela semana nunca sair).
--
-- ⚠️ O `revoke ... from anon` é explícito pelo mesmo motivo escrito na 0016: a
-- 0014 varreu as tabelas que EXISTIAM, e o Supabase configura
-- `alter default privileges ... grant all on tables to anon, authenticated`.
-- Toda tabela nova no schema `public` NASCE alcançável.
-- -----------------------------------------------------------------------------
alter table public.metric_email_deliveries enable row level security;

drop policy if exists metric_email_deliveries_select on public.metric_email_deliveries;
create policy metric_email_deliveries_select on public.metric_email_deliveries
  for select to authenticated using ((select auth.uid()) = user_id);

grant select on public.metric_email_deliveries to authenticated;
revoke all on table public.metric_email_deliveries from anon;
grant all on table public.metric_email_deliveries to service_role;
