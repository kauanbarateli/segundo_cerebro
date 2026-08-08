# Datas e fuso horário

`src/lib/tempo.ts` é a autoridade. Este documento existe porque o defeito que
ele corrige é o tipo que **volta** — ele é fácil de reintroduzir e difícil de
notar.

## A regra, em uma frase

O fuso do produto é `America/Sao_Paulo` (`FUSO_DO_APP`), e ele governa a
**entrada** e a **exibição**. Nunca o fuso do servidor, nunca o do navegador.

## O defeito, e por que ele escapou de tudo

Um `<input type="datetime-local">` devolve uma string **ingênua** —
`"2026-08-07T14:00"`, sem fuso. Ela não é um instante: é um horário de parede, e
só vira instante quando alguém decide *em qual fuso*. A versão anterior deixava
essa decisão para o `new Date()`, que responde de dois jeitos diferentes
conforme o formato:

```js
new Date("2026-08-07T14:00")  // horário LOCAL de quem está executando
new Date("2026-08-07")        // meia-noite UTC — a forma só-data é OUTRA regra
```

Daí saíam dois defeitos somados:

1. **Só-data voltava um dia.** `"2026-08-07"` virava `2026-08-07T00:00:00Z`, que
   em São Paulo é 06/08 às 21h. A tarefa marcada como "Dia inteiro" no dia 7
   aparecia no dia 6.

2. **Todo horário deslocava em produção.** "Quem está executando" é o
   **servidor** — a validação roda na server action. Em desenvolvimento o
   servidor é a máquina do desenvolvedor (São Paulo) e o ida-e-volta fecha,
   **escondendo o defeito**. Na Vercel o servidor é UTC: 14:00 digitado virava
   14:00Z, e a tela — que sempre formatou fixada em São Paulo — mostrava 11:00.
   Três horas de diferença em toda tarefa com hora.

⚠️ **É por isso que nenhum teste local pegava.** Em máquina de desenvolvimento os
dois fusos coincidem. A suíte de `tempo.test.ts` passa idêntica em São Paulo,
UTC e Tóquio — rodar com `TZ=UTC` é o que reproduz a Vercel.

## Duas outras armadilhas, do navegador

3. **`<input type="date">` só aceita 10 caracteres.** Recebendo
   `"2026-08-07T14:00"` ele **descarta** o valor e o campo aparece vazio — mesmo
   havendo data salva. Por isso `paraCampoLocal(iso, formato)` recebe o formato:
   a incompatibilidade que antes era um campo misteriosamente vazio passou a ser
   um argumento no código.

4. **Trocar o `type` apaga o valor.** Alternar "Dia inteiro" muda o `type` do
   mesmo nó do DOM; o navegador revalida, descarta o que virou incompatível, e
   `defaultValue` não repõe — ele só age na montagem. A correção é guardar dia e
   hora em **estados separados**, e aí a troca deixa de ser perda.

## O que NÃO fazer

- ❌ `new Date(stringIngênua)` em qualquer lugar. Use `instanteDe()`.
- ❌ `getTimezoneOffset()` do navegador para converter. Ele muda ao viajar, e a
  mesma tarefa mudaria de horário dentro do avião.
- ❌ Aritmética de data com `Date` sobre componentes locais. `credit.ts` já
  documenta e evita isso; `tempo.ts` faz o mesmo, com `Intl` para *perguntar* o
  deslocamento em vez de adivinhá-lo — o horário de verão histórico do Brasil
  erraria uma hora com `-3` fixo.

## `profiles.timezone`

Existe no banco (`0001:109`) com o mesmo valor por padrão, e **não é lido**. Não
é esquecimento: passar a respeitá-lo exige decidir o que fazer com o dado já
gravado sob a regra fixa, e isso é mudança de produto, não correção de defeito.
Quando essa hora chegar, o ponto de troca é uma constante só — `FUSO_DO_APP`.
