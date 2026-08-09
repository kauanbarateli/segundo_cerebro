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
 * com diferença de no máximo 1px nos cinco primeiros degraus.
 *
 * As alturas são pares mas nem todas múltiplas de 4. Isso é deliberado: altura
 * de linha é valor tipográfico, não token de espaçamento.
 *
 * =============================================================================
 * ⚠️ ESTA ESCALA JÁ FOI MIGRADA PARA O DS 1.0 E REVERTIDA. NÃO REFAÇA SEM LER.
 * =============================================================================
 * A migração levou os degraus aos valores do DS (meta 12, legenda 14, corpo 16,
 * corpo-forte 20, titulo 24, mais `h2` 32 e um `display` fluido de 52–80px), com
 * triagem dos 195 usos de `text-corpo` entre Body e Small. Funcionou, e foi
 * revertida por decisão de produto: a densidade do DS não serve a ESTE produto.
 *
 * O motivo é estrutural e não vai mudar sozinho. As três telas de maior uso
 * diário — a tabela de Tarefas, a semana do Calendário e o mapa de calor de
 * Hábitos — são GRADE, não texto editorial. Nelas, caber mais uma linha na tela
 * vale mais que o respiro. O DS foi desenhado a partir de uma página-documento,
 * e nessa página ele está certo; aqui ele custa ~30% de itens por rolagem.
 *
 * O que ficou da migração, e continua valendo: cor, raio, elevação, movimento,
 * espaçamento, marca e acessibilidade. Só o TAMANHO do texto voltou.
 *
 * Consequências que acompanharam a reversão, para não serem "corrigidas" por
 * engano:
 *   - `h2` e `display` saíram da escala: ficaram sem ponto de uso. Se o título
 *     editorial voltar, os dois precisam voltar com ele.
 *   - `text-sm`, `text-lg` e `text-xl` voltaram ao código. Eles foram
 *     consolidados durante a migração e desconsolidados junto — `text-sm` (14px)
 *     não tem degrau nomeado equivalente nesta escala.
 *   - O piso da semana do Calendário voltou de 900px para 760px.
 *   - `Logotipo.tsx` deixou de tirar o tamanho da palavra desta escala e passou
 *     a derivá-lo do lado do símbolo. Foi o único defeito real que a reversão
 *     expôs: uma decisão sobre corpo de texto de interface estava deformando a
 *     marca. Não desfaça.
 *
 * ATENÇÃO ao mexer aqui: usamos `theme.extend.fontSize`, NUNCA `theme.fontSize`.
 * Substituir a chave inteira apagaria a escala padrão do Tailwind, e o projeto
 * usa `text-sm`, `text-lg`, `text-xl`, `text-2xl` e `text-4xl` em várias telas —
 * todas quebrariam de uma vez, silenciosamente (a classe simplesmente deixa de
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

        /**
         * CATEGÓRICAS — a paleta dos gráficos do Financeiro. Ver o bloco de
         * contraste medido em globals.css.
         *
         * Não são semânticas e não têm degrau `-ink`: elas nunca viram texto.
         * O rótulo ao lado da fatia é `text-ink` normal, e a cor entra só como
         * preenchimento (`bg-cat-*` no ponto da legenda, `fill-cat-*` no arco da
         * rosca) — que é o papel para o qual o piso de 3:1 foi medido.
         *
         * ⚠️ As classes precisam ser LITERAIS no código. `bg-cat-${chave}`
         * montado em tempo de execução não é encontrado pela varredura do
         * Tailwind, a regra não entra no CSS final e a cor simplesmente não
         * existe — sem erro, sem aviso, e só na build de produção. Ver o mapa
         * fechado em `src/lib/finance-colors.ts`.
         */
        "cat-stone": "rgb(var(--sb-cat-stone) / <alpha-value>)",
        "cat-indigo": "rgb(var(--sb-cat-indigo) / <alpha-value>)",
        "cat-ciano": "rgb(var(--sb-cat-ciano) / <alpha-value>)",
        "cat-teal": "rgb(var(--sb-cat-teal) / <alpha-value>)",
        "cat-oliva": "rgb(var(--sb-cat-oliva) / <alpha-value>)",
        "cat-terracota": "rgb(var(--sb-cat-terracota) / <alpha-value>)",
        "cat-rosa": "rgb(var(--sb-cat-rosa) / <alpha-value>)",
        "cat-violeta": "rgb(var(--sb-cat-violeta) / <alpha-value>)",
      },

      /**
       * Escala tipográfica nomeada. Ver o bloco 1 no topo do arquivo.
       *
       * ⚠️ ESTES SÃO OS TAMANHOS ORIGINAIS DO PROJETO, e a reversão foi
       * deliberada. A migração para o Design System 1.0 levou esta escala aos
       * degraus do DS (12/14/16/20/24/32 + display fluido) e ela foi REVERTIDA
       * a pedido: a densidade do DS não serve a este produto, que é feito de
       * tabela, agenda e grade — superfícies onde caber mais linha na tela vale
       * mais do que o respiro editorial. Todas as OUTRAS decisões do DS (cor,
       * raio, elevação, movimento, espaçamento, marca, acessibilidade)
       * continuam valendo; só o tamanho do texto voltou.
       *
       * Consequência a não esquecer: os degraus `h2` e `display` saíram junto,
       * porque ficaram sem nenhum ponto de uso. Se algum dia o título editorial
       * do DS voltar, os dois precisam voltar com ele — não basta a classe.
       *
       * A forma [tamanho, { lineHeight }] faz o Tailwind emitir font-size e
       * line-height na MESMA regra — é o que garante que não volte a existir
       * tamanho de texto sem entrelinha declarada.
       */
      fontSize: {
        micro: ["10px", { lineHeight: "14px" }],
        meta: ["11px", { lineHeight: "16px" }],
        legenda: ["12px", { lineHeight: "18px" }],
        corpo: ["13px", { lineHeight: "20px" }],
        "corpo-forte": ["15px", { lineHeight: "22px" }],
        titulo: ["22px", { lineHeight: "28px", letterSpacing: "-0.01em" }],

        /**
         * ⚠️ MÉTRICA DE CONTROLE, NÃO DEGRAU DE TEXTO. Não use em parágrafo,
         * rótulo, título ou célula — o corpo da interface é `text-corpo`.
         *
         * Existe por um motivo funcional e não estético: o Safari do iOS DÁ
         * ZOOM ao focar um campo com texto menor que 16px, e o zoom não volta
         * sozinho — a pessoa termina de preencher o formulário com a página
         * deslocada de lado. É o piso do navegador, não uma escolha nossa.
         *
         * Por isso ele NÃO acompanhou a reversão dos tamanhos: o estado
         * anterior tinha os ~40 campos do produto em 14px e, com eles, o
         * defeito. Reverter aqui teria trocado um bug de celular por 2px de
         * densidade em formulário — e formulário não é a superfície densa que
         * motivou a reversão (as densas são tabela, agenda e grade).
         *
         * Só `ui/estilos.ts` deve consumir. Ver o cabeçalho de lá.
         */
        campo: ["16px", { lineHeight: "24px" }],
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

        /* ------------------------------------------------------------- saída
         *
         * ⚠️ EXISTIAM CINCO ENTRADAS E NENHUMA SAÍDA, e a assimetria era
         * perceptível justamente porque a entrada existe: o modal nascia
         * subindo e desaparecia por corte seco. O olho aprende o movimento na
         * abertura e estranha a ausência dele no fechamento.
         *
         * São a entrada INVERTIDA, e nada além disso — mesma distância, mesma
         * direção, mesma curva. Uma saída com desenho próprio (encolher, deslizar
         * para o lado) seria movimento novo para aprender, e o objetivo aqui é
         * o oposto: que ninguém repare.
         *
         * SÃO MAIS RÁPIDAS QUE A ENTRADA — 120ms contra 180ms. Não é
         * inconsistência: na abertura a animação acompanha algo que a pessoa
         * está esperando ver; no fechamento ela ATRASA algo que a pessoa já
         * decidiu descartar. Saída lenta é a forma mais comum de uma interface
         * animada parecer travada.
         *
         * `visibility: hidden` no quadro final impede que o nó, ainda montado
         * durante os 120ms, continue capturando clique — um véu invisível e
         * clicável seria pior que não animar.
         */
        "sb-fade-out": {
          from: { opacity: "1" },
          to: { opacity: "0", visibility: "hidden" },
        },
        "sb-modal-out": {
          from: { opacity: "1", transform: "translateY(0)" },
          to: { opacity: "0", transform: "translateY(8px)", visibility: "hidden" },
        },
        "sb-toast-out": {
          from: { opacity: "1", transform: "translateY(0)" },
          to: { opacity: "0", transform: "translateY(8px)", visibility: "hidden" },
        },
        "sb-popover-out": {
          from: { opacity: "1", transform: "translateY(0)" },
          to: { opacity: "0", transform: "translateY(-4px)", visibility: "hidden" },
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

        /*
          Saída em 120ms — mais rápida que a entrada, de propósito. Ver os
          keyframes acima.

          `forwards` é OBRIGATÓRIO aqui e não era nas entradas: sem ele o
          elemento volta ao estado inicial (opaco, visível) no instante em que a
          animação termina, e o resultado é um PISCA — ele desaparece e reaparece
          por um quadro antes de ser desmontado. As entradas não precisam porque
          o quadro final delas já é o estado natural do elemento.
        */
        "overlay-out": "sb-fade-out 120ms cubic-bezier(0.2, 0.75, 0.25, 1) forwards",
        "modal-out": "sb-modal-out 120ms cubic-bezier(0.2, 0.75, 0.25, 1) forwards",
        "toast-out": "sb-toast-out 120ms cubic-bezier(0.2, 0.75, 0.25, 1) forwards",
        "popover-out": "sb-popover-out 120ms cubic-bezier(0.2, 0.75, 0.25, 1) forwards",
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
