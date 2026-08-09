-- =============================================================================
-- 0022 — CARTÃO: A DÍVIDA EXISTE DESDE A COMPRA
--
-- Repara `is_paid = false` em lançamentos de cartão de crédito e instala o
-- gatilho que impede o estado de voltar.
--
-- =============================================================================
-- O DEFEITO, E POR QUE ELE PASSOU DESPERCEBIDO
-- =============================================================================
-- O limite do cartão não era consumido. A cadeia inteira está no código, e cada
-- elo estava CERTO isoladamente:
--
--   1. O formulário oferecia a caixa "Já pago / recebido", marcada por padrão.
--   2. A action gravava `is_paid` com o que o usuário marcou.
--   3. A view `finance_account_balances` junta as transações com
--      `and t.is_paid = true` (0005:267, preservado na 0010:431).
--   4. Logo, `is_paid = false` -> a linha NÃO entra em `balance_cents`
--      -> `debt_cents` continua zero -> `available_cents` não se move.
--
-- Desmarcar aquela caixa numa compra de cartão é o gesto NATURAL — "a fatura
-- nem fechou, eu não paguei isso ainda". E é exatamente o que apagava a dívida.
--
-- O erro não estava na conta: estava na PERGUNTA. "Já pagou?" não se aplica a
-- uma compra no cartão, onde as duas perguntas são separadas:
--
--     a dívida existe?     -> SEMPRE, desde o instante da compra
--     a FATURA foi paga?   -> `statement_month` + o lançamento de pagamento
--
-- O caminho PARCELADO já sabia disso e forçava `is_paid: true` desde a 0010
-- (`createInstallmentPurchase`), com a explicação certa na tela. Esta migration
-- estende ao resto do cartão o que já valia para o parcelamento.
--
-- =============================================================================
-- ⚠️ RODE ISTO **ANTES** DE APLICAR — a dívida vai saltar
-- =============================================================================
-- O reparo é correto, mas o número na tela MUDA: dívida que estava invisível
-- passa a aparecer e o limite disponível cai. Não é um susto a ser descoberto
-- depois. Conte primeiro:
--
--   select a.name,
--          count(*)                             as linhas_a_reparar,
--          sum(case when t.kind = 'expense' then t.amount_cents
--                   else -t.amount_cents end)   as impacto_em_centavos
--     from public.finance_transactions t
--     join public.finance_accounts a on a.id = t.account_id
--    where a.kind = 'credit_card'
--      and t.is_paid = false
--      and t.transfer_group_id is null
--    group by a.name
--    order by 2 desc;
--
-- `impacto_em_centavos` é quanto `debt_cents` vai subir em cada cartão (e quanto
-- `available_cents` vai cair). Se a soma não bater com o que você espera, PARE e
-- confira antes de aplicar — reverter um reparo de dados exige saber quais
-- linhas foram tocadas, e depois do update essa informação não existe mais.
--
-- =============================================================================
-- O QUE O REPARO **NÃO** TOCA
-- =============================================================================
-- `transfer_group_id is not null` fica de fora, e a exclusão é a parte delicada
-- desta migration.
--
-- A perna de ENTRADA num cartão com `transfer_group_id` é o PAGAMENTO DA FATURA
-- (`ehPagamentoDeFatura()` em src/lib/credit.ts). Marcá-la como paga ABATERIA a
-- dívida — ou seja, o reparo empurraria o número para o lado errado, que é
-- justamente o oposto do que ele existe para corrigir. Na dúvida, o reparo erra
-- para o lado de MOSTRAR dívida, nunca de escondê-la.
--
-- Estorno (income SEM transferência) entra no reparo junto com as compras: ele é
-- dinheiro devolvido pela loja e abate a fatura de verdade, e a mesma regra
-- vale — o crédito existe desde que a loja o concedeu, não quando a fatura fecha.
--
-- =============================================================================
-- ⚠️ CONTA QUE **NÃO** É `credit_card` NÃO É TOCADA
-- =============================================================================
-- Fora de cartão, "agendado mas ainda não debitado" é um estado REAL e útil, e a
-- caixa "Já pago / recebido" continua na tela. `available_cents` já é NULL fora
-- de cartão por desenho (0010): não existe limite a consumir.
--
-- Se um cartão de verdade estiver cadastrado como 'checking' ou 'other', ESTE
-- REPARO NÃO O ALCANÇA — e nem deveria. O caminho é editar a conta e trocar o
-- tipo para "Cartão de crédito": `upsertAccount` -> `sincronizarFaturas` já
-- recalcula `statement_month` de TODOS os lançamentos nesse caso ("VIROU cartão:
-- recalcula TUDO") e normaliza o `is_paid` junto. Depois disso o gatilho abaixo
-- mantém o estado.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Reparo do histórico
--
-- Contamos ANTES de escrever e emitimos o número: aplicar uma migration de dados
-- sem saber quantas linhas ela mexeu é o tipo de silêncio que só aparece semanas
-- depois, quando alguém estranha um total.
-- -----------------------------------------------------------------------------
do $$
declare
  v_linhas   bigint;
  v_impacto  bigint;
begin
  select count(*),
         coalesce(sum(case when t.kind = 'expense' then t.amount_cents
                           else -t.amount_cents end), 0)
    into v_linhas, v_impacto
    from public.finance_transactions t
    join public.finance_accounts a on a.id = t.account_id
   where a.kind = 'credit_card'
     and t.is_paid = false
     and t.transfer_group_id is null;

  if v_linhas = 0 then
    -- Caminho normal de uma segunda aplicação, e também o de um banco novo. A
    -- migration precisa poder rodar num banco vazio (CI, clone) sem barulho.
    raise notice '0022: nenhuma linha de cartao com is_paid = false. Nada a reparar.';
  else
    update public.finance_transactions t
       set is_paid = true
      from public.finance_accounts a
     where a.id = t.account_id
       and a.kind = 'credit_card'
       and t.is_paid = false
       and t.transfer_group_id is null;

    raise notice
      '0022: % linha(s) de cartao marcadas como pagas. debt_cents sobe % centavos no total (available_cents cai o mesmo).',
      v_linhas, v_impacto;
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 2. O gatilho que impede a volta
--
-- ⚠️ POR QUE UM GATILHO QUE **NORMALIZA**, E NÃO UM CHECK QUE **RECUSA**
--
-- Um CHECK não serve tecnicamente: a condição depende de `finance_accounts.kind`,
-- que está em OUTRA tabela, e CHECK não faz subconsulta.
--
-- Sobra escolher entre um gatilho que recusa e um que corrige. Recusar seria
-- mais alto e, à primeira vista, mais honesto — mas cria um beco sem saída no
-- caso mais importante desta correção: converter uma conta comum em cartão. As
-- linhas antigas com `is_paid = false` passariam a violar a regra SEM que
-- ninguém tenha escrito nada nelas, e a partir daí qualquer edição de uma delas
-- falharia com um erro cru de constraint. O usuário ficaria preso entre uma
-- conta que já é cartão e lançamentos que ele não consegue mais salvar.
--
-- Corrigir na escrita não esconde nada que a interface não diga: o formulário já
-- não oferece a caixa em cartão, e a action já força o valor (`pagoNoCartao`).
-- Este gatilho é a ÚLTIMA camada — ele existe para o caminho que não passa por
-- nenhuma das duas: o SQL editor do Supabase, um script, uma action futura
-- escrita por quem não leu isto.
--
-- `before insert or update` porque precisa mudar `new` antes da gravação.
-- `security definer` + `set search_path = ''` seguem a regra da casa (0021):
-- sem o search_path vazio, um schema no caminho poderia sequestrar a resolução
-- de `finance_accounts` dentro de uma função com privilégio elevado.
-- -----------------------------------------------------------------------------
create or replace function public.forcar_divida_de_cartao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Só faz trabalho quando há o que corrigir. `is_paid` já é `true` por default,
  -- então o caminho comum sai por aqui sem tocar em `finance_accounts`.
  if new.is_paid then
    return new;
  end if;

  -- Perna de transferência não entra: a que ENTRA no cartão é pagamento de
  -- fatura, e marcá-la como paga abateria a dívida — o lado errado do erro.
  if new.transfer_group_id is not null then
    return new;
  end if;

  if exists (
    select 1
      from public.finance_accounts a
     where a.id = new.account_id
       and a.kind = 'credit_card'
  ) then
    new.is_paid := true;
  end if;

  return new;
end;
$$;

comment on function public.forcar_divida_de_cartao() is
  'Compra no cartao e divida desde o instante da compra: is_paid nunca fica false em conta credit_card. A view finance_account_balances junta com is_paid = true, entao false apagaria a linha de debt_cents e available_cents. Pernas de transferencia ficam de fora (a que entra no cartao e pagamento de fatura).';

drop trigger if exists trg_finance_tx_divida_de_cartao on public.finance_transactions;
create trigger trg_finance_tx_divida_de_cartao
  before insert or update on public.finance_transactions
  for each row execute function public.forcar_divida_de_cartao();

commit;

-- =============================================================================
-- VERIFICAÇÃO (rodar depois de aplicar)
--
-- 1) Não sobrou nenhuma linha de cartão não paga fora de transferência:
--      select count(*)
--        from public.finance_transactions t
--        join public.finance_accounts a on a.id = t.account_id
--       where a.kind = 'credit_card'
--         and t.is_paid = false
--         and t.transfer_group_id is null;
--    Espera-se 0.
--
-- 2) O gatilho está ativo:
--      select tgname, tgenabled
--        from pg_trigger
--       where tgrelid = 'public.finance_transactions'::regclass
--         and tgname = 'trg_finance_tx_divida_de_cartao';
--    Espera-se uma linha com tgenabled = 'O'.
--
-- 3) Limite e dívida por cartão, para conferir contra o app e contra a fatura
--    real do banco:
--      select b.name, b.debt_cents, b.available_cents
--        from public.finance_account_balances b
--       where b.is_credit;
--
-- 4) ⚠️ SE ALGUM CARTÃO SEU ESTIVER CADASTRADO COM O TIPO ERRADO, ele não
--    aparece em (3). Confira a lista inteira:
--      select name, kind, credit_limit_cents, statement_closing_day, payment_due_day
--        from public.finance_accounts
--       where archived_at is null
--       order by kind, name;
--    Conta com cara de cartão e `kind` diferente de 'credit_card' se conserta
--    pela tela: Financeiro -> Contas -> Editar -> Tipo. Ver docs/cartao-e-fatura.md.
-- =============================================================================
