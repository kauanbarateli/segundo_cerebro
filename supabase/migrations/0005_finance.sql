-- =============================================================================
-- 0005 — Controle financeiro (Melhoria #6)
--
-- SEGURANÇA (decisão registrada):
--   Os valores ficam em CLARO no banco, protegidos por RLS — não por descuido,
--   mas porque dashboard, comparações e orçamentos exigem SUM()/GROUP BY, o que
--   é impossível sobre dados cifrados de ponta a ponta.
--   Camadas de proteção aplicadas:
--     1. RLS em todas as tabelas (4 policies, TO authenticated)
--     2. Trigger que impede reatribuir user_id
--     3. Nenhuma tabela financeira é exposta a `anon`
--     4. Trilha de auditoria (finance_audit_events)
--     5. Preferência de ocultar valores na tela (finance_hide_values)
--   O que continua no COFRE (cifrado, zero-knowledge): senha do banco, número
--   do cartão, credenciais. Aqui ficam apenas MOVIMENTAÇÕES.
--
-- DINHEIRO: bigint em CENTAVOS. Nunca float — 0.1+0.2 != 0.3 em IEEE-754.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Contas (banco, cartão, dinheiro, investimento…)
-- -----------------------------------------------------------------------------
create table if not exists public.finance_accounts (
  id                    uuid primary key default extensions.gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  name                  text not null,
  kind                  text not null default 'checking',
  institution           text,
  currency              char(3) not null default 'BRL',
  opening_balance_cents bigint not null default 0,
  color_key             text not null default 'stone',
  archived_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint finance_accounts_name_not_blank check (btrim(name) <> ''),
  constraint finance_accounts_kind_check check (
    kind in ('checking', 'savings', 'credit_card', 'cash', 'investment', 'other')
  )
);
comment on table public.finance_accounts is
  'Contas financeiras do usuário. Saldo = opening_balance + movimentações (ver view finance_account_balances).';

create index if not exists finance_accounts_user_id_idx on public.finance_accounts (user_id);

-- -----------------------------------------------------------------------------
-- Categorias (receita / despesa), com subcategorias opcionais
-- -----------------------------------------------------------------------------
create table if not exists public.finance_categories (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  name            text not null,
  normalized_name text generated always as (lower(btrim(name))) stored,
  kind            text not null,
  parent_id       uuid references public.finance_categories (id) on delete set null,
  color_key       text not null default 'stone',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint finance_categories_name_not_blank check (btrim(name) <> ''),
  constraint finance_categories_kind_check check (kind in ('income', 'expense')),
  constraint finance_categories_unique unique (user_id, kind, normalized_name)
);
comment on table public.finance_categories is
  'Categorias definidas pelo usuário. Novos "tipos" = novas categorias, sem migration.';

create index if not exists finance_categories_user_id_idx on public.finance_categories (user_id);

-- -----------------------------------------------------------------------------
-- Tags livres (etiquetar faturas / lançamentos)
-- -----------------------------------------------------------------------------
create table if not exists public.finance_tags (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  name            text not null,
  normalized_name text generated always as (lower(btrim(name))) stored,
  color_key       text not null default 'stone',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint finance_tags_name_not_blank check (btrim(name) <> ''),
  constraint finance_tags_unique unique (user_id, normalized_name)
);
comment on table public.finance_tags is 'Etiquetas livres para lançamentos/faturas.';

create index if not exists finance_tags_user_id_idx on public.finance_tags (user_id);

-- -----------------------------------------------------------------------------
-- Lançamentos
-- -----------------------------------------------------------------------------
create table if not exists public.finance_transactions (
  id                uuid primary key default extensions.gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  account_id        uuid not null references public.finance_accounts (id) on delete cascade,
  category_id       uuid references public.finance_categories (id) on delete set null,
  kind              text not null,
  -- Sempre POSITIVO. O sinal vem de `kind` — evita somas com sinal trocado.
  amount_cents      bigint not null,
  description       text not null,
  payee             text,
  occurred_on       date not null,
  transfer_group_id uuid,
  notes             text,
  is_paid           boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint finance_tx_description_not_blank check (btrim(description) <> ''),
  constraint finance_tx_amount_positive check (amount_cents > 0),
  constraint finance_tx_kind_check check (kind in ('income', 'expense', 'transfer'))
);
comment on table public.finance_transactions is
  'Lançamentos. Transferência = DUAS linhas (saída + entrada) unidas por transfer_group_id, excluídas dos totais de receita/despesa.';
comment on column public.finance_transactions.amount_cents is
  'Valor em CENTAVOS, sempre positivo. bigint evita erro de ponto flutuante.';

create index if not exists finance_tx_period_idx   on public.finance_transactions (user_id, occurred_on desc);
create index if not exists finance_tx_account_idx  on public.finance_transactions (account_id, occurred_on desc);
create index if not exists finance_tx_category_idx on public.finance_transactions (category_id);
create index if not exists finance_tx_transfer_idx on public.finance_transactions (transfer_group_id)
  where transfer_group_id is not null;

-- Junção lançamento ↔ tag
create table if not exists public.finance_transaction_tags (
  transaction_id uuid not null references public.finance_transactions (id) on delete cascade,
  tag_id         uuid not null references public.finance_tags (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (transaction_id, tag_id)
);
create index if not exists finance_tx_tags_user_idx on public.finance_transaction_tags (user_id);
create index if not exists finance_tx_tags_tag_idx  on public.finance_transaction_tags (tag_id);

-- -----------------------------------------------------------------------------
-- Orçamentos por categoria/mês
-- -----------------------------------------------------------------------------
create table if not exists public.finance_budgets (
  id          uuid primary key default extensions.gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  category_id uuid not null references public.finance_categories (id) on delete cascade,
  month       date not null,
  limit_cents bigint not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint finance_budgets_limit_positive check (limit_cents > 0),
  -- Normaliza para o dia 1: evita duas linhas para o mesmo mês.
  constraint finance_budgets_month_is_first_day check (extract(day from month) = 1),
  constraint finance_budgets_unique unique (user_id, category_id, month)
);
create index if not exists finance_budgets_user_idx on public.finance_budgets (user_id, month desc);

-- -----------------------------------------------------------------------------
-- Auditoria (somente metadados — nunca valores)
-- -----------------------------------------------------------------------------
create table if not exists public.finance_audit_events (
  id          uuid primary key default extensions.gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  entity      text not null,
  entity_id   uuid,
  action      text not null,
  occurred_at timestamptz not null default now(),
  metadata    jsonb
);
comment on table public.finance_audit_events is
  'Trilha de auditoria financeira. Guardar apenas metadados — NUNCA valores ou saldos.';
create index if not exists finance_audit_user_idx on public.finance_audit_events (user_id, occurred_at desc);

-- -----------------------------------------------------------------------------
-- Preferência: ocultar valores na tela (privacidade "ombro")
-- -----------------------------------------------------------------------------
alter table public.user_preferences
  add column if not exists finance_hide_values boolean not null default false;

comment on column public.user_preferences.finance_hide_values is
  'Quando true, a UI mascara os valores (•••) até o usuário revelar. Privacidade visual, não criptografia.';

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  tbls text[] := array[
    'finance_accounts', 'finance_categories', 'finance_tags',
    'finance_transactions', 'finance_budgets'
  ];
begin
  foreach t in array tbls loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$I;', t);
    execute format(
      'create trigger trg_%1$s_updated_at before update on public.%1$I
         for each row execute function public.set_updated_at();', t);

    execute format('drop trigger if exists trg_%1$s_lock_user_id on public.%1$I;', t);
    execute format(
      'create trigger trg_%1$s_lock_user_id before update on public.%1$I
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
  tbls text[] := array[
    'finance_accounts', 'finance_categories', 'finance_tags',
    'finance_transactions', 'finance_transaction_tags',
    'finance_budgets', 'finance_audit_events'
  ];
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
    -- Defesa em profundidade: dados financeiros nunca para o papel anônimo.
    execute format('revoke all on public.%I from anon;', t);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- View de saldos
--
-- ⚠️ security_invoker = on é OBRIGATÓRIO. Sem isso a view roda com os
-- privilégios do DONO e IGNORA a RLS das tabelas de base — vazando dados de
-- outros usuários. É o erro mais comum ao adicionar view em schema com RLS.
-- -----------------------------------------------------------------------------
create or replace view public.finance_account_balances as
select a.id      as account_id,
       a.user_id,
       a.name,
       a.kind,
       a.currency,
       a.opening_balance_cents,
       a.opening_balance_cents + coalesce(sum(
         case
           when t.kind = 'income'  then  t.amount_cents
           when t.kind = 'expense' then -t.amount_cents
           -- Transferência: o sinal depende do lado. Modelamos as duas pernas
           -- como income/expense, então 'transfer' puro não altera saldo.
           else 0
         end
       ), 0) as balance_cents
from public.finance_accounts a
left join public.finance_transactions t
       on t.account_id = a.id
      and t.is_paid = true
group by a.id, a.user_id, a.name, a.kind, a.currency, a.opening_balance_cents;

alter view public.finance_account_balances set (security_invoker = on);

comment on view public.finance_account_balances is
  'Saldo por conta. security_invoker=on faz a view respeitar a RLS das tabelas de base.';

grant select on public.finance_account_balances to authenticated;
revoke all on public.finance_account_balances from anon;

commit;
