-- =============================================================================
-- 0024 — RECORRÊNCIA E PARCELAMENTO: UMA COLUNA QUE OS SEPARA
--
-- =============================================================================
-- ⚠️ ESTA COLUNA DECIDE SE UMA LINHA É DÍVIDA. É a única coisa que separa
-- "12× aluguel" de "12× sofá", e as duas são idênticas na estrutura.
-- =============================================================================
-- Recorrência e parcelamento se PARECEM na tela — as duas repetem, as duas têm
-- N ocorrências, as duas mostram "3/12" — e são OPOSTAS no balanço:
--
--                       RECORRÊNCIA              PARCELAMENTO
--   Valor               o mesmo em toda vez      total DIVIDIDO em N
--   É dívida hoje?      NÃO                      SIM, por inteiro
--   Cancelou no meio?   as futuras somem         a dívida continua
--
-- "12× aluguel de R$ 2.000" NÃO é uma dívida de R$ 24.000: saindo do imóvel no
-- terceiro mês, os outros nove simplesmente não acontecem. "12× de R$ 2.000 no
-- sofá" é dívida de R$ 24.000 desde o dia da compra, e mudar de casa não muda
-- isso.
--
-- A linha que separa não é a duração — é SE A CONTRAPARTIDA JÁ FOI ENTREGUE.
--
-- =============================================================================
-- POR QUE UMA COLUNA, E NÃO UMA TABELA `finance_recurrences`
-- =============================================================================
-- Porque a recorrência aqui é sempre FINITA: o usuário informa quantas vezes.
-- Sem "repete para sempre" não há horizonte rolante, não há o que materializar
-- ao navegar para o futuro, e não há coluna "materializado até". As duas formas
-- viram a mesma operação — criar N linhas de uma vez — e `finance_transactions`
-- já tem tudo que agrupa e numera uma série:
--
--   installment_group_id   agrupa as N linhas
--   installment_no         3
--   installment_total      12
--
-- ⚠️ DÍVIDA DE NOME, CONSCIENTE E REGISTRADA: `installment_group_id` passa a
-- agrupar TAMBÉM recorrência, e o nome diz "parcela". Renomear tocaria
-- database.types.ts, actions, mapper e UI por cosmética. A escolha é manter e
-- DOCUMENTAR — senão, daqui a um ano alguém lê "installment" e conclui que
-- recorrência é parcelamento, que é exatamente o erro que esta coluna existe
-- para evitar.
--
-- =============================================================================
-- ⚠️ `null` NÃO É "TANTO FAZ"
-- =============================================================================
-- `null` significa LANÇAMENTO AVULSO — sem série. Quem soma dívida trata
-- `serie_tipo is null` pelo estado da linha (vencida e não paga = dívida), nunca
-- como "provavelmente parcelamento". Tratar null como parcelamento faria toda
-- despesa futura solta virar passivo; tratá-lo como recorrência tiraria da
-- dívida uma compra parcelada gravada antes desta migration.
--
-- Como não existia série fora do cartão antes daqui, e no cartão a dívida vem do
-- SALDO (não desta coluna), nenhum backfill é necessário.
-- =============================================================================

begin;

alter table public.finance_transactions
  add column if not exists serie_tipo text;

alter table public.finance_transactions
  drop constraint if exists finance_tx_serie_tipo_check;

alter table public.finance_transactions
  add constraint finance_tx_serie_tipo_check
  check (serie_tipo is null or serie_tipo in ('recorrencia', 'parcelamento'));

comment on column public.finance_transactions.serie_tipo is
  'O QUE DECIDE SE A LINHA E DIVIDA. recorrencia = repete o MESMO valor N vezes; NAO e divida (compromisso futuro, cancelavel — voce nao deve doze alugueis, deve o deste mes). parcelamento = total dividido em N; E divida inteira desde a compra, porque a contrapartida ja foi entregue. null = lancamento avulso, sem serie. Ver src/lib/finance.ts (horizontesDoDinheiro) e docs/recorrencia-e-divida.md.';

comment on column public.finance_transactions.installment_group_id is
  'Agrupa as N linhas de uma serie. ATENCAO AO NOME: apesar de "installment", ele agrupa TAMBEM recorrencia desde a 0024 — quem distingue os dois e serie_tipo, e a diferenca decide se a linha entra na Divida ou nos Compromissos futuros. O nome foi mantido para nao tocar database.types.ts, actions e UI por cosmetica.';

commit;

-- =============================================================================
-- VERIFICACAO (rodar depois de aplicar)
--
-- 1) A coluna e a constraint existem:
--      select column_name, data_type from information_schema.columns
--       where table_schema = 'public' and table_name = 'finance_transactions'
--         and column_name = 'serie_tipo';
--
-- 2) A constraint recusa valor fora da lista:
--      -- deve FALHAR com finance_tx_serie_tipo_check
--      update public.finance_transactions set serie_tipo = 'assinatura'
--       where false;
--    (o `where false` nao toca linha nenhuma; para testar de verdade, use uma
--     linha descartavel e apague depois)
--
-- 3) Nada foi reclassificado sem querer:
--      select serie_tipo, count(*) from public.finance_transactions group by 1;
--    Espera-se TUDO em null logo apos aplicar.
--
-- PENDENCIA DE APLICACAO (nao e SQL):
--   - Regerar src/lib/database.types.ts: FinanceTransaction ganha serie_tipo.
-- =============================================================================
