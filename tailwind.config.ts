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
 * 1. ESCALA TIPOGRÁFICA
 * -----------------------------------------------------------------------------
 * A interface usava 230 tamanhos arbitrários (`text-[13px]`, `text-[12px]`…)
 * espalhados por 34 arquivos. Tamanho arbitrário tem dois defeitos: ninguém
 * consegue responder "qual é o tamanho do texto secundário?" sem abrir o arquivo,
 * e — o que é pior — `text-[13px]` define APENAS font-size. A altura de linha
 * ficava por conta do `line-height: 1.5` que o preflight do Tailwind põe no
 * <html>, ou seja, um número herdado que ninguém escolheu.
 *
 * A escala abaixo nomeia os seis tamanhos que o projeto REALMENTE usa — nenhum
 * degrau foi inventado para o futuro — e cada um leva sua altura de linha junto.
 *
 *   text-micro       10px / 14px   contador em chip, rótulo de canto
 *   text-meta        11px / 16px   metadado, sobrescrito, rótulo maiúsculo
 *   text-legenda     12px / 18px   legenda, texto de apoio, distintivo
 *   text-corpo       13px / 20px   CORPO PADRÃO da interface (o mais usado)
 *   text-corpo-forte 15px / 22px   corpo em destaque: título de cartão, de modal
 *   text-titulo      22px / 28px   título de documento (editor de conhecimento)
 *
 * Por que estas alturas de linha e não outras: elas reproduzem quase exatamente
 * o que a tela já mostrava (o 1.5 herdado dava 15 / 16.5 / 18 / 19.5 / 22.5 / 33),
 * com diferença de no máximo 1px nos cinco primeiros degraus. A troca das 230
 * classes, portanto, NÃO foi um redesenho disfarçado. A única mudança real é o
 * `text-titulo`: 33px de altura de linha num tamanho de 22px é entrelinha de
 * parágrafo aplicada a um título, e ela aperta para 28px de propósito.
 *
 * As alturas são pares mas nem todas múltiplas de 4. Isso é deliberado: altura
 * de linha é valor tipográfico, não token de espaçamento. Forçar 10px e 12px ao
 * grid de 4pt obrigaria a escolher entre 12px (1.2, apertado demais para leitura)
 * e 16px (1.6, frouxo demais para rótulo de uma linha) — o grid ganharia e a
 * legibilidade perderia.
 *
 * ATENÇÃO ao mexer aqui: usamos `theme.extend.fontSize`, NUNCA `theme.fontSize`.
 * Substituir a chave inteira apagaria a escala padrão do Tailwind, e o projeto
 * ainda usa `text-sm`, `text-lg` e `text-xl` em várias telas — todas quebrariam
 * de uma vez, silenciosamente (a classe simplesmente deixa de existir e o texto
 * volta ao tamanho herdado, sem nenhum erro de build).
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
 *   3  (12px)  separação interna de um bloco: rótulo e campo, linhas de lista
 *   4  (16px)  respiro entre blocos distintos dentro do mesmo cartão
 *   5  (20px)  padding interno de cartão e de modal (é o `p-5` de hoje)
 *   6  (24px)  distância entre seções de uma página
 *   8+ (32px+) separação entre regiões grandes; acima disso, use 12 (48px)
 *
 * Degraus fora dessa lista (`p-2.5`, `gap-1.5`, `py-0.5`) existem no código e
 * continuam válidos onde o alvo é ALTURA DE CONTROLE, não ritmo de layout — um
 * botão de 30px precisa de `py-1.5`, e arredondar para `py-2` mudaria a altura do
 * controle. A regra é sobre ritmo vertical, não sobre métrica de componente.
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
 * baixo). Mais sombras não deixariam a hierarquia mais legível, deixariam mais
 * barulhenta. Ver `Card` em src/components/ui/Card.tsx, que é onde os níveis 1 a
 * 3 viram código.
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
      colors: {
        canvas: "rgb(var(--sb-canvas) / <alpha-value>)",
        surface: "rgb(var(--sb-surface) / <alpha-value>)",
        "surface-muted": "rgb(var(--sb-surface-muted) / <alpha-value>)",
        ink: "rgb(var(--sb-ink) / <alpha-value>)",
        "ink-muted": "rgb(var(--sb-ink-muted) / <alpha-value>)",
        "ink-subtle": "rgb(var(--sb-ink-subtle) / <alpha-value>)",
        line: "rgb(var(--sb-line) / <alpha-value>)",
        "line-strong": "rgb(var(--sb-line-strong) / <alpha-value>)",
        accent: "rgb(var(--sb-accent) / <alpha-value>)",
        "accent-ink": "rgb(var(--sb-accent-ink) / <alpha-value>)",
      },

      /**
       * Escala tipográfica nomeada. Ver o bloco 1 no topo do arquivo.
       *
       * A forma [tamanho, { lineHeight }] faz o Tailwind emitir font-size e
       * line-height na MESMA regra — é o que garante que não volte a existir
       * tamanho de texto sem entrelinha declarada.
       *
       * `letterSpacing` aparece só no `titulo`. Nos tamanhos pequenos, apertar ou
       * soltar o espaçamento entre letras mudaria a largura de 230 elementos já
       * posicionados; no título de 22px o ajuste ótico é necessário, e o único
       * lugar que usa esse degrau já pedia `tracking-tight` na mão.
       */
      fontSize: {
        micro: ["10px", { lineHeight: "14px" }],
        meta: ["11px", { lineHeight: "16px" }],
        legenda: ["12px", { lineHeight: "18px" }],
        corpo: ["13px", { lineHeight: "20px" }],
        "corpo-forte": ["15px", { lineHeight: "22px" }],
        titulo: ["22px", { lineHeight: "28px", letterSpacing: "-0.01em" }],
      },

      borderRadius: {
        sm: "8px",
        DEFAULT: "10px",
        md: "12px",
        lg: "14px",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "system-ui", "sans-serif"],
      },

      /**
       * Duas sombras, quatro níveis de elevação. Ver o bloco 3 no topo.
       * `subtle` é o cartão pousado na página; `raised` é o que flutua sobre ela.
       */
      boxShadow: {
        subtle: "0 1px 2px rgb(0 0 0 / 0.04), 0 1px 3px rgb(0 0 0 / 0.03)",
        raised: "0 4px 16px rgb(0 0 0 / 0.06)",
      },

      /**
       * -----------------------------------------------------------------------
       * MOVIMENTO
       * -----------------------------------------------------------------------
       * Até aqui a interface só tinha `transition-colors`: nada nascia, tudo
       * simplesmente aparecia. O que faltava não é enfeite, é ORIGEM — o modal
       * subindo diz "eu vim do botão que você clicou"; o toast subindo do rodapé
       * diz "eu não estava aqui antes". Deslocamentos de 4 a 8px e durações de
       * 120 a 200ms: perceptível, nunca esperado.
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
       * Curvas: `ease-out` para o que é pequeno e rápido; a cúbica (0.16, 1, 0.3,
       * 1) para modal e toast, que percorrem mais distância — ela chega rápido e
       * desacelera no fim, que é o que faz o elemento parecer POUSAR em vez de
       * frear.
       */
      animation: {
        "overlay-in": "sb-fade-in 140ms ease-out",
        "modal-in": "sb-modal-in 180ms cubic-bezier(0.16, 1, 0.3, 1)",
        "toast-in": "sb-toast-in 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        "popover-in": "sb-popover-in 120ms ease-out",
        "list-in": "sb-list-in 180ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
