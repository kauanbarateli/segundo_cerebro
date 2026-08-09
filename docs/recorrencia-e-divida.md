# Recorrência, parcelamento, e o que conta como dívida

`src/lib/finance.ts` (`horizontesDoDinheiro`) decide o que é dívida.
`finance_transactions.serie_tipo` (migration `0024`) é a coluna que a informa.

---

## ⚠️ O risco desta parte não é técnico, é conceitual

**Recorrência e parcelamento se parecem na tela e são opostos no balanço.**

|  | **Recorrência** | **Parcelamento** |
|---|---|---|
| Valor | O mesmo em toda ocorrência | Total **dividido** em N |
| É dívida hoje? | **Não** | **Sim, por inteiro** |
| Cancelou no meio? | As futuras somem | A dívida continua |

**"12× aluguel de R$ 2.000" não é uma dívida de R$ 24.000.** Saindo do imóvel no
terceiro mês, os outros nove simplesmente não acontecem. **"12× de R$ 2.000 no
sofá" é dívida de R$ 24.000 desde o dia da compra**, e mudar de casa não devolve
o sofá.

A linha que separa não é a duração — é **se a contrapartida já foi entregue**.

> Tornar a recorrência **finita** deixou essa confusão mais provável, não menos.
> Antes, "repete para sempre" separava as duas sozinho — nem dava para somar um
> total. Agora as duas são "N ocorrências a partir de uma data", idênticas na
> estrutura, e o único diferenciador é uma coluna de texto.

Por isso os testes de composição (`horizontesDoDinheiro` em `finance.test.ts`)
valem mais que qualquer outro desta etapa:

- *"RECORRÊNCIA FUTURA ENTRA EM COMPROMISSOS, E NÃO EM DÍVIDA"*
- *"PARCELAMENTO FUTURO ENTRA EM DÍVIDA, POR INTEIRO"*
- *"NÃO CONTA DUAS VEZES: pendente de CARTÃO fica de fora da soma nova"*

---

## Os três números do Painel

| Card | Contém | Natureza |
|---|---|---|
| **Dívida** | Cartão (saldo) · despesa **vencida** não paga · parcelamento futuro | **Incondicional** — existe mesmo se você parar tudo hoje |
| **Compromissos futuros** | Recorrência futura · despesa futura não vencida | **Cancelável** |
| **Total previsto** | Dívida + Compromissos | Tudo o que ainda vai sair |

### ⚠️ O Líquido usa só a Dívida

```
liquido = patrimônio − dívida        ← e NUNCA menos o total previsto
```

Patrimônio líquido é ativo menos **passivo**; compromisso cancelável não é
passivo. Subtrair doze aluguéis futuros faria o Líquido despencar sem que nada
tivesse acontecido, e o número deixaria de significar o que o nome promete.

> A objeção original era sobre a **palavra**, não sobre a soma. Somar o futuro no
> total é útil e legítimo; chamar a soma de "dívida" é que seria errado. Com três
> números nomeados pelo que são, o futuro aparece no total e o Líquido continua
> significando patrimônio líquido.
>
> Fica registrado porque é o tipo de coisa que alguém vai querer "simplificar"
> depois, juntando os três num número só.

### A classificação, na ordem em que é decidida

1. **Venceu** (`occurred_on <= hoje`) e não foi paga → **Dívida**
   Vale para recorrência também: você não deve doze aluguéis, mas **deve o deste
   mês** se ele venceu.
2. É futura e é **parcelamento** → **Dívida**
3. É futura e é qualquer outra coisa → **Compromissos**

⚠️ **Conta de cartão fica de fora dessa soma**, e a exclusão é o que impede a
dupla contagem: compra no cartão já pesa em `debt_cents` pelo **saldo** da conta.

⚠️ **`serie_tipo is null` não é "tanto faz".** É lançamento avulso, e quem soma
decide pelo **estado** da linha. Tratar null como parcelamento faria toda despesa
futura solta virar passivo.

---

## Recorrência

### ⚠️ Não vai em cartão de crédito

O gatilho da `0023` força `is_paid = true` em toda linha de cartão — a garantia
que impede o limite de deixar de ser consumido. Com ela, as doze ocorrências
futuras de uma assinatura entrariam na dívida e comeriam limite que o cartão
**ainda não comprometeu** (diferente de um parcelamento, em que o banco já
autorizou o total).

A alternativa seria abrir exceção no gatilho por `serie_tipo` — e aí
"recorrência" viraria a forma de gravar compra de cartão não paga, que é
exatamente o estado que apagava a dívida do sistema. **A recusa é barata; a
exceção custaria a garantia inteira.**

Assinatura no cartão: lance na conta de onde a fatura é paga.

### Uma coluna, nenhuma tabela

Como a recorrência é sempre **finita** (o usuário informa quantas vezes), não há
horizonte rolante, nada a materializar ao navegar para o futuro, e nenhuma coluna
"materializado até". `finance_transactions` já tinha tudo que agrupa e numera uma
série. A `finance_recurrences` que uma versão anterior do plano previa existia só
para dar conta de "repete para sempre".

### ⚠️ Dívida de nome, consciente

`installment_group_id` agrupa **também** recorrência, e o nome diz "parcela".
Renomear tocaria `database.types.ts`, actions e UI por cosmética. Está mantido e
documentado — no comentário da coluna, no tipo, e aqui.

### O que NÃO acompanha a recorrência

- **Sufixo `(3/12)` na descrição.** No extrato, isso significa parcela. A tela
  mostra "3 de 12 · recorrente" a partir das colunas.
- **`statement_month`.** Não vai em cartão, logo não pertence a fatura nenhuma.
- **A restrição de centavo por parcela.** Recorrência não divide um total: 3
  ocorrências de R$ 0,02 são legítimas.

O que **é** reusado: `somaMesesNaData` de `credit.ts`, com o clamp de dia 31 em
fevereiro **não-cumulativo** (a 3ª ocorrência de uma série que começa em 31/01 é
31/03, não 28/03).

---

## Parcelamento fora do cartão

Passou a ser permitido (carnê, crediário, boleto). O que muda:

| | No cartão | Fora dele |
|---|---|---|
| `is_paid` / `paid_cents` | Pago, cheio | **Não pago**, zero |
| Onde a dívida aparece | `debt_cents` (saldo da conta) | Soma de pendentes, via `serie_tipo` |

No cartão o banco adiantou o dinheiro. Fora dele o dinheiro **ainda não saiu da
conta** — marcar como pago derrubaria o saldo pelo total no dia da compra, e ele
deixaria de bater com o extrato do banco por doze meses.

A dívida não some por isso: `serie_tipo = 'parcelamento'` manda as parcelas
futuras para a **Dívida**, não para os Compromissos.

---

## Editar uma ocorrência de série

Três alcances, padrão **"só esta"** (o único sem efeito colateral):

| Escolha | Efeito |
|---|---|
| **Só esta** | Nada se propaga |
| **Esta e as futuras** | `installment_no >= n` |
| **Todas** | ⚠️ Inclui mês **já fechado** — a interface diz quantos são |

**Nunca se propagam:** `occurred_on` e `paid_cents`. São o que distingue uma
ocorrência da outra.

**A descrição só se propaga em recorrência.** Em parcelamento ela carrega o
sufixo `(3/12)` gravado por linha; escrever a mesma string em todas renomearia a
7ª parcela para "Geladeira (3/12)". Reconstruir o sufixo linha a linha seriam N
escritas sem transação, e o ganho não paga o risco de deixar metade renomeada.

## Encerrar

**"Encerrar" só existe em recorrência.** Apaga as ocorrências a partir desta que
ainda não foram pagas — você saiu do imóvel, os nove aluguéis seguintes não
acontecem.

⚠️ **Nunca em parcelamento.** Apagar parcelas futuras apagaria dívida que
continua existindo: o banco vai cobrar de qualquer jeito, e o sistema passaria a
mostrar que se deve menos do que se deve. Quem quiser apagar um parcelamento usa
`deleteTransaction`, que apaga o **grupo inteiro** e avisa disso.
