# Design System 1.0 — como ele existe NESTE código

O documento de origem é `docs/design-system.html` (a apresentação) e `docs/tokens.css`
(os valores). **Este arquivo é a tradução deles para as decisões deste repositório**, e é
ele que vale na hora de escrever componente novo. Onde os dois divergem, o motivo do
desvio está registrado aqui e no comentário do arquivo que o implementa.

Regra geral: **o porquê mora no código, ao lado da decisão.** Este documento é o índice,
não a fonte. Se uma seção aqui contradiz um comentário em `globals.css` ou
`tailwind.config.ts`, o comentário é que está mais perto da verdade — e um dos dois
precisa ser corrigido na hora.

---

## 1. Onde cada coisa mora

| O quê | Arquivo |
|---|---|
| Tokens de cor, sombra, foco, alvo de toque | `src/app/globals.css` |
| Escala tipográfica, raio, movimento, altura de controle | `tailwind.config.ts` |
| Botão, cartão, chip, modal, toast, menu, estado vazio | `src/components/ui/` |
| Campo de formulário (a string compartilhada) | `src/components/ui/estilos.ts` |
| Marca | `src/components/ui/Logotipo.tsx` · `public/brand/` · `src/app/icon.svg` |
| Cor de categoria do calendário | `src/lib/calendar-colors.ts` |

---

## 2. Cor

### 2.1 Vocabulário: `--sb-*`, não `--sc-*`

O DS usa o prefixo `--sc-`. Este projeto mantém `--sb-`, que já aparece em ~350 pontos.
Renomear seria churn puro, com risco de erro de digitação silencioso e zero ganho visual.

**A tabela de equivalência completa está no topo de `globals.css`.** Ela é o contrato entre
os dois vocabulários e precisa ser atualizada junto com qualquer token novo.

Uma linha dela merece destaque porque é contraintuitiva:

```
--sb-line         ↔  --sc-line-SOFT     (a borda comum)
--sb-line-strong  ↔  --sc-line          (a borda do cartão em destaque)
```

O mapeamento é **cruzado de propósito**. Casar pelo nome inverteria a hierarquia de bordas
em 122 pontos de uso: o cartão comum ficaria com a moldura mais pesada e o destaque com a
mais leve. Casar pelo **papel** preserva o que já está na tela.

### 2.2 As semânticas têm DOIS degraus

O DS entrega um hex por semântica. Medido, esse hex serve como ponto ou barra, mas reprova
em AA como **texto** no tema claro. Por isso cada semântica tem dois tokens:

| Token | Papel |
|---|---|
| `success` `danger` `warning` `info` `work` `personal` | preenchimento: ponto, barra, moldura, fundo de chip |
| `*-ink` (`danger-ink`, `work-ink`, …) | **texto** e ícone que carrega significado |

**Usar o errado é regressão de acessibilidade silenciosa** — nada quebra, o texto só fica
ilegível para quem mais precisa dele. Na dúvida: se é letra, é `-ink`.

No tema escuro os dois degraus coincidem, porque o valor já clareado passa nos dois papéis.

### 2.3 Regra 90/10

~90% da interface é neutra. A cor entra nos 10% que **carregam informação**. Antes de pintar
qualquer coisa, a pergunta é: *esta cor diz algo que o texto ao lado não diz?* Se não, ela é
neutra.

Corolário do DS §9, que este projeto trata como inegociável: **cor nunca é a única
informação**. Entrada e saída no Financeiro têm o sinal `+`/`−` e o disco com o glifo; a
variação percentual tem `▲`/`▼`; o limite estourado tem moldura além da cor; a categoria do
calendário tem sempre o rótulo textual junto.

### 2.4 ⚠️ Desvio consciente: `ink-subtle`

O DS entrega `#92928C` (claro) e `#85857F` (escuro) para o terceiro degrau de texto. **Este
projeto usa `#6C6C66` e `#898983`.**

Motivo: os valores do DS dão 2.86 e 4.29 contra o pior fundo do seu tema — os dois abaixo de
AA. E neste código o degrau pinta ~190 pedaços de texto real (data, contador, rótulo de
campo, texto de ajuda), não enfeite. A alternativa seria promover os 190 usos para
`ink-muted`, o que colapsaria a hierarquia de três níveis em dois.

Os valores escolhidos são o extremo da rampa que ainda passa em 4.5:1, preservando o neutro
quente do DS. O desvio existe para **cumprir** a §9 do próprio documento, que exige AA para
texto — é o DS resolvendo uma contradição entre a sua §3 e a sua §9.

### 2.5 ⚠️ Ao medir contraste, inclua o `surface-hover`

Ele é o fundo mais escuro do tema claro (`#F0F0ED`) e o mais claro do escuro (`#222221`), e
é fundo de **texto de verdade**: item de navegação e item de menu passam por ele a cada
hover. Medir só contra `surface` e `canvas` dá números 0,2–0,3 melhores que a realidade — o
suficiente para aprovar um par que reprova na tela.

Todo par texto/fundo do sistema foi medido contra os **quatro** fundos de cada tema. Os
números estão no comentário de `globals.css` e devem ser refeitos a cada mudança de token.

---

## 3. Tipografia — a regra que sustenta a escala

### 3.1 A escala

| Classe | Tamanho / entrelinha | Papel |
|---|---|---|
| `text-micro` | 10 / 14 | **exceção documentada** — ver 3.3 |
| `text-meta` | 12 / 16 | Eyebrow: rótulo curto, categoria, sobrescrito |
| `text-legenda` | 14 / 20 | **Small** — o que se CONSULTA |
| `text-corpo` | 16 / 24 | **Body** — o que se LÊ |
| `text-corpo-forte` | 20 / 29 | Body L: título de cartão, subtítulo de página |
| `text-titulo` | 24 / 30 | H3: título de seção, valor de estatística |
| `text-h2` | 32 / 35 | H2: número grande, título de seção maior |
| `text-display` | clamp(52→80) / 0.96 | Display editorial do cabeçalho de página |

**Não existe degrau solto.** `text-sm`, `text-lg`, `text-xl`, `text-2xl` e `text-3xl` foram
eliminados do código; a escala padrão do Tailwind continua registrada (usamos
`theme.extend.fontSize`, nunca `theme.fontSize`) mas não se usa.

### 3.2 `corpo` vs. `legenda` — a decisão que se repete todo dia

Esta é a regra mais consultada deste documento, e a que impede a fragmentação de voltar.

> **`text-corpo` (16px) — o que a pessoa LÊ.**
> Descrição de cartão, rótulo de formulário, texto digitado num campo, texto de botão
> médio ou grande, mensagem de estado vazio, parágrafo de ajuda, item de menu, **título de
> uma linha de lista**.
>
> **`text-legenda` (14px) — o que a pessoa CONSULTA.**
> Célula de tabela, data, contador, chip, valor monetário em lista, metadado de linha, texto
> de apoio sob um campo, mensagem de erro de campo, rótulo de estatística, item de
> navegação, botão pequeno.

Três consequências que já foram decididas e não precisam ser rediscutidas:

1. **Linha de lista tem dois níveis:** o título em 16px, todo o resto da linha em 14px.
   É o que produz a hierarquia dentro da linha sem precisar de peso nem de cor.
2. **Tabela é dado, inteira.** Mesmo a coluna de título de uma `<table>` fica em 14px. Uma
   tabela é uma grade de consulta, e a mesma tarefa aparece em 16px na lista mobile — não é
   incoerência, são componentes diferentes com restrições diferentes.
3. **Campo de formulário é 16px**, sempre. Além de ser o Body do DS, é o piso abaixo do qual
   o Safari do iOS dá zoom ao focar — e o zoom não volta sozinho.

A regra vale por **padrão de componente**, não por arquivo. Ao escrever um componente novo,
a pergunta é "que tipo de coisa é isto", não "que tamanho o vizinho usou".

### 3.3 ⚠️ Exceção: `text-micro` (10px)

O DS não tem degrau abaixo de 12px. O `text-micro` sobrevive porque o mapa de calor de
Hábitos põe 13 rótulos de semana lado a lado sobre uma grade de 7 linhas, e em 12px a grade
estoura. São ~7 usos, todos em rótulo de eixo de gráfico, e nenhum é texto lido em
sequência.

**Não é licença para texto pequeno.** Fora de rótulo de eixo, o menor degrau é `text-meta`.

---

## 4. Forma

| Classe | Valor | Uso |
|---|---|---|
| `rounded-xs` | 4px | micro-superfície: caixa de seleção, `<kbd>`, realce de busca |
| `rounded-sm` | 8px | distintivo, bloco embutido |
| `rounded-md` | 12px | **controle**: campo, botão, menu, chip retangular |
| `rounded-lg` | 18px | **cartão** (chega a todos por `ui/Card.tsx`) |
| `rounded-xl` | 24px | **modal** e superfície grande |
| `rounded-full` | 999px | chip, pill, avatar |

`rounded-xs` não vem do DS: o menor degrau de lá é 8px, pensado para distintivo e botão.
Abaixo de ~20px de lado, 8px consome metade da forma — a mesma classe de exceção do
`text-micro`.

**Exceção que continua fora da escala:** o mapa de calor usa `rounded-[2px]` em células de
14–18px. Ali o quadrado é a linguagem visual da grade (é gráfico, não superfície), e
arredondar mais embaça a leitura das colunas.

---

## 5. Elevação e movimento

**Duas sombras, quatro níveis.** `shadow-subtle` é o cartão pousado na página;
`shadow-raised` é o que flutua sobre ela. Os valores moram em variável CSS porque **cada
tema tem a sua sombra** — uma sombra preta sobre o fundo `#0d0d0d` do escuro é invisível, e
o cartão perdia o nível de elevação.

**Duas durações e uma curva:**

- `120ms` — o que responde ao ponteiro: hover, menu ancorado no gatilho.
- `180ms` — o que troca uma superfície: modal, véu, toast, item de lista.
- `cubic-bezier(.2,.75,.25,1)` em tudo.

Os dois `DEFAULT` de `transitionDuration` e `transitionTimingFunction` foram repontados no
config, então as ~90 transições de hover do projeto seguem o DS sem tocar em componente
nenhum.

### ⚠️ O piso de acessibilidade não se enfraquece

O `@media (prefers-reduced-motion: reduce)` de `globals.css` é o que faz TODA a camada de
movimento respeitar quem pediu menos animação. Duas regras derivam dele e continuam
valendo:

- **`animation-delay` é proibido.** O `@media` não zera atraso: quem pediu menos movimento
  receberia um piscar. É a razão de não haver entrada escalonada de lista.
- **Animação por JavaScript é proibida.** Movimento em JS não passa nem perto do `@media`.

O estado `pressed` dos botões usa `active:scale-[0.98]` com `motion-reduce:active:scale-100`
— o `@media` zeraria a duração, mas a variante remove também a transformação, que é o que
importa para quem tem sensibilidade vestibular.

---

## 6. Componentes

### Botão — 40 / 44 / 52

`sm` 40px, `md` 44px (padrão), `lg` 52px. O `sm` recebe `alvo-44`, que estende a área
tocável sem crescer o desenho.

`disabled` usa os tokens `disabled` / `disabled-bg`, **nunca `opacity-50`** — a opacidade
arrastava a borda junto e dava resultados diferentes sobre fundos diferentes.

**Vermelho:** a variante `danger` é moldura neutra com texto `danger-ink`. Fundo vermelho
cheio (`danger-solid`) existe em **um único lugar**: o botão de confirmar do
`ConfirmationDialog` quando a ação é destrutiva. É a regra do DS §7, literal.

### Campo — 52px, e a string compartilhada

`CLASSE_DO_CAMPO`, `CLASSE_DO_CAMPO_MULTILINHA` e `CLASSE_DO_CAMPO_DE_BUSCA` em
`ui/estilos.ts`. Os ~44 campos do produto passaram a sair delas.

⚠️ **`estilos.ts` não pode ganhar `import`.** O arquivo é consumido por Componente de
Servidor e por componente de cliente; uma dependência ali arrastaria `ThemeToggle`, `Avatar`
e `Link` para o pacote do navegador por causa de uma string. O motivo completo está no
cabeçalho do arquivo.

São strings e não componentes de propósito: um `<Campo />` teria que repassar `ref`, `type`,
`value`, `onChange`, `rows`, `pattern`, `inputMode` e mais uma dúzia de props. Compartilha-se
a aparência; o mecanismo, não.

### Chip de categoria — ponto colorido, nunca preenchimento

`Badge` e `PillButton` aceitam `ponto="work" | "personal" | …`, que desenha um disco de 8px
antes do rótulo. **O chip inteiro nunca é preenchido de cor de categoria** — num sistema em
que preto significa "ativo", um chip teal rouba a hierarquia.

O ponto é `aria-hidden`: quem carrega a informação é o rótulo textual ao lado.

### Estado vazio

Círculo de 64px, ícone de 22px, título curto, uma frase de descrição, CTA só quando existe
próxima ação clara. Sem ilustração colorida — o vazio também deve ser calmo.

---

## 7. Layout

| | Valor | Onde |
|---|---|---|
| Barra lateral | 256px até 1535px · **320px de 1536px** | `AppSidebar.tsx` |
| Barra recolhida | 64px | idem |
| Conteúdo | 1080px (`67.5rem`) | `(app)/layout.tsx` |
| Conteúdo, barra recolhida | `79.5rem` até 1535px · `83.5rem` de 1536px | idem |
| Padding horizontal | 20 / 32 / 40px (`px-5 md:px-8 lg:px-10`) | idem |
| Altura de item de nav | 52px | `AppSidebar.tsx` |
| Ícone de nav | 20px, traço 1.75 | `ui/Icons.tsx` |

### ⚠️ Desvio consciente: o corte da barra é 1536px, não 1024px

O `tokens.css` do DS troca a barra de 256 para 320px em 1024px. **Aqui o corte é `2xl`
(1536px).**

O corte de 1024px foi pensado para separar tablet de desktop. Mas a maioria dos notebooks
tem 1366 ou 1440px, e ali a barra de 320px sai direto da área de conteúdo: **104px a menos
de espaço útil (~9%)** para exibir exatamente a mesma navegação que 256px já exibe. Em
1536px ou mais o conteúdo já bate no próprio teto, e a barra maior sai de graça.

### ⚠️ A aritmética do recolhimento tem DOIS regimes

Recolher a barra só produz efeito visível se o teto do conteúdo crescer **exatamente** o
que a barra liberou. Com a barra variável, isso são duas contas:

```
até 1535px   barra 16 → 4rem, devolve 12rem   →  67.5 + 12 = 79.5rem
de 1536px    barra 20 → 4rem, devolve 16rem   →  67.5 + 16 = 83.5rem
```

Conferido nos dois, não deduzido: em 1535px o teto de 79.5rem deixa 59,5px de margem de cada
lado — a mesma do estado expandido. Com 83.5rem ali, cairia para 27,5px, e "recolher"
passaria a comer o respiro lateral em vez de devolver o que era da barra.

**Mexer no `2xl` da barra obriga a refazer as duas contas.** Os dois números são o mesmo
cálculo visto de dois lados.

---

## 8. Acessibilidade

- **Alvo mínimo 44×44px.** Onde a densidade não permite 44px visuais, use a classe
  `alvo-44` (`globals.css`): um `::before` invisível estende a área tocável sem mudar o
  desenho.
  ⚠️ **Dois controles com `alvo-44` lado a lado precisam de `gap` ≥ 12px**, senão as áreas
  se sobrepõem e o clique vai para o que estiver depois na ordem do documento — que numa
  dupla "Editar / Excluir" é a exclusão.
- **Foco:** a regra global `:focus-visible` já implementa os dois sinais do DS (contorno
  `ink` de 2px + anel de 3px a 10%). **Não repita `focus-visible:*` em componente** — seria
  uma segunda definição livre para divergir da primeira.
- **Estados:** todo controle interativo tem `default`, `hover`, `pressed`, `focus-visible`,
  `disabled` e, quando aplicável, `loading`.
- **Contraste:** AA em ambos os temas, medido contra os quatro fundos (ver 2.5).
- **Ícone sem rótulo** precisa de `aria-label`.
- **Status nunca só por cor.**

`disabled` fica abaixo de AA de propósito (2.57): a WCAG 1.4.3 isenta controle inativo, e é
a baixa legibilidade que comunica "isto não responde". O que não pode faltar é o atributo
`disabled` real, que é o que o leitor de tela anuncia.

---

## 9. Marca

Um símbolo: o **"2" contínuo com dois pontos de conexão** — captura → conexão →
recuperação.

- `Logotipo` (`ui/Logotipo.tsx`) com três variantes: `simbolo`, `horizontal`, `compacta`.
- Mínimos: **símbolo 24px**, **lockup 136px** de largura. Área de proteção: ¼ da largura do
  símbolo em todos os lados.
- Proibido inclinar, contornar, aplicar gradiente ou recolorir com cor semântica.

**Um arquivo, dois temas.** O SVG é inline e as duas cores saem de token: o quadrado é
`currentColor` (herda `text-ink`) e o traço é `rgb(var(--sb-accent-ink))`. O resultado é
exatamente o arquivo normal no claro e exatamente o inverso no escuro, sem alternar imagem
por CSS — que não funcionaria, porque o modo escuro deste projeto é uma **classe** no
`<html>` e um `<img>` não a enxerga.

A palavra "Segundo Cérebro" é **texto HTML**, não `<text>` dentro do SVG: a Inter entra por
`next/font` com `display: swap`, e há uma janela real em que o SVG seria rasterizado com a
fonte substituta.

Os SVGs de origem ficam em `public/brand/` — são o mestre da marca, para uso fora do produto.

---

## 10. Tom verbal

Títulos curtos, no imperativo ou em linguagem cotidiana. Descrições de uma ou duas linhas.
CTA com verbo claro ("Capturar", "Nova tarefa", "Desbloquear cofre"). Sem jargão corporativo
e sem explicação longa na tela.

---

## 11. Resumo dos desvios conscientes

| # | Desvio | Motivo |
|---|---|---|
| 1 | Prefixo `--sb-*` em vez de `--sc-*` | ~350 pontos de uso; renomear é churn com risco e sem ganho |
| 2 | Classe `.dark` em vez de `[data-theme="dark"]` | mudar exige reescrever `tema-init.ts` e regerar o hash da CSP, para resultado visual **idêntico** |
| 3 | `ink-subtle` = `#6C6C66` / `#898983` | os valores do DS reprovam em AA e o degrau pinta ~190 textos reais (§2.4) |
| 4 | Cada semântica tem dois degraus (`x` e `x-ink`) | o hex único do DS reprova em AA como texto no claro (§2.2) |
| 5 | Barra de 320px a partir de **1536px**, não 1024px | 104px de área útil em notebooks de 1366/1440 por navegação idêntica (§7) |
| 6 | `text-micro` de 10px sobrevive | grade do mapa de calor estoura em 12px (§3.3) |
| 7 | `rounded-xs` de 4px acrescentado | o menor degrau do DS (8px) consome metade de uma caixa de 16px (§4) |
| 8 | `rounded-[2px]` no mapa de calor | ali o quadrado é marca de gráfico, não superfície (§4) |

Os desvios 2 e 5 são de arquitetura e densidade. Os 3 e 4 existem para **cumprir** a §9 do
próprio DS. Os 6, 7 e 8 são casos em que a escala do DS começa acima do tamanho do elemento.
