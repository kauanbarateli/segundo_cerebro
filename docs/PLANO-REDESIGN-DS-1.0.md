# PLANO DE MIGRAÇÃO — Design System 1.0

Documento de planejamento. **Nenhuma alteração de código foi feita.**

- **Projeto:** `segundo-cerebro` (Next.js 15 · React 19 · Tailwind 3.4 · TypeScript)
- **Origem:** `design-system.html`, `README.md`, `tokens.css`, `logo-symbol.svg`, `logo-horizontal.svg`, `logo-horizontal-inverse.svg`, `favicon.svg`
- **Data:** 06/08/2026
- **Objetivo:** alinhar toda a camada visual (UI/UX) ao DS 1.0 sem tocar em rota, dado, autenticação ou regra de negócio.

---

## 1. Sumário executivo

O projeto **já tem** um sistema visual próprio, documentado e coerente: tokens em variáveis CSS (`src/app/globals.css`), escala tipográfica nomeada, dois níveis de sombra, cinco animações declarativas e um piso de acessibilidade em `prefers-reduced-motion`. Isso é uma vantagem enorme: **a migração é de VALORES, não de arquitetura.**

O DS 1.0 e o sistema atual descrevem a mesma linguagem (neutro quente, preto como decisão, cartões brancos, títulos editoriais). As divergências são de calibragem, e se concentram em seis pontos:

| # | Divergência | Impacto | Risco |
|---|---|---|---|
| 1 | Valores dos tokens de cor (todos com desvio de 2–6 pontos) | Global | Baixo |
| 2 | **Escala tipográfica fragmentada** — sete degraus abaixo de 22px onde o DS tem três | Global | **Alto** |
| 3 | Ausência de tokens semânticos (cor crua espalhada em 25 arquivos) | Médio | Baixo |
| 4 | Raio de cartão (14px vs. 18px) e ausência de raio de modal (24px) | Global | Baixo |
| 5 | Alturas de controle (40px vs. 52px) e alvos de toque abaixo de 44px | Médio | Médio |
| 6 | **Marca inexistente no produto** — o login usa o ícone de cadeado como logotipo | Alto (percepção) | Baixíssimo |

O item 6 é o de melhor relação esforço/retorno e pode ser executado isoladamente. O item 2 é o de maior valor de UX e o mais caro — ver §3.4 e Fase 2.

**Esforço estimado:** 9 fases, ~26–35 horas de trabalho focado, com pontos de parada seguros entre cada fase.

**Decisões pendentes: nenhuma.** As quatro questões do §4 estão resolvidas e incorporadas às fases.

---

## 2. Regra de escopo — o que NÃO se toca

Esta é a restrição que você definiu, traduzida em fronteira de arquivos:

### 🔒 Zona proibida (nenhuma linha alterada)

| Caminho | Motivo |
|---|---|
| `src/app/api/**` | Rotas de API validadas |
| `src/app/(auth)/actions.ts` | Server Actions de autenticação |
| `src/middleware.ts` | Guarda de sessão e nonce de CSP |
| `src/lib/supabase/**` | Cliente, SSR, sessão |
| `src/lib/crypto/**` | Cofre, Argon2id, recovery kit |
| `src/lib/google/**`, `src/lib/clickup/**` | Integrações |
| `src/lib/data.ts`, `src/lib/modules.ts` (campos `key`/`href`) | Registro de rotas e módulos |
| `supabase/**` | Migrations |
| Assinaturas de props que carregam dados | Contrato servidor↔cliente |

### ⚠️ Zona de atenção (alterar só o que for visual, com verificação extra)

| Caminho | Cuidado |
|---|---|
| `src/lib/csp.ts` | Contém `HASH_DO_SCRIPT_DE_TEMA`. Se `tema-init.ts` mudar **uma vírgula**, o hash precisa ser regerado ou a CSP quebra o tema em silêncio. `csp.test.ts` recalcula e falha — é a rede de proteção. |
| `src/components/theme/tema-init.ts` | Vide acima. **Recomendação: não tocar.** |
| `src/components/layout/sidebar-preferencia.tsx` | Script de pré-pintura. Alterar largura da barra mexe aqui e em `sidebar-preferencia.test.tsx`. |
| `src/lib/modules.ts` | Só o campo `icon` (visual). `key`, `href`, `core` são estrutura. |

### ✅ Zona livre

`src/app/globals.css` · `tailwind.config.ts` · `src/components/ui/**` · `src/components/layout/**` (exceto o script) · `src/components/theme/ThemeToggle.tsx` · `src/components/features/**` (só `className` e marcação) · `src/lib/calendar-colors.ts` (é mapa de classes CSS, não dado) · `public/**` (a criar)

---

## 3. Diagnóstico — divergências medidas

### 3.1 Tokens de cor · tema claro

O projeto usa canais RGB separados por espaço (`244 244 241`) para habilitar o `<alpha-value>` do Tailwind. **Isso deve ser mantido** — `tokens.css` entrega hexadecimal, e adotá-lo literalmente quebraria todo uso de opacidade (`bg-black/30`, `rgb(var(--sb-ink) / 0.07)` no realce de sintaxe, etc.).

| Token atual | Valor atual | Token DS | Valor DS | Δ |
|---|---|---|---|---|
| `--sb-canvas` | `#f4f4f1` | `--sc-canvas` | `#f5f5f2` | +1 |
| `--sb-surface` | `#ffffff` | `--sc-surface` | `#ffffff` | ✅ |
| `--sb-surface-muted` | `#f9f9f7` | `--sc-surface-subtle` | `#fafaf8` | +1 |
| — | **ausente** | `--sc-surface-hover` | `#f0f0ed` | ➕ criar |
| `--sb-ink` | `#141414` | `--sc-ink` | `#111111` | −3 |
| `--sb-ink-muted` | `#5c5c58` | `--sc-ink-secondary` | `#62625e` | +6 |
| `--sb-ink-subtle` | `#8c8c87` | `--sc-ink-muted` | `#92928c` | +6 |
| `--sb-line` | `#e2e2dd` | `--sc-line-soft` | `#ecece8` | +10 |
| `--sb-line-strong` | `#d0d0ca` | `--sc-line` | `#dcdcd6` | +12 |
| `--sb-accent-ink` | `#fafaf9` | `--sc-brand-paper` | `#f7f7f4` | −3 |
| — | **ausente** | `--sc-disabled` / `--sc-disabled-bg` | `#92928e` / `#e9e9e5` | ➕ criar |

> **Descoberta importante:** o DS tem `line` e `line-soft`; o projeto tem `line` e `line-strong`. O mapeamento correto é **cruzado**: `--sb-line` ↦ `line-soft` do DS, `--sb-line-strong` ↦ `line` do DS. Isso preserva exatamente a hierarquia de duas bordas que o projeto já usa (`Card` normal vs. `Card destaque`), sem renomear nada nos 122 pontos de uso.

### 3.2 Tokens de cor · tema escuro

| Token atual | Valor atual | Valor DS | Δ |
|---|---|---|---|
| `--sb-canvas` | `#0d0d0d` | `#0d0d0d` | ✅ |
| `--sb-surface` | `#181818` | `#151515` | −3 |
| `--sb-surface-muted` | `#1f1f1f` | `#1a1a19` | −5 |
| — | ausente | `#222221` (hover) | ➕ |
| `--sb-ink` | `#f0f0ee` | `#f5f5f2` | +5 |
| `--sb-ink-muted` | `#a8a8a3` | `#b8b8b2` | +16 |
| `--sb-ink-subtle` | `#767672` | `#85857f` | +15 |
| `--sb-line` | `#2a2a2a` | `#262624` (soft) | −4 |
| `--sb-line-strong` | `#3c3c3c` | `#343431` | −8 |

O DS escuro é **mais legível** que o atual: texto secundário sobe 16 pontos de luminância. É ganho real de contraste, não gosto.

### 3.3 Cores semânticas — o maior buraco

O DS define seis: `success #188564`, `danger #E5484D`, `warning #A96918`, `info #3F6FD8`, `work #20B8A5`, `personal #8B5CF6`.

O projeto **não tem nenhuma tokenizada.** Levantamento: **56 ocorrências de paleta crua do Tailwind em 25 arquivos.**

Concentração:

```
src/components/features/finance/FinanceView.tsx      16
src/lib/calendar-colors.ts                            6
src/components/features/drive/DriveView.tsx           5
src/components/features/knowledge/KnowledgeSidebar.tsx 3
(+ 21 arquivos com 1–2 cada)
```

Boa notícia: as escolhas atuais já quase batem com o DS.

| Uso atual | Hex | DS | Hex DS | Ação |
|---|---|---|---|---|
| `violet-500` (conta 2 do calendário) | `#8b5cf6` | `personal` | `#8b5cf6` | **idêntico** |
| `teal-500` (conta 1) | `#14b8a6` | `work` | `#20b8a5` | ajuste imperceptível |
| `red-600` / `red-400` | `#dc2626` | `danger` | `#e5484d` | mais suave, correto |
| `amber-*` | — | `warning` | `#a96918` | mais sóbrio |

> **Lacuna do DS a resolver na Fase 7:** `tokens.css` não define variantes escuras para as seis semânticas. `#A96918` (warning) sobre `#0d0d0d` fica abaixo de WCAG AA. Precisamos **derivar e documentar** um degrau escuro para cada uma, com verificação de contraste — é a única extensão ao DS que este plano propõe.

### 3.4 Tipografia — o ponto crítico

#### O problema não é o tamanho, é a quantidade de degraus

Distribuição real medida no código:

| Degrau | Tamanho | Usos |
|---|---:|---:|
| `text-corpo` | 13px | **195** |
| `text-legenda` | 12px | **146** |
| `text-sm` (padrão do Tailwind, **fora da escala nomeada**) | 14px | **98** |
| `text-meta` | 11px | 28 |
| `text-corpo-forte` | 15px | 21 |
| `text-micro` | 10px | 7 |
| `text-titulo` | 22px | 1 |

**O produto tem sete tamanhos abaixo de 22px. O DS tem três** (Body 16, Small 14, Eyebrow 12).

O `text-sm` é o sintoma mais claro: 98 usos de 14px convivendo com `text-corpo` (13px) e `text-legenda` (12px) sem que nada distinga os três papéis. Um pixel de diferença não comunica hierarquia — comunica decisões tomadas em momentos diferentes. O próprio `tailwind.config.ts` registra a deriva ao dizer que o projeto "ainda usa `text-sm`, `text-lg` e `text-xl` em várias telas".

**O ganho de UX está na consolidação, não no aumento de 3px.** Sete degraus virando três é o que faz a interface parecer um sistema; aumentar tudo em 23% mantendo sete degraus produziria uma interface maior e igualmente incoerente.

#### Correspondência com o DS

| Estilo DS | DS | Equivalente atual | Atual | Δ |
|---|---|---|---|---|
| Display | `clamp(52–80px)` / 0.96 / −0.055em | `text-4xl sm:text-5xl` | 36→48px | **−32px** |
| H2 | 32px / 1.08 | *não existe* | — | ➕ |
| H3 | 20–24px / 1.2 | `text-titulo` | 22px | ✅ |
| Body L | 20px / 1.45 | `text-corpo-forte` | 15px | **−5px** |
| Body | 16px / 1.5 | `text-corpo` | **13px** | **−3px** |
| Small | 14px / 1.4 | `text-legenda` + `text-sm` | 12 / 14px | fundir |
| Eyebrow | 12px / 600 / +0.16em | `text-meta` + `.eyebrow` | 11px / 500 / +0.14em | −1px |

#### O papel duplo do `text-corpo` — onde está o trabalho real

O DS §4 separa dois papéis que hoje estão fundidos num único degrau:

- **Body 16px** — "conteúdo e controles"
- **Small 14px** — "metadata"

Os 195 usos de `text-corpo` cobrem **os dois**. Título de cartão e carimbo de data usam o mesmo 13px. Portanto a Fase 2 não é trocar um número no config: é **triar 195 pontos de uso** entre Body e Small.

A diferença de resultado é grande:

| | Triagem correta | Troca cega 13→16 |
|---|---|---|
| Descrição de cartão, rótulo de formulário, botão | 16px (+23%) | 16px |
| Célula de tabela, data, contador, chip | **14px (+8%)** | 16px (+23%) |
| Refluxo nas telas densas | contido | severo |

#### As três superfícies que limitam a densidade

| Tela | Restrição no código |
|---|---|
| Tabela de Tarefas | `TasksView.tsx:349` — já rola na horizontal em 768px, com 13px |
| Semana do Calendário | `CalendarViews.tsx:415` — `min-w-[760px]` para 7 colunas (~108px/coluna) |
| Mapa de calor de Hábitos | `MapaDeCalor.tsx` — 13 semanas × 7 dias, rótulos em `text-micro` (10px) |

Na semana do calendário, um título de evento em 13px cabe ~12 caracteres por coluna; em 16px, ~9. O `min-w-[760px]` precisará subir para ~900px. Nada quebra — o `overflow-x-auto` já existe e os comentários explicam que ele é rede de segurança —, mas a rolagem horizontal passa a aparecer em mais larguras.

O `text-micro` de 10px **não tem equivalente no DS** (o menor é 12px). Mantido como exceção documentada: 12px em 13 colunas de rótulo de mês estoura a grade do mapa de calor.

> O `tailwind.config.ts` documenta que a escala atual foi calibrada para **não** ser um redesenho disfarçado. Adotar o DS aqui é, explicitamente, um redesenho — e o comentário precisa ser reescrito na mesma fase.

### 3.5 Forma (raio)

| Elemento | DS | Atual | Ação |
|---|---|---|---|
| Input / controle | 12px | `rounded-md` = 12px | ✅ |
| Cartão | **18px** | `rounded-lg` = 14px | 14 → 18 |
| Modal | **24px** | *não existe* | ➕ `rounded-xl` |
| Chip / pill | 999px | `rounded-full` | ✅ |
| Pequeno | 8px | `rounded-sm` = 8px | ✅ |

Sorte estrutural: **`Card.tsx` usa `rounded-lg`.** Mudar um número no `tailwind.config.ts` corrige todos os cartões que passam pelo componente de uma vez. Uso: `rounded-md` 122× · `rounded-sm` 64× · `rounded-full` 59× · `rounded-lg` 7× · arbitrário `rounded-[…]` 7×.

### 3.6 Elevação

| | DS | Atual |
|---|---|---|
| Cartão | `0 1px 2px rgba(17,17,17,.04), 0 10px 28px -22px rgba(17,17,17,.34)` | `0 1px 2px rgb(0 0 0/.04), 0 1px 3px rgb(0 0 0/.03)` |
| Flutuante | `0 12px 32px -18px rgba(17,17,17,.34)` | `0 4px 16px rgb(0 0 0/.06)` |
| Escuro | valores próprios | **não muda com o tema** ⚠️ |

O DS traz sombras *maiores e mais difusas* (spread negativo). E, crucialmente, define sombras próprias para o escuro — hoje a mesma sombra preta é aplicada sobre fundo `#0d0d0d`, onde ela é literalmente invisível.

### 3.7 Movimento

| | DS | Atual |
|---|---|---|
| Hover | 120ms | 120ms (popover) ✅ |
| Superfície | 180ms | 140 / 180 / 200 (misto) |
| Easing | `cubic-bezier(.2,.75,.25,1)` | `ease-out` + `cubic-bezier(.16,1,.3,1)` |
| Reduced motion | obrigatório | ✅ **já implementado e blindado** |

O piso de acessibilidade de `globals.css` (linhas 71–100) é melhor do que o DS exige e **não pode ser enfraquecido**. A regra do projeto de proibir `animation-delay` e animação por JavaScript deve continuar valendo — ela é o que faz o `@media` funcionar sem exceções.

### 3.8 Layout

| | DS | Atual | Arquivo |
|---|---|---|---|
| Sidebar desktop | **320px** | `w-64` = 256px | `AppSidebar.tsx:109` |
| Sidebar tablet (≤1024) | 256px | — | ➕ |
| Sidebar recolhida | — | `w-16` = 64px | mantém |
| Conteúdo máx. | **1080px** | `max-w-6xl` = 1152px | `(app)/layout.tsx:116` |
| Conteúdo recolhido | — | `max-w-[84rem]` | recalcular |
| Padding horizontal | **32–40px** | `px-5` = 20px | `(app)/layout.tsx:116` |
| Altura de item de nav | **52px** | ~40px | `AppSidebar.tsx:197` |
| Ícone de nav | 20–22px / stroke 1.75 | 18px / stroke 1.6 | `Icons.tsx:11` |

> **Aritmética que precisa fechar:** o comentário em `(app)/layout.tsx:99-113` explica que `84rem = 72 + 12` porque recolher a barra devolve 12rem (16→4). Com a barra em 20rem, ela passa a devolver **16rem**, então o par correto vira **`67.5rem` normal / `83.5rem` recolhida**. Se esse comentário não for atualizado junto, ele passa a mentir.

### 3.9 Marca — inexistente no produto

| Onde | Hoje | DS |
|---|---|---|
| Login | `Icon.Vault` (um **cadeado**) dentro de um quadrado | Lockup horizontal |
| Sidebar | Avatar do usuário no lugar da marca | Símbolo |
| Favicon | padrão do Next.js | `favicon.svg` |
| `public/` | **a pasta não existe** | — |
| `themeColor` | `#f4f4f1` | `#f5f5f2` |

**Nenhum dos quatro SVGs enviados está no projeto.** Um usuário não consegue distinguir este produto de qualquer outro app Next.js pela aba do navegador. É o item de maior retorno percebido e menor risco técnico do plano inteiro.

### 3.10 Acessibilidade — achados

| Achado | Onde | Severidade |
|---|---|---|
| Botão de sair com **32×32px** (DS exige 44×44) | `AppSidebar.tsx:314` | Alta |
| `Button size="sm"` = **h-8** (32px) | `Button.tsx:22` + usos | Alta |
| Foco: `outline 2px ink/55%` vs. DS `borda ink + ring 3px a 10%` | `globals.css:50` | Média |
| Sem token de `disabled` (usa `opacity-50`, que arrasta a borda junto) | `Button.tsx` | Média |
| Semânticas escuras não verificadas para AA | Fase 7 | Média |
| Display não reduzido no mobile (DS pede 44–52px) | `PageHeader.tsx:76` | Baixa |

---

## 4. Decisões — todas resolvidas

### ✅ Decisão 1 — Escala tipográfica · **DECIDIDO: consolidação com triagem**

**Adotar a separação Body 16 / Small 14 do próprio DS, triando os 195 usos de `text-corpo` entre os dois papéis.**

Isso não é desvio do DS — é o DS aplicado corretamente. O que diverge hoje é usar 13px para conteúdo *e* para metadata (§3.4).

Mapeamento aprovado:

| Degrau atual | Vira | Papel no DS | Observação |
|---|---|---|---|
| `text-corpo` (13px, 195 usos) | **16px** *ou* **14px** | Body *ou* Small | ⚠️ **Triagem caso a caso** |
| `text-legenda` (12px, 146 usos) | **14px** | Small | funde com `text-sm` |
| `text-sm` (14px, 98 usos) | **14px** | Small | sai do uso solto, entra na escala nomeada |
| `text-meta` (11px, 28 usos) | **12px** | Eyebrow | peso 500→600, tracking 0.14→0.16em |
| `text-corpo-forte` (15px, 21 usos) | **20px** | Body L | senão deixa de se distinguir do corpo |
| `text-titulo` (22px, 1 uso) | **24px** | H3 | |
| `text-micro` (10px, 7 usos) | **10px** | — | **exceção documentada** (mapa de calor) |

Critério de triagem — `text-corpo` vira **Body 16px** quando é conteúdo que a pessoa *lê* (descrição de cartão, rótulo de formulário, texto de botão, mensagem de estado vazio); vira **Small 14px** quando é dado que a pessoa *consulta* (célula de tabela, data, contador, chip, metadado de linha).

**Descartadas:** as opções "intermediária 15px" e "congelar 13px" das versões anteriores deste plano. Ambas partiam do enquadramento errado — tratavam a decisão como um número único, quando o problema é a quantidade de degraus.

### ✅ Decisão 2 — Sidebar · **DECIDIDO: 320px a partir de 1536px**

**Adotar os 320px do DS, mas com o corte em `2xl` (1536px) em vez dos 1024px do `tokens.css`.**

A largura da barra só custa alguma coisa quando `viewport − barra < teto do conteúdo`. Acima disso o conteúdo já está no teto e centralizado.

| Tela | Hoje (256 + 1152 + 40) | DS literal (320 + 1080 + 80) | Δ |
|---|---:|---:|---:|
| 1920px | 1152 (no teto) | 1080 (no teto) | −72 |
| 1600px | 1152 (no teto) | 1080 (no teto) | −72 |
| **1440px** | 1144 | 1040 | **−104** |
| **1366px** | 1070 | 966 | **−104** |
| 1280px | 984 | 880 | −104 |

Em telas grandes a perda de 72px vem do **teto** (1152 → 1080 do DS), não da barra — adoção pura do DS. Em 1440 e 1366, que é a maioria dos notebooks, a perda sobe para 104px e vem da barra, trocando 9% de área útil por uma navegação que mostra exatamente a mesma coisa nos dois tamanhos.

O corte de 1024px do `tokens.css` foi pensado para **tablet**, não para notebook. O DS §5 estabelece a ordem de prioridade ao dizer *"reduzir gaps antes de reduzir tipografia"* — aplicar esse mesmo raciocínio a notebooks é coerente com o documento.

Implementação: `w-64 2xl:w-80`. Uma linha. Registrar como desvio consciente na Fase 9.

Nada quebra em nenhum dos cenários: 966px continua acima do `min-w-[760px]` da semana do calendário e dos ~728px da tabela de tarefas. A barra recolhível de 64px segue como válvula de escape, com preferência persistida.

### ✅ Decisão 3 — Nomenclatura dos tokens

O DS usa prefixo `--sc-*`; o projeto usa `--sb-*` em ~350 pontos.
**Recomendação: manter `--sb-*`** e apenas repontar os valores. Renomear é churn puro, sem ganho visual, com risco de erro de digitação silencioso. Registrar a equivalência numa tabela no topo de `globals.css`.

### ✅ Decisão 4 — `.dark` vs. `[data-theme="dark"]`

O DS usa `[data-theme="dark"]`; o projeto usa a classe `.dark` com `darkMode: "class"`.
**Recomendação: manter `.dark`.** Mudar exige editar `tema-init.ts` → regerar `HASH_DO_SCRIPT_DE_TEMA` em `csp.ts` → arriscar quebrar a CSP em produção, tudo para um resultado visual **idêntico**. Nenhum benefício, risco real.

---

## 5. Plano de execução — 9 fases

Cada fase é um ponto de parada seguro: o app compila, passa nos testes e fica utilizável ao fim de qualquer uma.

---

### Fase 0 — Preparação · ~1h · risco nulo

**Objetivo:** ter com o que comparar.

1. Branch `feat/design-system-1.0`.
2. Baseline verde: `npm run lint && npm run typecheck && npm run test`.
3. Capturas de tela das 12 rotas em claro e escuro, desktop (1440) e mobile (390). São 48 imagens — é o que permite provar que a Fase 1 não mudou o layout, só o tom.
4. Inventário dos 56 usos de cor crua (§3.3) em planilha, marcando o papel semântico de cada um.

**Verificação:** baseline registrado, nenhum arquivo alterado.

---

### Fase 1 — Fundação de tokens · ~3h · risco BAIXO · alcance GLOBAL

**Arquivos:** `src/app/globals.css`, `tailwind.config.ts`

1. Repontar os 10 tokens claros e os 9 escuros para os valores do DS (§3.1, §3.2), **mantendo o formato de canais RGB**.
2. Criar `--sb-surface-hover`, `--sb-disabled`, `--sb-disabled-bg` (claro e escuro) e registrá-los em `theme.extend.colors`.
3. Criar `--sb-shadow-card` e `--sb-shadow-float` como variáveis **com valores próprios por tema**, e apontar `boxShadow.subtle` / `boxShadow.raised` para elas. Corrige a sombra invisível no escuro (§3.6).
4. Adicionar as seis semânticas como tokens (`--sb-success`, `--sb-danger`, `--sb-warning`, `--sb-info`, `--sb-work`, `--sb-personal`) **sem consumir ainda** — a substituição é a Fase 7.
5. Derivar e documentar as variantes escuras das seis semânticas, com o valor de contraste medido ao lado (§3.3, lacuna).
6. Atualizar `viewport.themeColor` em `src/app/layout.tsx` para `#f5f5f2` / `#0d0d0d`.
7. Escrever no topo de `globals.css` a tabela de equivalência `--sb-*` ↔ `--sc-*` (Decisão 3).

**Por que primeiro:** é a fase de maior alcance e menor risco. Tudo depois herda daqui.

**Verificação:** diff visual contra a baseline — layout **idêntico**, apenas tom mais quente e sombra visível no escuro. `npm run test`.

---

### Fase 2 — Tipografia · **~6–8h** · risco **ALTO** · a fase mais cara e a de maior valor

**Arquivos:** `tailwind.config.ts`, `src/app/globals.css`, `src/components/layout/PageHeader.tsx` + os ~40 arquivos com uso de texto

> **Esta fase é triagem, não configuração.** A versão inicial deste plano a estimava em 3h tratando-a como troca de valores no config. Com a separação Body/Small (Decisão 1), os 195 usos de `text-corpo` precisam ser classificados um a um. O grosso do tempo está no passo 5.

#### 2a. Escala (≈1h)

1. Repontar `theme.extend.fontSize` conforme o mapeamento da Decisão 1, **mantendo os nomes atuais** — `corpo`, `corpo-forte`, `legenda`, `meta`, `micro` continuam existindo, com valores novos.
2. Adicionar os degraus que faltam: `text-display` (`clamp(3.25rem, 5.1vw, 5rem)` / 0.96 / −0.055em) e `text-h2` (32px / 1.08).
3. Corrigir `.eyebrow` em `globals.css`: 11→12px, peso 500→600, tracking 0.14→0.16em.

#### 2b. Consolidação dos degraus soltos (≈1h)

4. Trocar os **98 `text-sm`** por `text-legenda` (que agora vale 14px). É substituição mecânica e sem mudança visual — os dois passam a valer o mesmo. Conferir também `text-lg` (12 usos) e `text-xl` (1 uso).

#### 2c. Triagem do `text-corpo` (≈4–5h) ⚠️ o coração da fase

5. Classificar os **195 usos** entre Body (16px) e Small (14px), pelo critério da Decisão 1: *lê* → Body; *consulta* → Small.

   Ordem sugerida, do mais denso para o menos (concentra o risco no começo, quando ainda é barato voltar atrás):

   | Arquivo | Usos | Viés esperado |
   |---|---:|---|
   | `FinanceView.tsx` | 26 | Small (tabelas, valores) |
   | `SettingsPanels.tsx` | 21 | Body (descrições) |
   | `VaultClient.tsx` | 20 | misto |
   | `RecoveryKit.tsx` | 14 | Body |
   | `TaskForm.tsx` | 14 | Body (rótulos) |
   | `CaptureView.tsx` | 13 | Body |
   | `DriveView.tsx` | 12 | Small (lista de arquivos) |
   | + ~33 arquivos | ~75 | — |

   Registrar a classificação numa planilha durante o trabalho: ela vira a base da regra escrita na Fase 9.

#### 2d. Display e ajustes de consequência (≈1h)

6. `PageHeader.tsx:76`: trocar `text-4xl sm:text-5xl` por `text-display`, com teto mobile de 44–52px conforme o DS §9.
7. `CalendarViews.tsx:415`: elevar o `min-w-[760px]` para ~900px, acompanhando o crescimento do texto nas 7 colunas (§3.4).
8. **Reescrever o bloco 1 do comentário de `tailwind.config.ts`** — ele hoje afirma que a escala reproduz o que já estava na tela. Após esta fase isso deixa de ser verdade, e comentário desatualizado é pior que comentário ausente. O texto novo precisa registrar o critério Body/Small e a exceção do `micro`.

**Verificação obrigatória:** varredura das 12 rotas em 390px, 768px, 1366px e 1440px caçando (a) título estourando em 3+ linhas, (b) tabela do Financeiro com rolagem horizontal, (c) rótulo truncado na barra mobile, (d) botão com texto quebrado em duas linhas, (e) evento do calendário com título ilegível na visão de semana.

**Ponto de parada:** os passos 2a e 2b são reversíveis isoladamente (um objeto no config + substituição mecânica). O 2c não é — depois da triagem, voltar significa refazer. Fazer 2a+2b, verificar, e só então entrar no 2c.

---

### Fase 3 — Forma, elevação e movimento · ~2h · risco BAIXO

**Arquivos:** `tailwind.config.ts`

1. `borderRadius.lg`: 14 → **18px** (cartões, via `Card.tsx`).
2. Criar `borderRadius.xl` = **24px** (modais).
3. `borderRadius.DEFAULT`: 10 → 12px, alinhando ao raio de controle. Grepar `rounded` isolado antes.
4. Auditar os 7 `rounded-[…]` arbitrários e encaixá-los na escala.
5. Unificar o easing em `cubic-bezier(.2,.75,.25,1)` nas cinco animações.
6. Normalizar durações: 120ms (hover/popover) e 180ms (superfície/modal/toast/lista).
7. **Preservar integralmente** o `@media (prefers-reduced-motion: reduce)` e a proibição de `animation-delay` e de animação por JavaScript. Reafirmar no comentário.

**Verificação:** abrir modal, toast, dropdown e a folha mobile. Repetir com "reduzir movimento" ativo no SO — nenhum piscar, nenhum deslocamento.

---

### Fase 4 — Primitivos de UI · ~4h · risco MÉDIO

**Arquivos:** `src/components/ui/{Button,Card,Badge,Modal,Toast,DropdownMenu,states,estilos,Avatar}.tsx`

| Componente | Mudança |
|---|---|
| `Button.tsx` | Alturas: `sm` 32→40px, `md` 40→44px, `lg` 48→**52px** (DS). `danger` passa a usar o token `danger` (secundário com texto vermelho; fundo sólido só em confirmação destrutiva). `disabled` usa os tokens novos em vez de `opacity-50`. Gap ícone+rótulo = 10px. |
| `Card.tsx` | Herda o raio de 18px da Fase 3. Padding 20→**24px** (DS pede 20–28). Preservar os dois níveis de elevação e o comentário que os justifica. |
| `Badge.tsx` / `PillButton` | Altura 36–40px conforme o DS. Adicionar a variante "ponto colorido + rótulo" que o DS pede para chips de categoria — **cor nunca preenche o chip inteiro**. |
| `Modal.tsx` | `rounded-xl` (24px), `shadow-float`, véu com o motion novo. |
| `Toast.tsx` | Tons `success`/`error` passam a consumir os tokens semânticos. |
| `DropdownMenu.tsx` | Raio de controle, `shadow-float`, `popover-in` 120ms. |
| `states.tsx` | Empty state conforme o DS: círculo de **56–72px** (hoje 44px), ícone 20–24px, `text-red-500` → token `danger`. |
| `estilos.ts` | **Criar `CLASSE_DO_CAMPO`** — o input padrão de 52px, raio 12, borda `line`, placeholder `ink-muted`, foco com ring de 3px. Hoje o input é reescrito à mão em ~15 lugares (5× `h-9`, resto `h-10`). Manter o arquivo **sem imports**, pelo motivo já documentado nele. |

**Cuidado:** `estilos.ts` não pode ganhar dependência — o comentário do arquivo explica que isso arrastaria `ThemeToggle`, `Avatar` e `Link` para o pacote do navegador.

**Verificação:** `npm run typecheck` + inspeção manual de cada primitivo em ambos os temas.

---

### Fase 5 — Shell de layout · ~3h · risco MÉDIO

**Arquivos:** `src/app/(app)/layout.tsx`, `AppSidebar.tsx`, `MobileNavigation.tsx`, `PageHeader.tsx`, `ThemeToggle.tsx`, `Icons.tsx`

1. Sidebar: **`w-64 2xl:w-80`** — 256px até 1535px, 320px a partir de 1536px (Decisão 2). Recolhida continua 64px. **Não** usar o corte de 1024px do `tokens.css`: ele foi pensado para tablet e penalizaria os notebooks de 1366/1440px em 104px de área útil.
2. Conteúdo: `max-w-6xl` → `max-w-[67.5rem]` (1080px); recolhido `84rem` → **`83.5rem`**, e **atualizar o comentário da aritmética** (§3.8).

   > ⚠️ Com a barra variável, a aritmética do recolhimento passa a ter **dois regimes**: abaixo de 1536px a barra devolve 12rem (16→4), acima devolve 16rem (20→4). O teto recolhido de 83,5rem só fecha a conta no regime de cima. Verificar se o comentário precisa descrever os dois casos ou se o teto maior é inofensivo no regime de baixo — em 1366px o conteúdo é limitado pela viewport, não pelo teto, então provavelmente é inofensivo. **Confirmar medindo, não deduzindo.**
3. Padding: `px-5` → `px-5 md:px-8 lg:px-10` (20 / 32 / 40px).
4. Item de nav: `py-2.5` → `py-4` (52px de altura, conforme DS §7).
5. `Icons.tsx`: `width/height` 18 → **20**, `strokeWidth` 1.6 → **1.75**. É uma linha que muda todos os ícones do produto.
6. `PageHeader.tsx`: display da Fase 2; ações no canto superior direito (já está correto); manter o padrão de slot da busca — o comentário de 40 linhas explica por que ele não pode virar booleano.
7. `MobileNavigation.tsx`: conferir os alvos de 44px com o ícone de 20px; a folha ganha o raio novo.
8. `ThemeToggle.tsx`: 40 → 44px, borda `line`.
9. Reservar o espaço da marca no topo da sidebar (a marca em si entra na Fase 6).

**Cuidado:** não tocar em `sidebar-preferencia.tsx` (script de pré-pintura). A largura vive em `AppSidebar.tsx`; o script só escreve o atributo. Rodar `sidebar-preferencia.test.tsx`.

**Verificação:** recolher/expandir a barra em **1600px** (regime de 320px) e confirmar que o conteúdo ganha os 16rem; repetir em **1366px** (regime de 256px) e confirmar os 12rem. Testar também 1536px (a fronteira exata), 1024px e 768px.

---

### Fase 6 — Marca · ~2h · risco BAIXÍSSIMO · 🎯 maior retorno percebido

**Arquivos:** `public/**` (novo), `src/app/icon.svg` (novo), `src/app/layout.tsx`, `login/page.tsx`, `AppSidebar.tsx`, `src/components/ui/Logotipo.tsx` (novo)

1. Criar `public/brand/` com os quatro SVGs enviados.
2. Criar `src/app/icon.svg` (convenção de arquivo do Next 15 — gera o favicon **sem tocar em rota**) e `apple-icon.png`.
3. Criar `src/components/ui/Logotipo.tsx` com três variantes (`simbolo`, `horizontal`, `compacta`). **Ponto técnico:** os SVGs trazem `#111111`/`#F7F7F4` fixos; o componente deve usar `currentColor` para acompanhar o tema com **um** arquivo, em vez de alternar entre a versão normal e a inversa por CSS.
4. `login/page.tsx`: trocar o **cadeado** (`Icon.Vault`) pelo lockup horizontal. É a primeira tela que qualquer pessoa vê.
5. `AppSidebar.tsx`: símbolo da marca no topo; o avatar do usuário desce para o rodapé, junto do nome e do e-mail (onde já está). Recolhida, sobra o símbolo — mínimo de 24px, respeitado.
6. Área de proteção de ¼ do símbolo e mínimos (24px símbolo / 136px lockup) respeitados em todos os pontos.
7. `metadata`: manter `title` e `description` — "Tudo que importa, em um só lugar." já está no tom verbal do DS §10.

**Verificação:** aba do navegador, atalho na tela inicial do celular, tela de login em ambos os temas.

---

### Fase 7 — Cor semântica · ~4h · risco MÉDIO

**Arquivos:** `src/lib/calendar-colors.ts` e os 24 arquivos de feature do inventário

1. Substituir as 56 ocorrências de paleta crua pelos tokens da Fase 1.
2. `calendar-colors.ts`: `teal-500`/`violet-500` → `work`/`personal`. As classes **continuam sendo literais no objeto** — o comentário do arquivo explica que classe montada em tempo de execução some da build de produção sem erro. Manter a regra "cor nunca sozinha": rótulo textual, `title` e `sr-only` continuam.
3. `FinanceView.tsx` (16 usos): entrada/saída passam por `success`/`danger`, **com reforço não-cromático obrigatório** — sinal, ícone ou rótulo. Vermelho/verde como única informação é violação explícita do DS §9.
4. Aplicar a **regra 90/10**: auditar cada uso remanescente e perguntar "esta cor carrega informação?". Se não carregar, ela vira neutra.
5. Barras e pontos de categoria com 2–3px, conforme DS §7.
6. Verificar cada semântica escura contra WCAG AA (a lacuna aberta na Fase 1).

**Verificação:** simulação de daltonismo (deuteranopia/protanopia) nas telas de Financeiro, Calendário e Tarefas. Nenhuma informação pode se perder.

---

### Fase 8 — Acessibilidade · ~3h · risco BAIXO

1. **Alvos de 44×44px:** corrigir o botão de sair (32px, `AppSidebar.tsx:314`), o `Button size="sm"` e todo `h-8` interativo. Onde a densidade não permitir 44px visuais, ampliar a área de toque com `::before` — o alvo cresce, o desenho não.
2. **Foco:** alinhar ao DS — borda `ink` + ring externo de 3px a 10%, em vez do outline atual. Verificar em campo, botão, link, chip e item de nav.
3. **Estados completos:** garantir `default`, `hover`, `pressed`, `focus-visible`, `disabled` e `loading` em todo controle (DS §8).
4. **Contraste:** medir todo par texto/fundo nos dois temas.
5. **Ícone sem rótulo:** conferir `aria-label` em todos (o projeto já é forte nisso).
6. **Display no mobile:** confirmar 44–52px, sem quebra em 3+ linhas (DS §9).
7. Reconferir `prefers-reduced-motion` após as fases 3 a 5.

---

### Fase 9 — Documentação · ~2h · risco nulo

1. `docs/design-system.md`: o DS 1.0 traduzido para as decisões **deste** código, com a tabela `--sb-*` ↔ `--sc-*` e os desvios conscientes registrados (Decisões 2 a 4). Precisa conter, obrigatoriamente:
   - **A regra Body vs. Small**, derivada da planilha de triagem da Fase 2 — com exemplos dos dois lados. Sem isso, o próximo componente escrito reabre a fragmentação que a Fase 2 fechou.
   - A **exceção do `text-micro`** (10px, mapa de calor) e por que ela existe.
   - O **corte da sidebar em 1536px** e por que não são os 1024px do `tokens.css`.
2. Atualizar os comentários-âncora que a migração tornou obsoletos: bloco 1 (escala tipográfica) e bloco 3 (elevação) do `tailwind.config.ts`, a aritmética do `max-w` em `(app)/layout.tsx`, e o cabeçalho do `Card.tsx`. **Este projeto documenta o porquê dentro do código — deixar comentário mentindo é regressão.**
3. Publicar o `design-system.html` em `docs/` como referência de origem.

---

## 6. Ordem, dependências e caminhos alternativos

```
Fase 0 ──> Fase 1 ──┬──> Fase 2 ──────────────────> Fase 5 ──> Fase 8 ──> Fase 9
                    ├──> Fase 3 ──> Fase 4 ──────────┘
                    └──> Fase 7 ─────────────────────┘

Fase 6 (Marca) ── independente, pode ir a qualquer momento
```

| Fase | Assunto | Estimativa |
|---|---|---:|
| 0 | Preparação e baseline | 1h |
| 1 | Fundação de tokens | 3h |
| 2 | **Tipografia (triagem)** | **6–8h** |
| 3 | Forma, elevação, movimento | 2h |
| 4 | Primitivos de UI | 4h |
| 5 | Shell de layout | 3h |
| 6 | Marca | 2h |
| 7 | Cor semântica | 4h |
| 8 | Acessibilidade | 3h |
| 9 | Documentação | 2h |
| | **Total** | **30–32h** |

**Se quiser retorno imediato:** Fase 6 isolada (~2h). O produto passa a ter identidade sem que nenhuma métrica de layout mude.

**Se quiser o ganho invisível de maior alcance:** Fases 0 → 1 → 3 (~6h). Cor, sombra, raio e movimento alinhados, com refluxo **zero**.

**Se quiser o DS inteiro:** todas as nove, na ordem acima. A Fase 2 concentra ~25% do esforço total e é onde vale ir devagar.

---

## 7. Riscos e armadilhas específicas deste código

| # | Risco | Como se manifesta | Mitigação |
|---|---|---|---|
| 1 | **Hash da CSP do script de tema** | Editar `tema-init.ts` invalida `HASH_DO_SCRIPT_DE_TEMA`. Em bloqueio, o tema para de aplicar antes da pintura e a tela **pisca de branco** a cada carregamento. Sem erro em lugar nenhum. | Não tocar no arquivo (Decisão 4). Se for inevitável, regerar o hash e rodar `csp.test.ts`. |
| 2 | **Classe do Tailwind montada em runtime** | `bg-${token}-500` não é encontrado na varredura e a cor **some só na build de produção**. | Manter classes literais, como `calendar-colors.ts` já faz. |
| 3 | **`theme.fontSize` no lugar de `theme.extend.fontSize`** | Apaga a escala padrão; `text-sm`/`text-lg`/`text-xl` (111 usos) somem sem erro de build. | Sempre `extend`. Já está avisado no comentário do arquivo. |
| 4 | **`animation-delay` na entrada de lista** | O `@media` de reduced-motion **não zera delay**. Quem pediu menos movimento recebe um piscar. | Proibição mantida. Reafirmar na Fase 3. |
| 5 | **Refluxo em massa da Fase 2** | Tabela do Financeiro com rolagem horizontal, rótulo da barra mobile truncado, título em 4 linhas. | A triagem Body/Small (Decisão 1) contém o dano nas telas densas: 14px em vez de 16px onde é metadata. Passos 2a+2b verificados antes do 2c. Varredura em 4 larguras. |
| 5b | **Triagem inconsistente** | Dois cartões parecidos acabam com tamanhos diferentes porque foram triados em dias diferentes. É o defeito original voltando com números novos. | Planilha de classificação preenchida durante a Fase 2 e convertida em regra escrita na Fase 9. Revisar por padrão de componente, não por arquivo. |
| 6 | **Aritmética do `max-w` recolhido** | Recolher a barra deixa de devolver espaço; o clique não produz efeito visível. | Recalcular 67.5/83.5rem e atualizar o comentário. **Com a barra em dois regimes (256/320px), medir nos dois** — ver a nota na Fase 5. |
| 7 | **Sombra invisível no escuro** | Já é um defeito **hoje**. | Corrigido na Fase 1 ao tokenizar por tema. |
| 8 | **`estilos.ts` ganhar import** | Arrasta módulos para o pacote do cliente por causa de uma string. | Manter sem dependências (Fase 4). |
| 9 | **Semânticas ilegíveis no escuro** | `#A96918` sobre `#0d0d0d` reprova em AA. | Derivar variantes escuras na Fase 1, medir na Fase 7. |
| 10 | **Testes de layout** | `sidebar-preferencia.test.tsx` e `Editor.test.tsx` podem depender de valores. | Rodar `npm run test` ao fim de **cada** fase. |

---

## 8. Critérios de aceite

### Por fase
- [ ] `npm run lint` sem avisos novos
- [ ] `npm run typecheck` limpo
- [ ] `npm run test` verde (36 arquivos de teste)
- [ ] 12 rotas abertas em claro e escuro, sem regressão
- [ ] Diff visual contra a baseline da Fase 0

### Final
- [ ] Nenhum arquivo da zona proibida (§2) alterado — conferir por `git diff --stat`
- [ ] **Escala tipográfica consolidada:** zero `text-sm`/`text-lg`/`text-xl` soltos; todo texto sai de degrau nomeado
- [ ] **Triagem Body/Small aplicada e coerente:** componentes do mesmo tipo usam o mesmo degrau em todas as telas
- [ ] Toda cor sai de token; zero paleta crua do Tailwind fora de `globals.css`
- [ ] Todo alvo interativo ≥ 44×44px, ou com área ampliada documentada
- [ ] Contraste AA em ambos os temas, medido
- [ ] Nenhuma informação transmitida só por cor
- [ ] `prefers-reduced-motion` respeitado; nenhum `animation-delay`; nenhuma animação por JS
- [ ] Marca presente no favicon, no login e na sidebar; mínimos e área de proteção respeitados
- [ ] Regra 90/10 aplicada — auditada tela a tela
- [ ] Comentários-âncora atualizados; nenhum descrevendo comportamento antigo
- [ ] `docs/design-system.md` publicado com os desvios conscientes registrados

---

## 9. Resumo de arquivos

### Alterados

| Arquivo | Fases |
|---|---|
| `src/app/globals.css` | 1, 2, 8 |
| `tailwind.config.ts` | 1, 2, 3, 9 |
| `src/app/layout.tsx` | 1, 6 |
| `src/app/(app)/layout.tsx` | 5, 9 |
| `src/app/(auth)/login/page.tsx` | 4, 6 |
| `src/components/ui/Button.tsx` | 4, 8 |
| `src/components/ui/Card.tsx` | 4, 9 |
| `src/components/ui/Badge.tsx` | 4, 7 |
| `src/components/ui/Modal.tsx` | 3, 4 |
| `src/components/ui/Toast.tsx` | 4, 7 |
| `src/components/ui/DropdownMenu.tsx` | 3, 4 |
| `src/components/ui/states.tsx` | 4, 7 |
| `src/components/ui/estilos.ts` | 4 |
| `src/components/ui/Icons.tsx` | 5 |
| `src/components/ui/Avatar.tsx` | 4 |
| `src/components/layout/AppSidebar.tsx` | 5, 6, 8 |
| `src/components/layout/PageHeader.tsx` | 2, 5 |
| `src/components/layout/MobileNavigation.tsx` | 5, 8 |
| `src/components/layout/BuscaNaPagina.tsx` | 4 |
| `src/components/theme/ThemeToggle.tsx` | 5 |
| `src/lib/calendar-colors.ts` | 7 |
| `src/components/features/**` (25 arquivos) | 7, 8 |

### Criados

`public/brand/logo-symbol.svg` · `logo-horizontal.svg` · `logo-horizontal-inverse.svg` · `src/app/icon.svg` · `src/app/apple-icon.png` · `src/components/ui/Logotipo.tsx` · `docs/design-system.md`

### Intocados

`src/app/api/**` · `src/middleware.ts` · `src/lib/supabase/**` · `src/lib/crypto/**` · `src/lib/google/**` · `src/lib/clickup/**` · `src/lib/data.ts` · `src/lib/csp.ts` · `src/components/theme/tema-init.ts` · `src/components/layout/sidebar-preferencia.tsx` · `supabase/**`

---

## 10. Observação final

O trabalho já feito neste código é a razão pela qual esta migração é viável em ~25 horas em vez de ~80. Tokens centralizados, escala nomeada, elevação com três níveis, movimento declarativo, acessibilidade blindada e — o que mais importa — **o porquê escrito ao lado de cada decisão**.

Este plano trata esses comentários como parte do sistema: onde a migração contradiz o que está escrito, o texto é reescrito na mesma fase, não depois. Um comentário que descreve o comportamento antigo é mais perigoso que nenhum.

**Próximo passo:** as quatro decisões do §4 estão fechadas. A execução pode começar pela **Fase 0**, ou pela **Fase 6** se você quiser ver a marca no produto antes de mexer em qualquer métrica de layout.

---

## Histórico de revisões

| Data | Mudança |
|---|---|
| 06/08/2026 | Versão inicial. Quatro decisões em aberto. |
| 06/08/2026 | **Decisões 1 e 2 fechadas.** A Fase 2 passa de "repontar a escala" para "consolidar sete degraus em três, com triagem Body/Small dos 195 usos de `text-corpo`" — estimativa corrigida de 3h para 6–8h, e o total do plano de 22–30h para 30–32h. A Fase 5 adota a sidebar de 320px com corte em 1536px (`2xl`) em vez dos 1024px do `tokens.css`, preservando a densidade em notebooks de 1366/1440px. Acrescentados o risco 5b (triagem inconsistente), a nota dos dois regimes de recolhimento e os critérios de aceite tipográficos. |
