# Hábitos diários

Marque o que cumpriu. **A falha é calculada, não anotada.**

---

## ⚠️ A decisão que manda em tudo: registro esparso

`habit_entries` tem **uma linha só quando o dia foi cumprido**. Não existe campo
`feito`, não existe linha por dia, e desmarcar é `DELETE`.

O desenho óbvio — uma linha por dia com `feito` verdadeiro ou falso — exige
alguém escrevendo essas linhas toda meia-noite. Ou seja: **um cron**. E a `0013`
já registrou por escrito por que este projeto não pode depender de `pg_cron`.

O modo de falha é o que condena o desenho: um cron que não roda uma noite deixa
**buraco**. O dia não fica nem feito nem falhado, a taxa muda sozinha, e ninguém
mexeu em nada. Um número que se move sem causa destrói a confiança no painel
inteiro — e o painel é a única coisa que este módulo entrega.

Com registro esparso, **o passado é imutável**: falha, taxa e sequência são
derivadas de `started_on` + a cadência + as pausas, por aritmética pura em
[habits.ts](../src/lib/habits.ts). É isso que faz *"quantas vezes falhei"* ser
um número **exato**, em vez de depender de um processo ter rodado.

---

## As três cadências

| `schedule_kind` | O que significa | Unidade da sequência |
|---|---|---|
| `daily` | Todo dia | dia elegível |
| `weekdays` | Dias fixos (`0=domingo..6=sábado`) | dia elegível |
| `weekly_target` | N vezes por semana, sem escolher os dias | **semana** |

`weekly_target` não é redundante com `weekdays`: *"correr 3× por semana"* não
falha na terça — falha no domingo à noite se não somou três.

> ⚠️ **Errar a unidade da sequência destrói o painel.** Contar dias para um
> hábito semanal diria "sequência de 1" para quem correu três vezes na semana.
> Há teste para os dois casos.

**`0=domingo` é a mesma numeração de `extract(dow)` e de
`user_preferences.week_starts_on`** — não existe tabela de conversão em lugar
nenhum, e é assim que se mantém.

---

## ⚠️ Duas regras que decidem se o painel é usado

**A sequência não zera de manhã.** Se hoje é elegível e ainda não foi marcado, a
caminhada para trás começa em *ontem*. Sem isso, quem tem 40 dias veria "0" toda
manhã até marcar — e um número que despenca sozinho todo dia não é usado por
ninguém.

**Dia não elegível é pulado, não quebra.** Um hábito de segunda/quarta/sexta
zeraria toda terça se o dia não esperado quebrasse: a sequência mediria o
calendário em vez do hábito. Pausa (férias, doença) segue a mesma regra — um
painel que pune férias é um painel que a pessoa para de olhar.

---

## Fuso horário

Coluna `date`, **nunca** `timestamptz`. E **nunca `current_date` como default no
banco**: o servidor roda em UTC, então das 21h à meia-noite `current_date` já é o
dia seguinte em São Paulo — marcar um hábito às 22h registraria amanhã.

O dia vem de `dayRangeInTimeZone()`, calculado no **servidor** e passado à tela.
O `dia` de uma marcação viaja do cliente para a action de propósito (só o
navegador sabe em que dia a pessoa está), e a action tem um teto de dois dias no
futuro como contrapartida: retroagir é gesto legítimo, marcar o ano 3000 não é.

---

## Onde cada coisa mora

```
supabase/migrations/0018_habitos.sql   3 tabelas + trigger de dono
src/lib/habits.ts                   ⭐ TODA a aritmética — puro, sem server-only
src/lib/habits.test.ts                 37 casos
src/app/(app)/habitos/
  page.tsx                             requireModule na primeira linha
  actions.ts                           Zod primeiro, whitelist de colunas
  error.tsx                            boundary PRÓPRIO — ver abaixo
src/components/features/habits/
  HabitsView.tsx                       checklist + painel + mapa
  HabitForm.tsx                        as três cadências
  MapaDeCalor.tsx                      CSS grid puro, zero biblioteca
  HabitsTodayCard.tsx                  marcação rápida no Início
```

**`habits.ts` não importa `server-only`, e essa é a razão de ele existir
separado.** É importado pela tela *e* pela rota de cron do e-mail semanal. Duas
implementações do mesmo número são a garantia de que um dia a tela diz 18, o
e-mail diz 19, e ninguém sabe qual está certo.

**O `error.tsx` próprio** existe porque o boundary compartilhado já custou caro:
o Conhecimento ficou inteiramente inacessível e a mensagem genérica não dizia
nem qual módulo tinha quebrado. Este diz, mostra o `digest` e mantém o resto
navegável.

---

## Roteiro de verificação manual

- [ ] 🔧 Aplicar a migration `0018` e rodar o **BLOCO 15** da `verificacao.sql`
- [ ] 🔧 **Abrir `/habitos` no navegador.** `tsc`, `lint` e a suíte verdes não
      são evidência de que o módulo carrega — neste projeto isso já foi provado
      uma vez
- [ ] Criar um hábito de cada cadência
- [ ] Marcar e desmarcar o mesmo dia → a sequência volta ao que era
- [ ] **Marcar às 22h e conferir no dia seguinte** que a marcação está no dia
      certo. É o teste do fuso, e o único que a suíte não faz por você
- [ ] Criar hábito `weekdays` de seg/qua/sex → conferir que **terça não quebra**
      a sequência
- [ ] Registrar uma pausa retroativa → a sequência não zera
- [ ] Desligar o módulo em Configurações → o link some da barra lateral **e o
      cartão some do Início**
- [ ] No celular: tocar em **"Mais"** → Hábitos aparece na folha

> Os dois últimos são os que a suíte não pega. O penúltimo prova que o
> interruptor não mente; o último, que o módulo é alcançável no celular — antes
> desta versão, tudo além do quinto módulo era inalcançável ali.
