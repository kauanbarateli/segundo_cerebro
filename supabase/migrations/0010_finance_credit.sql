-- =============================================================================
-- 0010 — Cartao de credito: fatura, parcelamento e divida
--
-- O ERRO CONCEITUAL QUE ESTA MIGRATION CORRIGE
--
-- Desde 0005 `finance_accounts.kind` aceita 'credit_card', mas nada no banco
-- fazia um cartao se comportar como cartao. A view `finance_account_balances`
-- calcula TODA conta como `saldo_inicial + entradas - saidas`, o que para
-- cartao mente em dois niveis:
--
--   1. TEMPO — a compra nao sai da conta na data da compra. Ela entra na
--      FATURA, que fecha no dia X e vence no dia Y. Quem decide o mes de uma
--      compra e o fechamento, nao o calendario.
--   2. SINAL — saldo de cartao nao e dinheiro que se tem, e DIVIDA. Somar o
--      cartao ao patrimonio conta a MESMA despesa DUAS vezes: uma na compra
--      (expense no cartao) e outra no pagamento da fatura (expense na conta
--      corrente, perna da transferencia). O numero final fica duas vezes mais
--      pessimista do que a realidade.
--
-- As convencoes de data implementadas na aplicacao (`src/lib/credit.ts`, com
-- 38 testes) valem tambem aqui e estao repetidas nos comentarios das colunas,
-- porque quem le so o schema precisa entender o contrato sem abrir o TypeScript:
--
--   - Mes da fatura = mes em que ela FECHA, canonico "YYYY-MM-01" (mesmo
--     formato de `finance_budgets.month`, para fatura e orcamento serem
--     comparaveis sem conversao).
--   - Corte `>=`: compra no PROPRIO dia do fechamento ja e da proxima fatura.
--   - Dia que nao existe no mes (fechamento 31 em fevereiro) vale como ULTIMO
--     dia do mes, nunca transborda para o mes seguinte.
--
-- DINHEIRO: bigint em CENTAVOS. Nunca float — 0.1+0.2 != 0.3 em IEEE-754.
-- Idempotente: `if not exists` em coluna e indice, e bloco do/pg_constraint
-- para os CHECKs (`alter table add constraint` NAO tem `if not exists`).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. finance_accounts — os campos que fazem um cartao ser cartao
--
-- Ficam na propria tabela (e nao numa `finance_credit_cards` separada) porque
-- sao 3 colunas, o relacionamento seria 1:1 obrigatorio e toda leitura de conta
-- precisaria de um join. O preco e um CHECK condicional, escrito abaixo.
-- -----------------------------------------------------------------------------
alter table public.finance_accounts
  add column if not exists credit_limit_cents    bigint,
  add column if not exists statement_closing_day smallint,
  add column if not exists payment_due_day       smallint;

comment on column public.finance_accounts.credit_limit_cents is
  'Limite total do cartao em CENTAVOS (bigint, nunca float). NULL em conta que nao e cartao. Obrigatorio e > 0 quando kind = ''credit_card''.';
comment on column public.finance_accounts.statement_closing_day is
  'Dia do mes (1-31) em que a fatura FECHA. Compra no proprio dia do fechamento ja pertence a fatura seguinte (corte >=). Dia inexistente no mes vale como o ultimo dia do mes: fechamento 31 fecha em 28/29 de fevereiro. NULL em conta que nao e cartao.';
comment on column public.finance_accounts.payment_due_day is
  'Dia do mes (1-31) em que a fatura VENCE. Quando payment_due_day <= statement_closing_day (o classico "fecha 28, vence 5"), o vencimento cai no mes SEGUINTE ao do fechamento — uma fatura nunca vence antes de fechar. NULL em conta que nao e cartao.';

-- -----------------------------------------------------------------------------
-- 1.1 CHECK condicional: os tres campos sao obrigatorios so para cartao.
--
-- ARMADILHA (a) — POR QUE `kind <> 'credit_card'` E SEGURO AQUI:
-- CHECK trata NULL como SUCESSO (so reprova quando o predicado e FALSE). E
-- "NULL <> valor" avalia para NULL, nao TRUE. Entao, se `kind` fosse anulavel,
-- uma linha com kind NULL faria a primeira perna virar NULL, a segunda perna
-- (com os campos vazios) virar FALSE, e `NULL or FALSE` = NULL — o CHECK
-- passaria por engano e deixaria entrar lixo. Conferido em 0005 linha 29:
--   kind text NOT NULL default 'checking'
-- Com NOT NULL o `<>` sempre devolve TRUE ou FALSE e o raciocinio fecha.
-- Se algum dia alguem remover esse NOT NULL, este CHECK vira decorativo — por
-- isso o alerta fica escrito aqui e nao so no commit.
--
-- ARMADILHA (b) — TABELA COM DADOS EXISTENTES:
-- `add constraint ... check` VALIDA a tabela inteira na hora e ABORTA a
-- migration se uma unica linha violar. Uma conta antiga com kind='credit_card'
-- criada antes desta migration nao tem nenhum dos tres campos preenchidos: ela
-- violaria. As tres saidas possiveis eram:
--
--   (i)   Enfraquecer o CHECK para linhas legadas passarem (ex.: exigir os
--         campos so quando algum deles ja estiver preenchido). Rejeitado: o
--         furo ficaria PERMANENTE e novas linhas ruins tambem entrariam. Uma
--         constraint que nao constrange e pior que nenhuma, porque da a falsa
--         sensacao de garantia.
--   (ii)  Documentar que o dono precisa preencher a mao ANTES de aplicar.
--         Rejeitado: migration que depende de ritual manual quebra em producao
--         exatamente no dia em que alguem esquece.
--   (iii) `NOT VALID` + `VALIDATE CONSTRAINT` condicional. ESCOLHIDA.
--
-- Como (iii) funciona: `NOT VALID` cria a constraint sem varrer o passado, mas
-- ela JA VALE para todo INSERT/UPDATE dali em diante — o dado novo esta seguro
-- desde o primeiro segundo. Em seguida contamos as linhas legadas violadoras:
--   - zero (caso normal, e o caso de um banco que ainda nao tem cartao):
--     validamos na hora e a constraint termina a migration plenamente valida,
--     sem deixar divida tecnica;
--   - alguma: emitimos WARNING com o numero e a constraint fica NOT VALID. A
--     migration NAO falha, nada e corrompido, e o dono corrige quando puder.
-- Rodar de novo depois da correcao valida a constraint: o bloco e idempotente
-- e re-tenta a validacao enquanto `convalidated` for false.
--
-- O predicado da contagem NAO e a negacao literal do CHECK. `not (a and b)`
-- devolveria NULL quando `b` fosse NULL (limite preenchido, fechamento vazio) e
-- o WHERE descartaria a linha em silencio — a mesma armadilha de NULL de novo,
-- so que do lado que nos cegaria. Por isso a violacao e escrita como uma lista
-- de OR com `is null` explicito, que nunca produz NULL.
-- -----------------------------------------------------------------------------
do $$
declare
  v_violacoes bigint;
begin
  -- `conrelid` alem de `conname` porque nome de constraint e unico POR TABELA,
  -- nao por banco: sem o conrelid, uma constraint homonima em outra tabela
  -- faria este bloco achar que ja criou a daqui e pular a criacao.
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.finance_accounts'::regclass
      and conname  = 'finance_accounts_credit_card_fields_check'
  ) then
    alter table public.finance_accounts
      add constraint finance_accounts_credit_card_fields_check
      -- As TRES colunas precisam de `is not null` EXPLICITO, nao so o limite.
      -- `NULL between 1 and 31` avalia para NULL, e nao para FALSE. Como
      -- `TRUE and NULL` = NULL, `FALSE or NULL` = NULL, e um CHECK so REPROVA
      -- quando o predicado da FALSE (NULL conta como sucesso), sem esta guarda
      -- a segunda perna do OR virava NULL e a linha incompleta PASSAVA:
      --
      --   kind='credit_card', credit_limit_cents=500000,
      --   statement_closing_day=NULL, payment_due_day=NULL   -> aceita
      --
      -- E a mesma armadilha do NULL que o cabecalho descreve para
      -- `kind <> 'credit_card'`, so que aplicada as colunas novas. Note que o
      -- CONTADOR de violacoes logo abaixo sempre usou `is null` explicito pelo
      -- mesmo motivo: os dois predicados precisam ser um a negacao do outro,
      -- senao o contador mede uma regra mais estrita do que a constraint exige.
      check (
        (kind <> 'credit_card')
        or (
          credit_limit_cents is not null
          and credit_limit_cents > 0
          and statement_closing_day is not null
          and statement_closing_day between 1 and 31
          and payment_due_day is not null
          and payment_due_day between 1 and 31
        )
      )
      not valid;
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.finance_accounts'::regclass
      and conname  = 'finance_accounts_credit_card_fields_check'
      and not convalidated
  ) then
    select count(*) into v_violacoes
    from public.finance_accounts
    where kind = 'credit_card'
      and (
        credit_limit_cents is null
        or credit_limit_cents <= 0
        or statement_closing_day is null
        or statement_closing_day < 1
        or statement_closing_day > 31
        or payment_due_day is null
        or payment_due_day < 1
        or payment_due_day > 31
      );

    if v_violacoes = 0 then
      alter table public.finance_accounts
        validate constraint finance_accounts_credit_card_fields_check;
    else
      raise warning
        'finance_accounts: % conta(s) com kind=''credit_card'' sem limite/fechamento/vencimento. A constraint finance_accounts_credit_card_fields_check ficou NOT VALID (ja vale para dados novos). Preencha as colunas e rode esta migration de novo para valida-la.',
        v_violacoes;
    end if;
  end if;
end
$$;

comment on constraint finance_accounts_credit_card_fields_check on public.finance_accounts is
  'Limite, dia de fechamento e dia de vencimento sao obrigatorios quando kind = ''credit_card''. As TRES colunas tem `is not null` explicito: `NULL between 1 and 31` avalia para NULL, e CHECK trata NULL como sucesso — sem a guarda, a segunda perna do OR virava NULL e a linha incompleta passava. Seguro do outro lado tambem porque kind e NOT NULL: com kind anulavel o "<>" devolveria NULL e o CHECK passaria por engano.';

-- -----------------------------------------------------------------------------
-- 2. finance_transactions — parcelamento
--
-- Modelo: uma compra parcelada vira N LINHAS, uma por parcela, cada uma com sua
-- propria `occurred_on` (e portanto sua propria fatura). Nao existe linha
-- "compra mae". Motivo: assim toda consulta de fatura, orcamento e dashboard
-- continua sendo uma soma simples de `finance_transactions`, sem caso especial;
-- e o valor de cada mes ja e o que de fato pesa naquele mes.
--
-- A divisao dos centavos e feita por `parcelas()` em src/lib/credit.ts, com a
-- ultima parcela absorvendo o resto (soma das parcelas === total, sempre).
-- Sem isso R$ 100,00 em 3x viraria 3 x R$ 33,33 = R$ 99,99 e o sistema passaria
-- a dever um centavo a si mesmo em toda compra parcelada.
-- -----------------------------------------------------------------------------
alter table public.finance_transactions
  add column if not exists installment_group_id uuid,
  add column if not exists installment_no       smallint,
  add column if not exists installment_total    smallint;

comment on column public.finance_transactions.installment_group_id is
  'Liga as N linhas de uma mesma compra parcelada. Mesmo modelo de agrupamento de transfer_group_id (0005): o grupo e um uuid gerado pela aplicacao, sem tabela pai. NULL em lancamento a vista.';
comment on column public.finance_transactions.installment_no is
  'O "3" de "3 de 12". Entre 1 e installment_total. NULL em lancamento a vista.';
comment on column public.finance_transactions.installment_total is
  'O "12" de "3 de 12". NULL em lancamento a vista.';

-- -----------------------------------------------------------------------------
-- 2.1 CHECK do parcelamento: os tres campos sao "tudo ou nada".
--
-- Aqui NAO e preciso `not valid`, e a diferenca em relacao ao caso do item 1.1
-- e o ponto: as tres colunas ACABARAM de ser criadas, entao toda linha
-- preexistente tem os tres em NULL e cai na primeira perna do OR. A validacao
-- imediata e garantidamente satisfeita por construcao. Usar `not valid` aqui
-- seria cerimonia sem beneficio e ainda deixaria a constraint nao validada
-- (invisivel para o planejador) de graca.
--
-- `installment_total >= 1` esta explicito porque `installment_no between 1 and
-- installment_total` sozinho ja rejeitaria total 0 (intervalo vazio), mas nao
-- deixaria a intencao legivel — e um total negativo passaria despercebido na
-- leitura do schema.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.finance_transactions'::regclass
      and conname  = 'finance_tx_installment_check'
  ) then
    alter table public.finance_transactions
      add constraint finance_tx_installment_check
      check (
        (
          installment_group_id is null
          and installment_no is null
          and installment_total is null
        )
        or (
          installment_group_id is not null
          and installment_no is not null
          and installment_total is not null
          and installment_total >= 1
          and installment_no between 1 and installment_total
        )
      );
  end if;
end
$$;

comment on constraint finance_tx_installment_check on public.finance_transactions is
  'Os tres campos de parcelamento sao todos nulos (compra a vista) ou todos preenchidos, com 1 <= installment_no <= installment_total.';

-- -----------------------------------------------------------------------------
-- 2.2 Indice do grupo de parcelas.
--
-- CONFERENCIA DE REDUNDANCIA (obrigatoria antes de criar indice — indice
-- redundante custa disco, e mantido em TODA escrita e polui as estatisticas do
-- planejador, deixando o banco mais lento). Indices ja existentes sobre
-- finance_transactions:
--   0005: finance_tx_period_idx   (user_id, occurred_on desc)
--   0005: finance_tx_account_idx  (account_id, occurred_on desc)
--   0005: finance_tx_category_idx (category_id)
--   0005: finance_tx_transfer_idx (transfer_group_id) where not null
--   0008: nada em finance_transactions (a proposta (user_id, occurred_on desc)
--         foi DESCARTADA justamente por duplicar finance_tx_period_idx)
--   0009: nada em finance_transactions
-- Nenhum deles tem installment_group_id em posicao alguma, e um indice cuja
-- coluna nao e o prefixo nao serve para o lookup `where installment_group_id =
-- $1` (usado ao editar ou excluir uma compra parcelada inteira). Nao ha
-- redundancia.
--
-- Parcial `where installment_group_id is not null` pelo mesmo motivo do
-- finance_tx_transfer_idx: a esmagadora maioria dos lancamentos e a vista, e
-- linha fora do predicado nem entra no indice nem paga manutencao dele.
-- -----------------------------------------------------------------------------
create index if not exists finance_tx_installment_group_idx
  on public.finance_transactions (installment_group_id)
  where installment_group_id is not null;

comment on index public.finance_tx_installment_group_idx is
  'Busca as N parcelas de uma compra pelo grupo. Parcial: lancamento a vista nao entra. Ver 0010.';

-- -----------------------------------------------------------------------------
-- 3. finance_transactions.statement_month — a que fatura a linha pertence
--
-- DUAS OPCOES ESTAVAM NA MESA:
--
--   (a) Coluna `statement_month date` gravada pela aplicacao na escrita.
--   (b) Derivar sempre na leitura a partir de occurred_on + statement_closing_day.
--
-- ESCOLHIDA: (a). A razao nao e desempenho (embora (b) nao seja indexavel nem
-- agrupavel barato), e sim SEMANTICA: a fatura e um FATO HISTORICO. Se em
-- outubro o dono mudar o fechamento do cartao de 15 para 5, a opcao (b)
-- REESCREVERIA retroativamente as faturas de todos os meses anteriores —
-- compras que ja foram faturadas, cobradas e PAGAS em marco apareceriam de
-- repente em abril, e o total de uma fatura ja quitada deixaria de bater com o
-- extrato do banco. Isso e o oposto de "sempre coerente": e coerente com a
-- configuracao de hoje e incoerente com a realidade.
--
-- (b) ainda seria defensavel se a fatura fosse so um agrupamento visual, mas
-- ela e conciliada contra um pagamento real. Fato historico se congela.
--
-- RESSALVA DA OPCAO (a), que e o preco dela: a coluna pode DIVERGIR do que
-- `faturaDe(occurred_on, statement_closing_day)` calcularia hoje. Isso e
-- esperado para o passado; para o futuro nao pode acontecer. Contrato:
--   - Toda escrita de lancamento em conta com kind='credit_card' preenche
--     statement_month usando faturaDe() de src/lib/credit.ts.
--   - Ao mudar o dia de fechamento, a aplicacao recalcula statement_month
--     APENAS das linhas ainda nao faturadas (occurred_on depois do ultimo
--     fechamento ocorrido). Faturas passadas nao sao remendadas.
--   - Lancamento fora de cartao deixa a coluna NULL.
--
-- POR QUE NAO UM TRIGGER que preenche sozinho: o trigger teria de reimplementar
-- em plpgsql a regra de corte `>=` mais o clamp de dia inexistente, virando uma
-- SEGUNDA implementacao das mesmas convencoes de data — a que os 38 testes de
-- credit.test.ts nao cobrem. Duas implementacoes da mesma regra divergem; a
-- fonte da verdade fica em um lugar so.
-- -----------------------------------------------------------------------------
alter table public.finance_transactions
  add column if not exists statement_month date;

comment on column public.finance_transactions.statement_month is
  'Mes da fatura a que o lancamento pertence, normalizado no dia 1 ("YYYY-MM-01"), igual a finance_budgets.month para que fatura e orcamento sejam comparaveis sem conversao. Mes da fatura = mes em que ela FECHA. Gravado pela aplicacao com faturaDe() (src/lib/credit.ts); e um FATO HISTORICO e NAO e recalculado para tras quando o dia de fechamento muda. NULL fora de cartao de credito.';

-- Normaliza no dia 1, mesma constraint de finance_budgets.month (0005): sem
-- isso "2025-04-01" e "2025-04-15" seriam duas faturas distintas do mesmo mes.
-- Nao precisa de `not valid`: a coluna acabou de ser criada, todas as linhas
-- existentes tem NULL e a primeira perna do OR as absolve.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.finance_transactions'::regclass
      and conname  = 'finance_tx_statement_month_is_first_day'
  ) then
    alter table public.finance_transactions
      add constraint finance_tx_statement_month_is_first_day
      check (statement_month is null or extract(day from statement_month) = 1);
  end if;
end
$$;

-- Indice da consulta central do modulo: "os lancamentos da fatura de MES do
-- cartao X". Conferencia de redundancia: finance_tx_account_idx (0005) e
-- (account_id, occurred_on desc) — mesmo prefixo, mas a segunda coluna e
-- outra, entao ele so filtraria por account_id e depois varreria o resto da
-- conta aplicando statement_month como filtro. Aqui as duas colunas viram
-- lookup direto. Nao e duplicata.
-- Parcial porque so cartao preenche a coluna: numa carteira com uma conta
-- corrente e um cartao, o indice cobre uma fracao pequena da tabela.
create index if not exists finance_tx_statement_idx
  on public.finance_transactions (account_id, statement_month)
  where statement_month is not null;

comment on index public.finance_tx_statement_idx is
  'Lancamentos de uma fatura (cartao + mes). Parcial: so linhas de cartao preenchem statement_month. Ver 0010.';

-- -----------------------------------------------------------------------------
-- 4. A VIEW — separar DINHEIRO de DIVIDA
--
-- POR QUE CARTAO E DIVIDA E NAO SALDO:
-- O saldo de uma conta corrente responde "quanto eu TENHO". O de um cartao
-- responde "quanto eu DEVO" — e o sinal contrario. Como toda compra no cartao
-- entra como `expense`, a formula generica saldo_inicial + entradas - saidas ja
-- devolve o numero certo em MODULO, so que NEGATIVO. Somar esse negativo ao
-- patrimonio faz a mesma despesa ser contada DUAS vezes: uma agora (a compra,
-- que derruba o "saldo" do cartao) e outra quando a fatura for paga (a perna
-- expense da transferencia, que derruba a conta corrente de verdade). Os dois
-- numeros existem por motivos diferentes e nunca devem virar um so: um total
-- "patrimonio - divida" esconde exatamente o endividamento que o dashboard
-- precisa mostrar.
--
-- DECISAO DE COMPATIBILIDADE: `balance_cents` NAO muda de significado. A
-- tentacao seria fazer o cartao devolver a divida positiva ali dentro, mas essa
-- e uma mudanca SILENCIOSA — src/lib/finance.ts e a FinanceView continuariam
-- compilando e passariam a somar numeros com o sinal trocado, sem uma linha de
-- erro. Em vez disso, tres colunas NOVAS, explicitas, no fim da lista:
-- is_credit, debt_cents, available_cents. `patrimonioEDivida()` em
-- src/lib/credit.ts depende de balance_cents continuar negativo para cartao.
--
-- POR QUE `create or replace view` E NAO `drop` + `create`:
-- `create or replace` exige que as colunas EXISTENTES mantenham nome, tipo e
-- ORDEM, e que as novas venham DEPOIS. A ordem de 0005 e
--   account_id, user_id, name, kind, currency, opening_balance_cents, balance_cents
-- e ela e integralmente preservada abaixo, com as tres novas no fim. Como cabe,
-- este e o caminho preferido: `drop view` derrubaria junto os GRANTS e
-- quebraria qualquer objeto dependente. Os grants sao reemitidos mesmo assim,
-- por baixo custo e defesa em profundidade.
--
-- ARMADILHA DE TIPO (o que quebraria o `replace`): `sum(bigint)` no Postgres
-- devolve NUMERIC, entao `opening_balance_cents + coalesce(sum(...), 0)` faz de
-- balance_cents uma coluna NUMERIC, nao bigint. Castar essa coluna para bigint
-- "para ficar bonito" faria o comando abortar com "cannot change data type of
-- view column". A expressao de balance_cents esta reproduzida LETRA POR LETRA
-- de 0005. Os casts explicitos para bigint aparecem so nas colunas NOVAS, onde
-- somos livres para fixar o tipo — e onde ele importa, porque dinheiro sai
-- daqui direto para a UI.
--
-- HERANCA DO `is_paid`: o join continua filtrando `t.is_paid = true`, como em
-- 0005. Logo debt_cents tambem ignora lancamento nao pago. Mexer nisso mudaria
-- balance_cents junto e esta fora do escopo desta migration. Observe que
-- `faturaDoCartao()` em credit.ts NAO filtra is_paid de proposito (quem define
-- a fatura de uma compra e a data dela contra o fechamento) — a divergencia e
-- consciente: a view responde "quanto ja pesa no bolso", a fatura responde "o
-- que caiu neste ciclo".
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
             when t.kind = 'income'  then  t.amount_cents
             when t.kind = 'expense' then -t.amount_cents
             -- Transferencia: o sinal depende do lado. Modelamos as duas pernas
             -- como income/expense, entao 'transfer' puro nao altera saldo.
             else 0
           end
         ), 0) as balance_cents
  from public.finance_accounts a
  left join public.finance_transactions t
         on t.account_id = a.id
        and t.is_paid = true
  group by a.id, a.user_id, a.name, a.kind, a.currency,
           a.opening_balance_cents, a.credit_limit_cents
),
credito as (
  select m.*,
         (m.kind = 'credit_card') as is_credit,
         -- Divida = o oposto do saldo, porque compra no cartao entra como
         -- expense e joga balance_cents para baixo. Sem piso em zero de
         -- proposito: cartao pago a maior vira divida NEGATIVA (credito a
         -- favor), e quem decide como mostrar isso e a interface. Zerar aqui
         -- esconderia justamente a informacao que importa.
         -- O cast numeric -> bigint e exato: todas as parcelas da soma sao
         -- inteiras, entao nao ha fracao para arredondar.
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
       -- Limite ainda utilizavel. Tambem sem piso em zero: no estouro o numero
       -- fica negativo e a UI mostra o quanto passou.
       -- NULL (e nao 0) fora de cartao: 0 significaria "sem limite disponivel",
       -- uma afirmacao falsa sobre uma conta corrente. NULL diz "nao se aplica".
       -- Tambem fica NULL num cartao legado sem credit_limit_cents preenchido
       -- (ver o WARNING do item 1.1) — a UI trata como "limite nao informado".
       case
         when is_credit then (credit_limit_cents - debt_cents)::bigint
         else null::bigint
       end as available_cents
from credito;

-- OBRIGATORIO. Sem security_invoker a view roda com os privilegios do DONO e
-- IGNORA a RLS das tabelas de base, vazando dados entre usuarios. E o erro mais
-- comum do projeto, e `create or replace view` e exatamente o momento em que
-- ele reaparece: a opcao NAO e herdada automaticamente em toda versao, entao
-- reemitir depois de cada recriacao e regra da casa.
alter view public.finance_account_balances set (security_invoker = on);

comment on view public.finance_account_balances is
  'Saldo por conta. balance_cents mantem o significado de 0005 (dinheiro; NEGATIVO em cartao, porque compra e expense). Para cartao o numero relevante e debt_cents: saldo de cartao nao e dinheiro que se tem, e DIVIDA — somar os dois num total unico conta a mesma despesa duas vezes (na compra e no pagamento da fatura). security_invoker=on faz a view respeitar a RLS das tabelas de base.';

comment on column public.finance_account_balances.is_credit is
  'true quando kind = ''credit_card''. Existe para a UI e as consultas nao repetirem a comparacao com a string literal.';
comment on column public.finance_account_balances.debt_cents is
  'Quanto se DEVE no cartao, em CENTAVOS e como numero POSITIVO (e o oposto de balance_cents). 0 em conta que nao e cartao. Pode ser NEGATIVO se o cartao foi pago a maior: e credito a favor, e nao aplicamos piso em zero para nao esconder o fato.';
comment on column public.finance_account_balances.available_cents is
  'Limite ainda utilizavel: credit_limit_cents - debt_cents, em CENTAVOS. NULL em conta que nao e cartao ("nao se aplica"; 0 seria a afirmacao falsa "sem limite") e NULL em cartao sem limite cadastrado. Pode ser NEGATIVO quando o limite estourou — a UI precisa mostrar o quanto passou.';

-- Reemitidos por defesa em profundidade. Com `create or replace` os grants
-- sobrevivem, mas se algum dia esta view precisar de drop+create eles somem
-- junto — e o dia em que isso acontecer nao pode ser o dia em que o `anon`
-- ganha acesso a dados financeiros.
grant select on public.finance_account_balances to authenticated;
revoke all on public.finance_account_balances from anon;

commit;

-- =============================================================================
-- VERIFICACAO (rodar depois de aplicar)
--
-- 1) A view esta com security_invoker? Sem isso, vazamento entre usuarios.
--      select c.relname, c.reloptions
--      from pg_class c join pg_namespace n on n.oid = c.relnamespace
--      where n.nspname = 'public' and c.relname = 'finance_account_balances';
--    Espera-se reloptions contendo {security_invoker=on}.
--
-- 2) A ordem/tipo das colunas da view (o contrato com database.types.ts):
--      select attnum, attname, format_type(atttypid, atttypmod)
--      from pg_attribute
--      where attrelid = 'public.finance_account_balances'::regclass and attnum > 0
--      order by attnum;
--    Espera-se, nesta ordem: account_id uuid, user_id uuid, name text,
--    kind text, currency bpchar, opening_balance_cents bigint,
--    balance_cents numeric, is_credit boolean, debt_cents bigint,
--    available_cents bigint.
--
-- 3) A constraint do cartao ficou validada?
--      select conname, convalidated from pg_constraint
--      where conrelid = 'public.finance_accounts'::regclass
--        and conname = 'finance_accounts_credit_card_fields_check';
--    convalidated = false significa que existiam contas 'credit_card' legadas
--    incompletas (o WARNING dira quantas). Preencha credit_limit_cents,
--    statement_closing_day e payment_due_day e rode a migration de novo.
--
-- PENDENCIAS DE APLICACAO desta fase (nao sao SQL):
--   - Regerar src/lib/database.types.ts: FinanceAccount ganha 3 campos,
--     FinanceTransaction ganha 4, FinanceAccountBalance ganha 3.
--   - upsertTransaction/createTransfer devem preencher statement_month via
--     faturaDe() quando a conta for cartao, e installment_* via parcelas().
-- =============================================================================
