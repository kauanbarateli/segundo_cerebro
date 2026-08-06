import type { Config } from "tailwindcss";

/**
 * =============================================================================
 * SISTEMA VISUAL — Segundo Cérebro
 * =============================================================================
 *
 * Monocromático. As cores vêm de variáveis CSS (ver src/app/globals.css) para
 * que claro/escuro troquem com uma única classe no <html>.
 *
 * -----------------------------------------------------------------------------
 * 1. ESCALA TIPOGRÁFICA — três degraus abaixo de 20px, e o porquê
 * -----------------------------------------------------------------------------
 * A escala anterior nomeava seis tamanhos, mas o produto usava SETE abaixo de
 * 22px: micro 10, meta 11, legenda 12, corpo 13, corpo-forte 15, mais 99 usos de
 * `text-sm` (14px) que nunca entraram na escala. Um pixel de diferença entre
 * `legenda` (12) e `text-sm` (14) e `corpo` (13) não comunica hierarquia —
 * comunica decisões tomadas em momentos diferentes. O defeito não era o tamanho,
 * era a QUANTIDADE de degraus.
 *
 * O DS 1.0 tem três abaixo de 20px, e é esta a escala agora:
 *
 *   text-micro       10px / 14px   EXCEÇÃO — ver abaixo
 *   text-meta        12px / 16px   Eyebrow: rótulo curto, categoria, sobrescrito
 *   text-legenda     14px / 20px   Small:  METADATA — o que se CONSULTA
 *   text-corpo       16px / 24px   Body:   CONTEÚDO — o que se LÊ
 *   text-corpo-forte 20px / 29px   Body L: subtítulo de página, destaque
 *   text-titulo      24px / 30px   H3:     título de cartão, de bloco, de doc
 *   text-h2          32px / 35px   H2:     título de seção
 *   text-display     52→80px       Display editorial de cabeçalho de página
 *
 * ⚠️ ESTE BLOCO MUDOU DE NATUREZA. Até a migração para o DS 1.0 ele afirmava que
 * a escala reproduzia o que já estava na tela, com no máximo 1px de diferença —
 * ou seja, que a nomeação NÃO era um redesenho disfarçado. Isso deixou de ser
 * verdade: `corpo` subiu de 13 para 16px, `legenda` de 12 para 14, `corpo-forte`
 * de 15 para 20. A adoção do DS é, explicitamente, um redesenho tipográfico, e
 * este texto é a nova referência.
 *
 * -----------------------------------------------------------------------------
 * A REGRA QUE SUSTENTA A ESCALA: `corpo` vs. `legenda`
 * -----------------------------------------------------------------------------
 * O DS separa Body ("conteúdo e controles") de Small ("metadata"). Os 195 usos do
 * antigo `text-corpo` de 13px cobriam OS DOIS PAPÉIS — título de cartão e carimbo
 * de data usavam o mesmo tamanho. A migração triou um a um pelo critério:
 *
 *   text-corpo (16px)    o que a pessoa LÊ
 *                        descrição de cartão, rótulo de formulário, texto de
 *                        botão, mensagem de estado vazio, parágrafo de ajuda
 *
 *   text-legenda (14px)  o que a pessoa CONSULTA
 *                        célula de tabela, data, contador, chip, valor
 *                        monetário em lista, metadado de linha, texto de apoio
 *
 * Não é preferência: é o que contém o refluxo nas telas densas. Subir metadata de
 * 13 para 16px (+23%) estouraria a tabela do Financeiro e a semana do Calendário;
 * subir para 14px (+8%) cabe. Componente do mesmo tipo usa o mesmo degrau em
 * todas as telas — a regra vale por PADRÃO DE COMPONENTE, não por arquivo.
 *
 * EXCEÇÃO `text-micro` (10px): o DS não tem degrau abaixo de 12px. Ela sobrevive
 * porque o mapa de calor de Hábitos põe 13 rótulos de semana lado a lado numa
 * grade de 7 linhas; em 12px a grade estoura. São 7 usos, todos em rótulo de eixo
 * de gráfico, e nenhum deles é texto que se lê em sequência.
 *
 * ATENÇÃO ao mexer aqui: usamos `theme.extend.fontSize`, NUNCA `theme.fontSize`.
 * Substituir a chave inteira apagaria a escala padrão do Tailwind. A migração
 * eliminou os `text-sm` soltos, mas `text-2xl`/`text-3xl` ainda aparecem em
 * pontos isolados e sumiriam de uma vez, silenciosamente (a classe deixa de
 * existir e o texto volta ao tamanho herdado, sem nenhum erro de build).
 *
 * Precedência: `leading-*` e `tracking-*` continuam vencendo o que está definido
 * aqui, porque o Tailwind emite os plugins `lineHeight` e `letterSpacing` DEPOIS
 * de `fontSize`. Os `leading-none`/`leading-tight` e os `tracking-*` que já
 * existem no código seguem mandando no elemento em que estão. Conferido em
 * node_modules/tailwindcss/src/corePlugins.js (fontSize:2105, lineHeight:2215).
 *
 * -----------------------------------------------------------------------------
 * 2. RITMO DE ESPAÇAMENTO — 4 pt
 * -----------------------------------------------------------------------------
 * A escala padrão do Tailwind já é múltipla de 4 (spacing 1 = 4px). O que faltava
 * era a REGRA. Ela é esta, e vale para gap, padding, margin e space-y:
 *
 *   1  (4px)   colado: ícone e seu rótulo, duas linhas do mesmo dado
 *   2  (8px)   itens irmãos dentro de um bloco: botões de uma barra, chips
 *   2.5(10px)  ícone e rótulo DENTRO de um botão (DS §7 pede exatamente 10)
 *   3  (12px)  separação interna de um bloco: rótulo e campo, linhas de lista
 *   4  (16px)  respiro entre blocos distintos dentro do mesmo cartão
 *   6  (24px)  padding interno de cartão e de modal; distância entre seções
 *   8+ (32px+) separação entre regiões grandes; acima disso, use 12 (48px)
 *
 * O degrau 5 (20px) saiu da lista como padding de cartão: o DS §7 pede 20–28px e
 * a migração para o DS 1.0 levou o cartão e o modal para 24px (`p-6`). Com o
 * corpo em 16px e o raio em 18px, 20px deixava o texto encostado na moldura —
 * quanto maior o raio, mais respiro o canto pede para o conteúdo não parecer que
 * vaza pela curva. `p-5` continua existindo como o PISO da faixa do DS, para o
 * cartão compacto que não cabe em 24.
 *
 * Degraus fora dessa lista (`p-2.5`, `gap-1.5`, `py-0.5`) existem no código e
 * continuam válidos onde o alvo é ALTURA DE CONTROLE, não ritmo de layout — um
 * botão de 30px precisa de `py-1.5`, e arredondar para `py-2` mudaria a altura do
 * controle. A regra é sobre ritmo vertical, não sobre métrica de componente. O
 * degrau 13 (52px) acrescentado em `spacing`, mais abaixo, é o caso extremo
 * disso: existe só como altura de controle e nunca deve virar gap nem margem.
 *
 * ESTA REGRA VALE PARA CÓDIGO NOVO. Não saia trocando os `gap-3` e `mb-6` que já
 * estão nas telas. Mudança de espaçamento em massa é alteração visual de alto
 * risco (empurra tudo que está abaixo, quebra alinhamento entre colunas, muda
 * ponto de quebra de linha) e de retorno praticamente nulo — o que está na tela
 * hoje já é coerente. O ganho está em não INTRODUZIR mais improviso.
 *
 * -----------------------------------------------------------------------------
 * 3. ELEVAÇÃO — quatro níveis, duas sombras
 * -----------------------------------------------------------------------------
 * Hierarquia se faz com contraste de borda + sombra, nesta ordem:
 *
 *   0. fundo        `bg-canvas`, sem sombra — a página
 *   1. superfície   `bg-surface border-line`, sem sombra — painel encostado no
 *                   fundo, cabeçalho fixo, barra lateral
 *   2. cartão       `bg-surface border-line shadow-subtle` — o cartão comum
 *   3. destaque     `border-line-strong shadow-raised` — o cartão que o usuário
 *                   precisa achar primeiro, ou o item sendo arrastado
 *   4. sobreposição `shadow-raised` sobre fundo escurecido — modal, menu, toast
 *
 * Só existem DUAS sombras e nenhuma foi acrescentada. A diferença entre o nível 3
 * e o 4 não é a sombra: é o que está atrás (o nível 4 tem um véu escuro por
 * baixo) e o RAIO — modal e menu usam `rounded-xl` (24px), o cartão usa
 * `rounded-lg` (18px). Mais sombras não deixariam a hierarquia mais legível,
 * deixariam mais barulhenta. Ver `Card` em src/components/ui/Card.tsx, que é onde
 * os níveis 1 a 3 viram código.
 *
 * ⚠️ AS DUAS SOMBRAS TROCAM COM O TEMA, e isso mudou na migração para o DS 1.0.
 * Os valores saíram daqui e foram para `--sb-shadow-card` / `--sb-shadow-float`
 * em globals.css, porque uma sombra preta sobre o fundo #0d0d0d do tema escuro é
 * literalmente invisível: o cartão perdia o nível 2 e ficava indistinguível do
 * painel encostado no fundo. O escuro usa sombras mais opacas e mais espalhadas,
 * que é o que devolve a separação de planos. Ver o bloco de elevação lá.
 *
 * -----------------------------------------------------------------------------
 * 4. MOVIMENTO
 * -----------------------------------------------------------------------------
 * Ver o bloco de comentário junto de `keyframes`, mais abaixo — inclusive a
 * conferência de `prefers-reduced-motion`, que é requisito de acessibilidade e
 * não detalhe.
 * =============================================================================
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      /**
       * As cores saem TODAS de variável CSS. Ver src/app/globals.css, que traz
       * os valores, a tabela de equivalência com o DS 1.0 e o contraste medido
       * de cada par texto/fundo.
       *
       * Os pares `{nome}` / `{nome}-ink` das semânticas não são sinônimos: o
       * primeiro é preenchimento (ponto, barra, moldura) e o segundo é texto.
       * O do DS reprova em AA como texto no tema claro — o `-ink` é o degrau
       * que passa. Usar o errado é regressão de acessibilidade silenciosa.
       */
      colors: {
        canvas: "rgb(var(--sb-canvas) / <alpha-value>)",
        surface: "rgb(var(--sb-surface) / <alpha-value>)",
        "surface-muted": "rgb(var(--sb-surface-muted) / <alpha-value>)",
        "surface-hover": "rgb(var(--sb-surface-hover) / <alpha-value>)",
        ink: "rgb(var(--sb-ink) / <alpha-value>)",
        "ink-muted": "rgb(var(--sb-ink-muted) / <alpha-value>)",
        "ink-subtle": "rgb(var(--sb-ink-subtle) / <alpha-value>)",
        line: "rgb(var(--sb-line) / <alpha-value>)",
        "line-strong": "rgb(var(--sb-line-strong) / <alpha-value>)",
        accent: "rgb(var(--sb-accent) / <alpha-value>)",
        "accent-ink": "rgb(var(--sb-accent-ink) / <alpha-value>)",
        disabled: "rgb(var(--sb-disabled) / <alpha-value>)",
        "disabled-bg": "rgb(var(--sb-disabled-bg) / <alpha-value>)",

        success: "rgb(var(--sb-success) / <alpha-value>)",
        "success-ink": "rgb(var(--sb-success-ink) / <alpha-value>)",
        danger: "rgb(var(--sb-danger) / <alpha-value>)",
        "danger-ink": "rgb(var(--sb-danger-ink) / <alpha-value>)",
        warning: "rgb(var(--sb-warning) / <alpha-value>)",
        "warning-ink": "rgb(var(--sb-warning-ink) / <alpha-value>)",
        info: "rgb(var(--sb-info) / <alpha-value>)",
        "info-ink": "rgb(var(--sb-info-ink) / <alpha-value>)",
        work: "rgb(var(--sb-work) / <alpha-value>)",
        "work-ink": "rgb(var(--sb-work-ink) / <alpha-value>)",
        personal: "rgb(var(--sb-personal) / <alpha-value>)",
        "personal-ink": "rgb(var(--sb-personal-ink) / <alpha-value>)",
      },

      /**
       * Escala tipográfica nomeada. Ver o bloco 1 no topo do arquivo, que traz o
       * critério `corpo` (o que se lê) vs. `legenda` (o que se consulta).
       *
       * A forma [tamanho, { lineHeight }] faz o Tailwind emitir font-size e
       * line-height na MESMA regra — é o que garante que não volte a existir
       * tamanho de texto sem entrelinha declarada.
       *
       * `letterSpacing` só aparece de `titulo` para cima. Ajuste ótico é
       * necessário quando a letra é grande: sem ele, um display de 80px parece
       * frouxo. Abaixo de 24px, apertar ou soltar mudaria a largura de centenas
       * de elementos já posicionados sem ganho de leitura.
       *
       * `display` usa clamp e não breakpoint porque o tamanho precisa acompanhar
       * a largura continuamente. O piso de 3.25rem (52px) é o teto que o DS §9
       * pede para o mobile — em 390px o clamp já escolhe o piso, e o título cabe
       * em duas linhas em vez das três ou quatro que 80px produziriam.
       */
      fontSize: {
        micro: ["10px", { lineHeight: "14px" }],
        meta: ["12px", { lineHeight: "16px" }],
        legenda: ["14px", { lineHeight: "20px" }],
        corpo: ["16px", { lineHeight: "24px" }],
        "corpo-forte": ["20px", { lineHeight: "29px" }],
        titulo: ["24px", { lineHeight: "30px", letterSpacing: "-0.02em" }],
        h2: ["32px", { lineHeight: "35px", letterSpacing: "-0.035em" }],
        display: [
          "clamp(3.25rem, 5.1vw, 5rem)",
          { lineHeight: "0.96", letterSpacing: "-0.055em" },
        ],
      },

      /**
       * FORMA — a escala de raios do DS §6, mais um degrau abaixo dela.
       *
       *   xs       4px    micro-superfície: caixa de seleção, <kbd>, realce de busca
       *   sm       8px    distintivo, botão pequeno, bloco embutido
       *   DEFAULT  12px   = md. Ver a nota abaixo.
       *   md       12px   CONTROLE: campo, botão, menu, chip retangular
       *   lg       18px   CARTÃO — chega a todos eles por ui/Card.tsx
       *   xl       24px   MODAL e superfícies grandes
       *   full     999px  chip, pill, avatar (vem do Tailwind)
       *
       * `DEFAULT` era 10px, um degrau que não existia na escala e que ninguém
       * escolhia de propósito: os cinco lugares que usavam `rounded` puro eram
       * caixas de seleção de 16px que herdaram esse valor por omissão. Agora ele
       * é o mesmo 12px do controle, e as caixas de seleção passaram a pedir `xs`
       * explicitamente — 12px numa caixa de 16px a deixa quase redonda, e
       * redondo é a forma que comunica "botão de rádio", não "caixa de seleção".
       *
       * `xs` não vem do DS: o menor raio de lá é 8px, pensado para distintivo e
       * botão. Abaixo de ~20px de lado, 8px consome metade da forma. É a mesma
       * classe de exceção do `text-micro`, e pelo mesmo motivo — a escala do DS
       * começa acima do tamanho destes elementos.
       *
       * EXCEÇÃO DOCUMENTADA que continua fora da escala: o mapa de calor de
       * Hábitos usa `rounded-[2px]` em células de 14–18px. Ali o quadrado é a
       * linguagem visual da grade (é um gráfico, não uma superfície), e arredondar
       * mais embaçaria a leitura das colunas. Ver MapaDeCalor.tsx.
       */
      borderRadius: {
        xs: "4px",
        sm: "8px",
        DEFAULT: "12px",
        md: "12px",
        lg: "18px",
        xl: "24px",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
      },

      /**
       * 13 = 52px, a ALTURA DE CONTROLE do DS §7 (botão grande, campo de uma
       * linha). Não existe na escala padrão do Tailwind, que pula de 12 (48px)
       * para 14 (56px).
       *
       * Ela entra em `spacing` e não em `height` para que `h-13`, `min-h-13` e
       * `w-13` (botão de ícone quadrado) saiam do mesmo número. NÃO é um degrau
       * de ritmo de layout — o bloco 2 acima continua valendo, e ninguém deve
       * escrever `gap-13` ou `mb-13`. É métrica de componente, como o `py-1.5`
       * que o próprio bloco 2 já ressalva.
       */
      spacing: {
        13: "3.25rem",
      },

      /**
       * Duas sombras, quatro níveis de elevação. Ver o bloco 3 no topo.
       * `subtle` é o cartão pousado na página; `raised` é o que flutua sobre ela.
       *
       * Os valores moram em VARIÁVEL CSS, não aqui, porque cada tema precisa da
       * sua sombra. Uma sombra preta sobre o fundo #0d0d0d do tema escuro não
       * aparece — o cartão perdia o nível de elevação e ficava igual ao painel
       * encostado no fundo. Com a variável, `.dark` troca a sombra junto com as
       * cores e a hierarquia sobrevive nos dois temas. Ver globals.css.
       */
      boxShadow: {
        subtle: "var(--sb-shadow-card)",
        raised: "var(--sb-shadow-float)",
      },

      /**
       * -----------------------------------------------------------------------
       * MOVIMENTO
       * -----------------------------------------------------------------------
       * Até aqui a interface só tinha `transition-colors`: nada nascia, tudo
       * simplesmente aparecia. O que faltava não é enfeite, é ORIGEM — o modal
       * subindo diz "eu vim do botão que você clicou"; o toast subindo do rodapé
       * diz "eu não estava aqui antes". Deslocamentos de 4 a 8px e as DUAS
       * durações do DS §8 (120ms para o que responde ao ponteiro, 180ms para o
       * que troca uma superfície): perceptível, nunca esperado.
       *
       * Os keyframes moram AQUI, e não em CSS solto, porque o Tailwind só emite o
       * @keyframes quando a classe `animate-*` correspondente aparece no conteúdo
       * escaneado. CSS solto em globals.css entraria na folha de toda rota, tenha
       * ela animação ou não.
       *
       * =======================================================================
       * CONFERÊNCIA OBRIGATÓRIA: prefers-reduced-motion
       * =======================================================================
       * globals.css tem, e não pode perder:
       *
       *     @media (prefers-reduced-motion: reduce) {
       *       *, *::before, *::after {
       *         animation-duration: 0.001ms !important;
       *         transition-duration: 0.001ms !important;
       *       }
       *     }
       *
       * Toda animação declarada abaixo é coberta por esse bloco, e isso foi
       * conferido propriedade por propriedade:
       *
       *  1. São animações CSS puras, declaradas pela propriedade `animation`. A
       *     regra do @media usa a LONGHAND `animation-duration` com !important;
       *     longhand com !important vence a shorthand do utilitário, que não é
       *     !important. A duração vira 0.001ms e o elemento assenta no quadro
       *     final (100%) instantaneamente — que é o estado normal dele.
       *
       *  2. NENHUMA usa `animation-delay`. Esta é a regra dura da seção, e é o
       *     motivo de NÃO haver entrada escalonada de lista. O @media não zera
       *     `animation-delay`. Um atraso de 300ms sobreviveria à redução de
       *     movimento e seguraria o elemento no estado inicial por 300ms reais:
       *     quem pediu menos movimento receberia um piscar. Se um dia alguém
       *     quiser escalonar, o atraso precisa ser zerado DENTRO do @media, senão
       *     a acessibilidade regride.
       *
       *  3. NENHUMA usa `animation-fill-mode`. Sem fill-mode o elemento renderiza
       *     no estado final antes e depois da animação; com a duração zerada não
       *     existe janela nenhuma em que ele apareça transparente ou deslocado.
       *
       *  4. NENHUMA é animação por JavaScript (requestAnimationFrame, Web
       *     Animations API, biblioteca de mola). Movimento em JS não passa nem
       *     perto do @media — teria que consultar `matchMedia` à mão, e uma hora
       *     alguém esqueceria. É a razão de o movimento deste projeto ser todo
       *     declarativo.
       *
       *  5. `iteration-count` é 1 em todas. Animação infinita com duração
       *     0.001ms roda milhares de ciclos por segundo; é o defeito conhecido do
       *     `animate-pulse` do próprio Tailwind (usado em LoadingSkeleton) e não
       *     vamos acrescentar mais casos dele.
       *
       * CONCLUSÃO: sob `prefers-reduced-motion: reduce` as cinco animações abaixo
       * se resolvem em estado final imediato. Modal, véu, toast, menu e item de
       * lista aparecem prontos — sem deslocamento e sem transparência
       * intermediária.
       */
      keyframes: {
        /* Véu do modal. Só opacidade: o fundo escuro não vem de lugar nenhum. */
        "sb-fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        /* Painel do modal: sobe 8px enquanto aparece. */
        "sb-modal-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        /* Toast: nasce no rodapé, então sobe — o sentido do movimento é o mesmo
           da borda por onde ele entra na tela. */
        "sb-toast-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        /* Menu suspenso ancorado no gatilho: deslocamento menor (4px), porque a
           distância percorrida na tela também é menor. */
        "sb-popover-in": {
          from: { opacity: "0", transform: "translateY(-4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        /* Item de lista. 4px e nada mais: repetido por vinte linhas, qualquer
           coisa maior vira onda. */
        "sb-list-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },

      /**
       * MOVIMENTO — duas durações e UMA curva (DS §8).
       *
       *   120ms  o que responde ao ponteiro: hover, menu ancorado no gatilho
       *   180ms  o que troca uma superfície: modal, véu, toast, item de lista
       *
       * Antes havia três durações (140 / 180 / 200) e duas curvas (`ease-out` e
       * a cúbica 0.16,1,0.3,1). Nenhuma das diferenças era perceptível — 140 e
       * 180ms no mesmo clique não se distinguem —, mas cada uma era uma decisão
       * a mais para alguém tomar ao escrever o próximo componente. Duas durações
       * e uma curva é o que faz o movimento parecer um sistema.
       *
       * A curva `cubic-bezier(.2,.75,.25,1)` sai rápido e desacelera longo no
       * fim: o elemento parece POUSAR em vez de frear. Ela é a mesma dos
       * utilitários `transition-*` (ver `transitionTimingFunction` abaixo), então
       * animação de entrada e transição de estado combinam.
       */
      animation: {
        "overlay-in": "sb-fade-in 180ms cubic-bezier(0.2, 0.75, 0.25, 1)",
        "modal-in": "sb-modal-in 180ms cubic-bezier(0.2, 0.75, 0.25, 1)",
        "toast-in": "sb-toast-in 180ms cubic-bezier(0.2, 0.75, 0.25, 1)",
        "popover-in": "sb-popover-in 120ms cubic-bezier(0.2, 0.75, 0.25, 1)",
        "list-in": "sb-list-in 180ms cubic-bezier(0.2, 0.75, 0.25, 1)",
      },

      /**
       * Estes dois DEFAULT são o que os utilitários `transition-colors`,
       * `transition-opacity` etc. emitem quando ninguém escreve `duration-*` nem
       * `ease-*` junto — e é o caso das ~90 transições do projeto, todas de
       * hover. Os padrões do Tailwind (150ms, cubic-bezier(.4,0,.2,1)) viravam a
       * curva de movimento mais usada do produto sem que ninguém a tivesse
       * escolhido. Repontá-los aqui alinha o hover ao DS §8 numa linha, sem
       * tocar em nenhum componente.
       */
      transitionDuration: { DEFAULT: "120ms" },
      transitionTimingFunction: { DEFAULT: "cubic-bezier(0.2, 0.75, 0.25, 1)" },
    },
  },
  plugins: [],
};

export default config;
