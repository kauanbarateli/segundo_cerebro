# Cores do Financeiro — a paleta categórica e o desvio do DS

`src/lib/finance-colors.ts` é o tradutor. Os valores moram em `globals.css`
(bloco "CATEGÓRICAS"), e as classes chegam pelo `tailwind.config.ts`.

## A coluna já existia, e estava sem uso

`finance_categories.color_key`, `finance_tags.color_key` e
**`finance_accounts.color_key`** existem desde a `0005`, todas `not null default
'stone'`. **Nenhuma migration foi necessária** — o que faltava era o tradutor de
chave para classe e uma tela para escolher.

> Registrando porque é fácil concluir o contrário: `finance_accounts` **tem** a
> coluna. Ela está na `0005:33`, junto das outras duas, e `upsertAccount` já a
> gravava — com `'stone'` fixo, porque não havia seletor.

## Contraste medido, não afirmado

Oito tons, contraste contra o **pior** dos quatro fundos de cada tema (`surface`,
`canvas`, `surface-muted`, `surface-hover`). Piso de **3:1** — WCAG 1.4.11,
objeto gráfico não-textual:

| chave | claro | escuro |
|---|---:|---:|
| stone | 4.63 | 5.62 |
| indigo | 5.51 | 6.23 |
| ciano | 4.25 | 6.67 |
| teal | 3.62 | 7.03 |
| oliva | 4.30 | 7.87 |
| terracota | 5.02 | 6.05 |
| rosa | 4.75 | 5.95 |
| violeta | 4.99 | 5.82 |

⚠️ **Entre si** o pior par tem **1.01** de contraste de luminância: terracota e
violeta separam-se por *matiz*, não por claro/escuro. Duas fatias vizinhas
encostadas virariam um borrão único em escala de cinza. Por isso a rosca desenha
um **vão da cor da superfície** entre os arcos — a separação é geométrica, e
funciona sem enxergar cor nenhuma.

## Duas exclusões deliberadas

O vermelho de `danger` e o âmbar de `warning` **não entram na paleta**. Uma fatia
com a cor exata do alerta faria a categoria "Mercado" parecer um problema. É a
mesma regra que `calendar-colors.ts` já aplicava às contas do calendário.

## A cor nunca vem sozinha

Toda legenda traz **nome, valor e percentual em texto**. A cor distingue mais
rápido; ela não é o dado. Quem não separa terracota de violeta continua lendo
"Mercado — R$ 812,40 — 31%".

## ⚠️ As classes são LITERAIS

O Tailwind varre o código procurando nomes de classe **inteiros**.
`bg-cat-${chave}` montado em tempo de execução não é encontrado, a regra não entra
no CSS final, e a cor some — sem erro, sem aviso, e **só na build de produção**.

Por isso `TONS` em `finance-colors.ts` escreve cada classe por extenso, e por isso
a paleta é fechada: acrescentar uma cor exige uma linha lá, e essa linha é a que o
Tailwind lê.

## Cor derivada quando ninguém escolheu

O default de todo mundo é `'stone'`, então um gráfico recém-aberto teria oito
fatias cinzas. `corDaPosicao()` distribui uma cor por posição na lista (já
ordenada por valor), com `stone` fora do rodízio para continuar significando "sem
cor escolhida".

⚠️ A cor derivada é estável **dentro** de um gráfico e **não entre** gráficos: a
mesma categoria pode aparecer índigo num mês e ciano no outro, porque a ordem por
valor muda. É o preço de não inventar cor no banco — e o motivo de a legenda com
nome ficar sempre ao lado. Quem quiser cor fixa escolhe uma, e `corDaPosicao` sai
do caminho.

---

## ⚠️ O desvio consciente do Design System

**Um só, e está registrado aqui:** o disco colorido atrás da inicial nos cards de
conta (`DiscoDaConta` em `FinanceView.tsx`).

| Uso | É desvio? | Por quê |
|---|---|---|
| Fatia da rosca por categoria | ❌ Não | Cor **é dado**: identifica a categoria. DS §3 reserva os 10% para exatamente isso |
| Ponto de etiqueta | ❌ Não | Idem |
| Entradas × saídas no histórico | ❌ Não | `success`/`danger`, semânticas já definidas |
| **Disco da conta** | ✅ **Sim** | Cor como **identidade visual** — o DS não prevê |

O disco existe para o olho achar "o Nubank" numa pilha de oito retângulos sem ler
título nenhum. Isso é identidade, não dado.

**E por isso ele é contido:** 32px atrás da inicial, com fundo a 15% de opacidade
e moldura na cor cheia — **nunca o card inteiro pintado**. Oito cards preenchidos
viram um mostruário em que nenhum se destaca, o oposto do problema que a cor veio
resolver.

A inicial dentro do disco não é enfeite: é o que sobra para quem não distingue as
cores, e é a razão de o disco poder existir sem quebrar a regra de que cor nunca
informa sozinha.

> O fundo é tingido a 15% por acessibilidade, não por estética: texto branco sobre
> o tom cheio dá 3.62:1 no pior caso do tema claro (abaixo dos 4.5:1 de AA), e no
> tema escuro — onde os tons são claros — seria ilegível (1.6:1). Com o
> tingimento, o texto usa `text-ink` normal.
