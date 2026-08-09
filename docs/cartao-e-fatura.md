# Cartão de crédito: limite, competência e rotativo

`src/lib/credit.ts` é a autoridade sobre ciclo de fatura. `src/lib/finance.ts` é a
autoridade sobre em que mês um lançamento pesa. Este documento existe porque os
três defeitos abaixo têm a mesma assinatura: **o número na tela estava errado e
nada indicava isso**.

---

## 1. O limite não era consumido

### O que acontecia

O formulário oferecia a caixa **"Já pago / recebido"**, marcada por padrão.
Desmarcá-la numa compra de cartão é o gesto natural — "a fatura nem fechou, eu
não paguei isso ainda" — e era exatamente o que apagava a dívida:

```
FinanceForms      is_paid: false            (o que o usuário marcou)
     ↓
0005:267 / 0010:431   left join ... and t.is_paid = true
     ↓
a linha não entra em balance_cents → debt_cents fica 0 → available_cents não move
```

Cada elo estava certo isoladamente. O defeito era a **pergunta**.

### A regra

**"Já pagou?" não se aplica a compra em cartão.** São duas perguntas separadas:

| Pergunta | Onde ela vive |
|---|---|
| A dívida existe? | Sempre, desde o instante da compra |
| A **fatura** foi paga? | `statement_month` + o lançamento de pagamento |

O caminho **parcelado** já sabia disso desde a 0010 (`createInstallmentPurchase`
força `is_paid: true`). A correção foi estender ao resto do cartão o que já valia
para o parcelamento — não inventar regra nova.

### As quatro camadas

| # | Onde | O quê |
|---|---|---|
| 1 | `FinanceForms` | A caixa não é renderizada em cartão. **Conveniência** |
| **2** | **`pagoNoCartao()` na action** | **Força `true`. É a que vale** |
| 3 | `sincronizarFaturas()` | Normaliza ao converter uma conta em cartão |
| 4 | `trg_finance_tx_divida_de_cartao` (0022) | Último recurso: SQL editor, script |

A camada 2 é a que importa: uma Server Action **é um endpoint HTTP**, e um POST
montado à mão manda o que quiser. Se a regra viver só no formulário, ela não
existe.

⚠️ A camada 4 **normaliza** em vez de recusar. Recusar criaria um beco sem saída
no caso mais importante: converter uma conta comum em cartão faria as linhas
antigas violarem a regra sem ninguém ter escrito nada nelas, e a partir daí
qualquer edição falharia com erro cru de constraint.

### ⚠️ Se um cartão seu estiver com o tipo errado

O reparo da 0022 só alcança contas `kind = 'credit_card'`. Fora de cartão,
`available_cents` já é `NULL` por desenho — **não existe limite a consumir**.

Confira:

```sql
select name, kind, credit_limit_cents, statement_closing_day, payment_due_day
  from public.finance_accounts
 where archived_at is null
 order by kind, name;
```

Conta com cara de cartão e `kind` diferente de `'credit_card'` se conserta pela
tela: **Financeiro → Contas → Editar → Tipo**. `upsertAccount` recalcula
`statement_month` de todos os lançamentos ("VIROU cartão: recalcula TUDO") e
normaliza o `is_paid` junto.

---

## 2. Competência: o mês de um lançamento de cartão é o da FATURA

### O que acontecia

Toda soma do Painel filtrava por `occurred_on`. Compra em **25/03** num cartão
que fecha dia **22** entra na fatura de **abril** — mas era contada como despesa
de **março**. O mês em que o número aparecia e o mês em que a conta era paga
eram diferentes.

A coluna certa já existia: `statement_month`, gravada na criação desde a 0010. O
Painel não a consultava.

### A regra, em uma função

```ts
mesDeCompetencia(tx, cartoes) =
  cartão ? tx.statement_month : tx.occurred_on
```

`cartoes` é **obrigatório** em toda soma (`monthTotals`, `expensesByCategory`,
`budgetProgress`, …). Um parâmetro opcional reintroduziria o defeito no primeiro
ponto de uso novo que esquecesse de passá-lo — e não falharia: só somaria no mês
errado. É a mesma decisão de `paraCampoLocal(iso, formato)` em `tempo.ts`.

### `null` — o caso que não pode sumir em silêncio

Lançamento de cartão **sem** `statement_month` (cartão sem dia de fechamento, ou
linha anterior à 0010) não pertence a fatura nenhuma. Ele:

- **pesa** em `debt_cents` (a view só olha `is_paid`);
- **não entra** em nenhuma soma mensal;
- é **contado** por `foraDeCompetencia()` e mostrado no Painel.

Omitir sem avisar produziria uma despesa menor que a real, e a única pista seria
a dívida não bater.

### O que mudou de lugar na tela

| Onde | Antes | Agora |
|---|---|---|
| Painel (todas as somas) | `occurred_on` | competência |
| Aba **Lançamentos** | `occurred_on` | competência, com selo "Fatura de …" |
| **Orçamentos** | `occurred_on` | competência |
| Início (`ResumoFinanceiro`) | `occurred_on` | competência |

A lista seguiu junto de propósito. Listar por data da compra produziria o pior
defeito possível numa tela de dinheiro: o Painel dizendo "Despesas de abril:
R$ 2.300" e a lista do mesmo mês somando outra coisa.

### ⚠️ Os números vão mudar

Esta é uma correção, e ela **muda totais que já estavam na tela**. Um mês pode
ficar maior e o vizinho menor. Não é regressão.

### "A pagar este mês" ≠ "Dívida total"

Dois cartões, **sempre juntos**:

| Cartão | Responde |
|---|---|
| **A pagar em {mês}** | Faturas que **vencem** no mês (`faturasQueVencemEm`) |
| **Dívida total** | Tudo, com o horizonte explícito ("até nov/2027") |

Sozinho, o número curto é otimista: "R$ 1.200 este mês" soa administrável mesmo
com R$ 14.000 de parcelas atrás. É o mesmo raciocínio que o cartão "Líquido" já
seguia.

⚠️ **A janela de `getFinanceSnapshot` foi para TRÊS meses** por causa disso: o
que vence em M pode ser a fatura de M-1, feita de compras que começam no
fechamento de M-2. Com dois meses, o "a pagar" viria menor que o real. Efeito
colateral: as janelas da página Início passaram a se sobrepor — junte por `id`
antes de somar.

---

## 3. Rotativo: pagamento parcial com juros

### ⚠️ O ponto de modelagem que decide tudo

**O saldo que rola para o mês seguinte NÃO é despesa nova.** Ele já foi contado,
uma vez por compra. Criar um lançamento de "saldo remanescente" na fatura
seguinte contaria a mesma despesa **duas vezes** — o erro que o `Dashboard` já
documenta ter corrigido no cálculo de patrimônio.

| Elemento | Vira lançamento? | Onde |
|---|---|---|
| Principal que rolou | ❌ **Não** | Continua na fatura de origem, em aberto |
| **Juros** | ✅ Sim | Despesa no cartão, na fatura seguinte |
| **IOF / encargos** | ✅ Sim, se houver | Idem, somado ao mesmo lançamento |

O teste que protege isso é *"A DÍVIDA DA FATURA NÃO MUDA COM O PAGAMENTO
PARCIAL"* em `credit.test.ts`. Se ele cair, a dívida passou a crescer sozinha a
cada pagamento — o oposto do que um pagamento faz.

### O cálculo

```
juros = round(saldoRemanescente × taxa / 100)
```

**Juros simples**, não composto: a previsão é de **um mês**, e a conta simples
tem uma vantagem que a exata não tem — quem digitou a taxa confere o resultado de
cabeça. Uma previsão que não se confere não é usada.

Multiplicar antes de dividir (`(saldo × taxa) / 100`) e arredondar **uma vez, no
fim**: dividir primeiro introduz erro de ponto flutuante que o arredondamento
depois amplia.

### ⚠️ Nenhuma taxa é sugerida

Não há valor padrão, nem "taxa média do mercado", nem memória da última usada. O
rotativo varia por emissor e por contrato; um número nosso apareceria com a mesma
cara de um número do usuário, e a previsão errada seria indistinguível da certa.

O teto de **100% ao mês** existe só para pegar erro de digitação ("1500" no lugar
de "15,00").

### Em que fatura os juros caem

`faturaDoEncargo(mesFaturaPaga, dataDoPagamento, diaFechamento)` — a regra base é
a de **qualquer** lançamento (`faturaDe`), com um piso: a fatura **seguinte** à
que foi paga.

O piso cobre o pagamento **antecipado**: num cartão que fecha dia 5, quem quita a
fatura de agosto no dia 3 de agosto faria `faturaDe` devolver *agosto* — a
própria fatura sendo paga. Os juros inflariam o total que acabou de ser quitado.

Não existe uma segunda regra de data neste módulo, e não pode existir:
`reescreverFaturas` recalcula tudo pela primeira quando o cartão é editado, e
apagaria a segunda em silêncio.

### Onde os encargos aparecem

Categoria **"Juros e encargos"**, criada sob demanda na primeira cobrança
(`categoriaDeEncargos`). Categoria e não coluna nova: o Painel já agrupa por
categoria, então os encargos entram na rosca com nome próprio e podem ganhar
orçamento como qualquer outra — sem migration e sem caso especial em nenhuma soma.

⚠️ O lançamento de encargo **não** carrega `transfer_group_id`. Amarrá-lo ao grupo
o transformaria numa perna de transferência, `isTransfer()` o excluiria de toda
soma de despesa, e os juros — a única coisa que o rotativo cria de novo — não
apareceriam em lugar nenhum.

---

## 4. Pagamento parcial de um lançamento (`paid_cents`, migration 0023)

### O obstáculo era o esquema

`is_paid` é booleano. Não havia como representar "paguei R$ 300 de R$ 800".

A **fatura** escapa disso porque não é uma linha: é um **conjunto** com o mesmo
`statement_month`, e `faturaDoCartao()` deriva `openCents = totalCents −
paidCents`. Um lançamento avulso não tem conjunto onde somar.

Três caminhos, e a escolha está registrada porque as outras duas voltam a parecer
boas ideias de longe:

| | |
|---|---|
| **(a) coluna `paid_cents`** | ✅ escolhida — menor mudança que resolve |
| (b) dividir a linha em duas | ❌ reescreve o histórico, quebra `installment_no`, o extrato deixa de bater |
| (c) tabela de pagamentos | mais elegante, desnecessária hoje. Migrar de (a) para (c) é **aditivo** |

### ⚠️ A 0023 substitui a função do gatilho da 0022

A **garantia continua inteira**: linha de cartão sai sempre com `is_paid = true`.
O que a nova versão acrescenta é `paid_cents = amount_cents` junto — sem isso, a
coerência entre as duas colunas se quebraria justamente no cartão.

Uma função e não duas porque o Postgres dispara gatilhos `before` da mesma tabela
em **ordem alfabética de nome**: um segundo gatilho teria a ordem codificada na
escolha do nome do arquivo, invisível e quebrável por um rename inocente.

### `is_paid` passa a ser derivado

Fora de cartão e fora de transferência, `is_paid := (paid_cents >= amount_cents)`.

⚠️ **Consequência para quem escreve:** mandar `is_paid = true` sem `paid_cents`
não marca mais nada como pago.

### ⚠️ A view passou a somar `paid_cents`

E o **significado dela não mudou**: continua respondendo "quanto já se moveu". O
que mudou é a **precisão** — antes ela só sabia responder em tudo-ou-nada.

**É um no-op para todo dado existente.** Com `is_paid ⟺ paid_cents >=
amount_cents` garantido pelo gatilho e o backfill do passo 2 da migration:

```
linha paga      antes somava amount_cents; agora soma paid_cents, que é igual
linha não paga  antes era filtrada fora;   agora soma paid_cents = 0
```

Sem essa mudança, pagar R$ 300 de uma despesa de R$ 800 tiraria R$ 300 da conta
no mundo real e **zero** no aplicativo — e o saldo deixaria de bater com o
extrato, que é o número contra o qual tudo é conferido.

### ⚠️ O restante não vira lançamento novo

Mesma regra do rotativo: a despesa já foi contada quando foi lançada. Só os
**encargos** viram linha, e eles nascem **não pagos** — o juro é dívida nova, que
ainda vai sair.

### Por que não há "conta de origem"

Uma **fatura** precisa dela porque vive no cartão e o dinheiro tem que vir de
fora. Um lançamento avulso **já está na conta de onde o dinheiro sai**; pagá-lo é
registrar que ele saiu dali, e a view faz o saldo se mover sozinho. Um campo
"pagar com" seria um no-op (a mesma conta) ou criaria uma transferência que
contaria a saída duas vezes.

> Isto diverge do plano V2 §5.3, que listava "conta de origem" no fluxo. O plano
> espelhava a forma de `StatementPaymentForm` sem notar que o caso avulso é
> diferente. Quem pagou de outra conta edita a conta do lançamento — que é o que
> de fato aconteceu.

### Editar um lançamento parcialmente pago

A caixa "Já pago / recebido" **sai da tela** nesse caso, e a action **preserva**
`paid_cents`. Ela só sabe dizer tudo ou nada: marcar quitaria o que ainda se
deve, desmarcar apagaria o que já saiu da conta — e as duas escolhas pareceriam
inofensivas.

### Trava otimista

`payTransaction` atualiza com `.eq("paid_cents", valorLido)`. Sem isso, dois
pagamentos concorrentes leem `paid_cents = 0`, ambos gravam 300, e a linha fica
com 300 pagos depois de 600 terem saído da conta.

---

## 5. Migration 0022

⚠️ **Leia o cabeçalho de `0022_cartao_divida_desde_a_compra.sql` antes de
aplicar.** Ele traz a consulta de contagem, e o reparo **faz a dívida saltar**:
dívida que estava invisível passa a aparecer e o limite disponível cai.

O que o reparo **não** toca: `transfer_group_id is not null`. A perna que entra
num cartão com grupo é o **pagamento da fatura**, e marcá-la como paga abateria a
dívida — o reparo empurraria o número para o lado errado. Na dúvida, ele erra
para o lado de **mostrar** dívida, nunca de escondê-la.
