-- =============================================================================
-- 0023 — PAGAMENTO PARCIAL DE UM LANÇAMENTO
--
-- Acrescenta `paid_cents` e passa a DERIVAR `is_paid` dele.
--
-- =============================================================================
-- O OBSTÁCULO ERA O ESQUEMA, NÃO A TELA
-- =============================================================================
-- `is_paid` é booleano. Não havia como representar "paguei R$ 300 de R$ 800".
--
-- A FATURA escapa disso porque não é uma linha: é um CONJUNTO de lançamentos
-- com o mesmo `statement_month`, e `faturaDoCartao()` deriva
-- `openCents = totalCents - paidCents` somando os pagamentos. Um lançamento
-- avulso não tem conjunto onde somar.
--
-- Três caminhos foram considerados, e a escolha está registrada porque as outras
-- duas voltam a parecer boas ideias de longe:
--
--   (a) COLUNA `paid_cents`            <- escolhida
--   (b) dividir a linha em duas        <- RECUSADA: reescreve o histórico, quebra
--                                         `installment_no`, e o extrato deixa de
--                                         bater com o banco
--   (c) tabela de pagamentos           <- mais elegante, e desnecessária hoje.
--                                         Migrar de (a) para (c) é ADITIVO, então
--                                         não há nada a perder começando simples
--
-- =============================================================================
-- ⚠️ ESTA MIGRATION SUBSTITUI A FUNÇÃO DO GATILHO DA 0022
-- =============================================================================
-- E isso pede justificativa, porque aquele gatilho existe por causa de um
-- defeito que já custou caro (o limite do cartão que não era consumido).
--
-- A GARANTIA DA 0022 CONTINUA INTEIRA: linha de cartão sai daqui sempre com
-- `is_paid = true`. O que a nova versão acrescenta é que ela sai também com
-- `paid_cents = amount_cents` — sem isso, a coerência entre as duas colunas se
-- quebraria justamente no cartão.
--
-- POR QUE UMA FUNÇÃO E NÃO DUAS. Um segundo gatilho teria que rodar DEPOIS do
-- primeiro, e o Postgres dispara gatilhos `before` de mesma tabela em ordem
-- ALFABÉTICA DE NOME. A ordem ficaria codificada na escolha do nome do arquivo —
-- invisível, e quebrável por um rename inocente.
--
-- =============================================================================
-- `is_paid` PASSA A SER DERIVADO
-- =============================================================================
-- Fora de cartão e fora de transferência, `is_paid := (paid_cents >= amount_cents)`.
--
-- É o que impede as duas colunas de discordarem — e elas discordariam: o
-- formulário manda `is_paid`, a ação de pagar manda `paid_cents`, e bastaria um
-- caminho esquecer o outro para existir linha "paga" com zero pago, ou linha
-- "não paga" com o valor inteiro quitado. Aí o saldo da conta e a lista de
-- pendências passariam a contar histórias diferentes sobre a mesma despesa.
--
-- ⚠️ CONSEQUÊNCIA PARA QUEM ESCREVE: mandar `is_paid = true` sem `paid_cents`
-- NÃO marca mais nada como pago. `upsertTransaction` foi ajustada para mandar os
-- dois; qualquer caminho novo precisa fazer o mesmo.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. A coluna
-- -----------------------------------------------------------------------------
alter table public.finance_transactions
  add column if not exists paid_cents bigint not null default 0;

comment on column public.finance_transactions.paid_cents is
  'Quanto deste lancamento JA foi pago, em centavos. 0 = nada, amount_cents = quitado. is_paid e DERIVADO desta coluna pelo gatilho trg_finance_tx_pagamento (fora de cartao e de transferencia). A view finance_account_balances soma paid_cents, nao amount_cents: e assim que um pagamento parcial move o saldo da conta.';

-- -----------------------------------------------------------------------------
-- 2. Backfill — ANTES da constraint, senão ela recusa as linhas existentes
--
-- Idempotente: uma segunda aplicação não encontra nada a fazer.
-- -----------------------------------------------------------------------------
do $$
declare
  v_linhas bigint;
begin
  update public.finance_transactions
     set paid_cents = amount_cents
   where is_paid
     and paid_cents <> amount_cents;
  get diagnostics v_linhas = row_count;
  raise notice '0023: % linha(s) ja pagas receberam paid_cents = amount_cents.', v_linhas;
end
$$;

-- -----------------------------------------------------------------------------
-- 3. O teto
--
-- `paid_cents > amount_cents` seria pagar mais do que se deve NUMA LINHA, o que
-- não é crédito a favor (isso existe na fatura, no agregado) — é erro de
-- digitação. Barrar aqui evita que a aplicação precise confiar no cliente.
-- -----------------------------------------------------------------------------
alter table public.finance_transactions
  drop constraint if exists finance_tx_paid_cents_range;

alter table public.finance_transactions
  add constraint finance_tx_paid_cents_range
  check (paid_cents >= 0 and paid_cents <= amount_cents);

-- -----------------------------------------------------------------------------
-- 4. O gatilho — sucessor de `forcar_divida_de_cartao` (0022)
--
-- `security definer` + `set search_path = ''` seguem a regra da casa: sem o
-- search_path vazio, um schema no caminho poderia sequestrar a resolução de
-- `finance_accounts` dentro de uma função com privilégio elevado.
-- -----------------------------------------------------------------------------
create or replace function public.normalizar_pagamento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  /*
    CASO 1 — PERNA DE TRANSFERÊNCIA. Dinheiro que JÁ se moveu, por definição: as
    duas pernas são criadas no instante em que a transferência acontece. Não
    existe transferência "pela metade", então pagamento parcial não se aplica.

    Vem ANTES do cartão de propósito: a perna que ENTRA num cartão é o pagamento
    da fatura, e ela precisa deste tratamento, não do de compra.
  */
  if new.transfer_group_id is not null then
    new.is_paid := true;
    new.paid_cents := new.amount_cents;
    return new;
  end if;

  /*
    CASO 2 — CARTÃO DE CRÉDITO. A GARANTIA DA 0022, preservada inteira.

    Compra no cartão é dívida desde o instante da compra: a view
    `finance_account_balances` ignora o que não está pago, então `is_paid = false`
    apagaria a linha de `debt_cents` e de `available_cents` — o limite do cartão
    deixaria de ser consumido. Foi o defeito que a 0022 corrigiu.

    Pagamento parcial NÃO se aplica a cartão: quem se paga pela metade é a
    FATURA, e isso já existe (`payStatement`, com juros de rotativo).
  */
  if exists (
    select 1
      from public.finance_accounts a
     where a.id = new.account_id
       and a.kind = 'credit_card'
  ) then
    new.is_paid := true;
    new.paid_cents := new.amount_cents;
    return new;
  end if;

  /*
    CASO 3 — O RESTO. `is_paid` é DERIVADO, nunca aceito como veio.

    É o que garante que as duas colunas não discordem. `>=` e não `=` por
    defesa: o teto do CHECK já impede passar, e um `=` transformaria qualquer
    violação futura em "não pago" silencioso.
  */
  new.is_paid := (new.paid_cents >= new.amount_cents);
  return new;
end;
$$;

comment on function public.normalizar_pagamento() is
  'Mantem is_paid e paid_cents coerentes. Sucede forcar_divida_de_cartao (0022) e PRESERVA a garantia dela: linha de cartao sempre is_paid = true. Perna de transferencia e sempre realizada. Fora disso, is_paid e derivado de paid_cents >= amount_cents.';

-- O gatilho antigo sai e o novo entra NA MESMA TRANSAÇÃO: um instante com a
-- tabela desprotegida é um instante em que uma escrita concorrente pode gravar
-- `is_paid = false` num cartão.
drop trigger if exists trg_finance_tx_divida_de_cartao on public.finance_transactions;
drop trigger if exists trg_finance_tx_pagamento on public.finance_transactions;
create trigger trg_finance_tx_pagamento
  before insert or update on public.finance_transactions
  for each row execute function public.normalizar_pagamento();

-- A função da 0022 fica sem gatilho. Não a apagamos: um `drop function` aqui
-- falharia se algum objeto ainda a referenciasse, e mantê-la é o registro de
-- onde a regra do cartão nasceu.
comment on function public.forcar_divida_de_cartao() is
  'SUPERSEDIDA pela 0023. A regra do cartao vive agora em public.normalizar_pagamento(), que a preserva inteira e ainda mantem paid_cents coerente. Esta funcao nao tem mais gatilho.';

-- -----------------------------------------------------------------------------
-- 5. A view passa a somar o que foi PAGO
--
-- ⚠️ O SIGNIFICADO DELA NÃO MUDA: ela continua respondendo "quanto já se moveu".
-- O que muda é a PRECISÃO — antes ela só sabia responder em tudo-ou-nada.
--
-- E a mudança é um NO-OP para todo dado que existe hoje. O gatilho acima garante
-- `is_paid <=> paid_cents >= amount_cents`, e o backfill do passo 2 já ajustou o
-- histórico. Logo:
--   linha paga     -> antes somava amount_cents; agora soma paid_cents, que é igual
--   linha nao paga -> antes era filtrada fora;   agora soma paid_cents = 0
-- Nenhum saldo existente se mexe. Só o estado NOVO (parcial) passa a aparecer.
--
-- Sem esta mudança, pagar R$ 300 de uma despesa de R$ 800 tiraria R$ 300 da
-- conta no mundo real e ZERO no aplicativo — e o saldo deixaria de bater com o
-- extrato do banco, que é exatamente o número contra o qual tudo é conferido.
--
-- `create or replace` (e não drop+create) preserva colunas, ordem, tipos e
-- grants. A expressão de `balance_cents` mantém o tipo NUMERIC de 0005/0010:
-- `sum(bigint)` devolve numeric, e castar aqui abortaria o replace com
-- "cannot change data type of view column".
-- -----------------------------------------------------------------------------
create or replace view public.finance_account_balances as
with movimento as (
  select a.id      as account_id,
         a.user_id,
         a.name,
         a.kind,
         a.currency,
         a.opening_balance_cents,
         a.credit_limit_cents,
         a.opening_balance_cents + coalesce(sum(
           case
             when t.kind = 'income'  then  t.paid_cents
             when t.kind = 'expense' then -t.paid_cents
             else 0
           end
         ), 0) as balance_cents
  from public.finance_accounts a
  left join public.finance_transactions t
         on t.account_id = a.id
  group by a.id, a.user_id, a.name, a.kind, a.currency,
           a.opening_balance_cents, a.credit_limit_cents
),
credito as (
  select m.*,
         (m.kind = 'credit_card') as is_credit,
         case
           when m.kind = 'credit_card' then (-m.balance_cents)::bigint
           else 0::bigint
         end as debt_cents
  from movimento m
)
select account_id,
       user_id,
       name,
       kind,
       currency,
       opening_balance_cents,
       balance_cents,
       is_credit,
       debt_cents,
       case
         when is_credit then (credit_limit_cents - debt_cents)::bigint
         else null::bigint
       end as available_cents
from credito;

-- OBRIGATORIO, e a regra da casa: a opcao NAO e herdada em toda versao da view.
-- Sem security_invoker ela roda com os privilegios do DONO e IGNORA a RLS das
-- tabelas de base, vazando dados entre usuarios.
alter view public.finance_account_balances set (security_invoker = on);

comment on view public.finance_account_balances is
  'Saldo por conta, somando o que JA FOI PAGO (paid_cents). balance_cents mantem o significado de 0005/0010 — dinheiro realizado, NEGATIVO em cartao porque compra e expense. Para cartao o numero relevante e debt_cents. security_invoker=on faz a view respeitar a RLS das tabelas de base.';

grant select on public.finance_account_balances to authenticated;
revoke all on public.finance_account_balances from anon;

commit;

-- =============================================================================
-- VERIFICACAO (rodar depois de aplicar)
--
-- 1) Nenhuma linha com as duas colunas em desacordo:
--      select count(*) from public.finance_transactions
--       where is_paid <> (paid_cents >= amount_cents);
--    Espera-se 0.
--
-- 2) O gatilho novo esta ativo, e o antigo saiu:
--      select tgname, tgenabled from pg_trigger
--       where tgrelid = 'public.finance_transactions'::regclass and not tgisinternal;
--    Espera-se trg_finance_tx_pagamento com tgenabled = 'O', e NENHUM
--    trg_finance_tx_divida_de_cartao.
--
-- 3) ⚠️ A GARANTIA DA 0022 SOBREVIVEU. Tente gravar uma compra nao paga num
--    cartao e confira que ela volta paga:
--      insert into public.finance_transactions
--        (user_id, account_id, kind, amount_cents, description, occurred_on, is_paid)
--      select user_id, id, 'expense', 1, 'teste 0023', current_date, false
--        from public.finance_accounts where kind = 'credit_card' limit 1
--      returning is_paid, paid_cents, amount_cents;
--    Espera-se is_paid = true e paid_cents = amount_cents = 1. APAGUE a linha
--    depois: delete from public.finance_transactions where description = 'teste 0023';
--
-- 4) A view nao mexeu em nenhum saldo existente:
--      select name, balance_cents from public.finance_account_balances order by name;
--    Compare com o que a tela mostrava antes de aplicar. Deve ser IDENTICO.
--
-- PENDENCIA DE APLICACAO (nao e SQL):
--   - Regerar src/lib/database.types.ts: FinanceTransaction ganha paid_cents.
-- =============================================================================
