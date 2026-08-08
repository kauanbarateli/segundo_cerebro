import { publicEnv } from "@/lib/env";

/**
 * ============================================================================
 * 🔴 A CHAVE DA PROMOÇÃO — vire esta constante quando os relatórios estiverem
 * limpos, e NÃO ANTES
 * ============================================================================
 * `false` → `Content-Security-Policy-Report-Only`: o navegador RELATA e não
 *           bloqueia nada. É o estado atual.
 * `true`  → `Content-Security-Policy`: passa a bloquear de verdade.
 *
 * O NONCE JÁ ESTÁ IMPLEMENTADO (E3): `'unsafe-inline'` saiu de `script-src`, e
 * cada requisição carrega um nonce próprio. Ou seja, virar esta constante é a
 * ÚNICA coisa que falta — e é justamente por isso que ela não foi virada aqui.
 *
 * POR QUE NÃO PROMOVER JUNTO COM A IMPLEMENTAÇÃO. Uma CSP em bloqueio falha do
 * pior jeito possível: o script simplesmente não roda, a tela fica parcialmente
 * morta, nenhum erro chega ao servidor e nenhum log da hospedagem registra
 * nada. Só o console do navegador de quem está usando acusa. Se algum script
 * inline escapou do nonce — uma dependência que injeta o seu, um caminho de
 * renderização que ainda não foi exercitado —, promover às cegas quebra a
 * aplicação em produção sem deixar rastro.
 *
 * O QUE FAZER ANTES DE VIRAR (é curto):
 *   1. subir com `false` e usar a aplicação em produção: Início, Tarefas,
 *      Calendário, Drive (subindo um arquivo), Cofre (destravando — é o que
 *      exercita o WASM do Argon2id), Financeiro, Conhecimento, Configurações;
 *   2. com o DevTools aberto, procurar linhas "[Report Only] Refused to ...";
 *   3. zero violações em todas as telas → virar para `true` e repetir a
 *      passagem, agora conferindo que nada parou de funcionar.
 *
 * Uma violação encontrada no passo 2 é uma diretiva a ajustar, não um motivo
 * para voltar ao `'unsafe-inline'`.
 */
export const CSP_EM_BLOQUEIO = false;

/**
 * Content-Security-Policy (plano v3, §M8-P0; nonce na E3).
 *
 * ============================================================================
 * O QUE ESTE ARQUIVO **NÃO** FAZ enquanto `CSP_EM_BLOQUEIO` for `false`
 * ============================================================================
 * O cabeçalho emitido é `Content-Security-Policy-Report-Only`. Report-Only
 * NÃO BLOQUEIA NADA. Um script injetado por XSS continua executando
 * exatamente como executava ontem; a única diferença é que o navegador
 * escreve uma linha no console dizendo que teria bloqueado.
 *
 * Ou seja: subir isto é seguro (não tem como quebrar a aplicação) e é
 * INÚTIL como defesa. O valor está em descobrir, com a aplicação real
 * rodando, o que a política precisa liberar ANTES de virar a constante acima
 * — que é o passo que de fato protege e o único que pode quebrar a tela de
 * alguém.
 *
 * ============================================================================
 * POR QUE AQUI E NÃO EM next.config.mjs (onde moram os outros 5 cabeçalhos)
 * ============================================================================
 * Dois motivos, os dois práticos:
 *
 *   1. A política precisa citar a URL do projeto Supabase, que mora em
 *      `publicEnv.supabaseUrl` (src/lib/env.ts). `next.config.mjs` é
 *      JavaScript puro e não importa TypeScript, então lá a URL seria uma
 *      SEGUNDA leitura de `process.env` — duas fontes de verdade para o mesmo
 *      valor, e a que fica em next.config.mjs é a que ninguém lembra de
 *      atualizar.
 *   2. A promoção para modo de bloqueio vai exigir um `nonce` POR REQUISIÇÃO
 *      (ver "DÍVIDA 1" abaixo). `headers()` do next.config é estático por
 *      definição; nonce só existe no middleware. Nascer aqui evita a mudança
 *      de lugar no dia da promoção, que é justamente o dia em que ninguém quer
 *      mexer em duas coisas ao mesmo tempo.
 *
 * ============================================================================
 * PARA ONDE VÃO OS RELATÓRIOS — decisão tomada: PARA O CONSOLE, e ponto
 * ============================================================================
 * Não há `report-uri` nem `report-to` nesta política, DE PROPÓSITO. As duas
 * diretivas só fazem sentido apontando para um coletor que existe; um
 * `report-uri` para uma rota inexistente produz uma segunda falha de rede a
 * cada violação e nenhum relatório em lugar nenhum — pior que não ter.
 *
 * Por que não criar o coletor: seria uma rota POST pública e NÃO AUTENTICADA
 * (o navegador manda o relatório sem cookies de sessão), ou seja, um endpoint
 * que qualquer um na internet enche de lixo — e cujo único efeito seria
 * inflar o log da hospedagem. Isto aqui é uma aplicação de UM usuário: o
 * dono é a única pessoa que abre o navegador, então o console do DevTools
 * já é o coletor, e ele é gratuito e privado.
 *
 * COMO LER, na prática: abrir o DevTools com a aplicação em produção,
 * navegar pelas telas que usam rede (Drive, Cofre, Financeiro, Configurações)
 * e procurar por linhas "[Report Only] Refused to ...". Cada uma é uma
 * diretiva que está apertada demais. Se um dia a aplicação virar multiusuário,
 * aí sim um coletor passa a valer o custo — porque as violações passariam a
 * acontecer em navegadores que o dono nunca vê.
 *
 * ============================================================================
 * DÍVIDAS CONHECIDAS (registradas para não serem descobertas na promoção)
 * ============================================================================
 * DÍVIDA 1 — PAGA na E3. `script-src` NÃO tem mais 'unsafe-inline'.
 *
 *   Como ficou, e por que são dois mecanismos e não um:
 *
 *     a) NONCE, para os scripts do Next. O middleware sorteia 16 bytes por
 *        requisição e escreve a política — já com `'nonce-...'` — no cabeçalho
 *        da REQUISIÇÃO. O Next lê o nonce de lá (`app-render` aceita tanto
 *        `content-security-policy` quanto `content-security-policy-report-only`)
 *        e carimba sozinho o bootstrap e os scripts de streaming
 *        (`self.__next_f.push`). Nonce por requisição é o que faz um script
 *        injetado não conseguir se passar por legítimo: o atacante teria de
 *        adivinhar um valor aleatório de 128 bits que muda a cada carregamento.
 *
 *     b) HASH, para o `themeInitScript` (src/app/layout.tsx). Ele é NOSSO — o
 *        Next não sabe que existe e não o carimba. A alternativa seria ler o
 *        nonce com `headers()` no layout raiz, mas isso tornaria DINÂMICA toda
 *        rota da aplicação, inclusive a /login, que hoje é estática. Um hash
 *        do conteúdo exato custa zero em runtime e não muda o modo de
 *        renderização de nada.
 *
 *   Hash e nonce convivem na mesma diretiva sem se anular. O que some é o
 *   'unsafe-inline': por especificação, o navegador o IGNORA quando há nonce
 *   ou hash presente — então mantê-lo ali seria só ruído.
 *
 * DÍVIDA 2 — `style-src` tem 'unsafe-inline' e provavelmente vai ficar. O
 *   Next injeta `<style>` inline (CSS crítico e as variáveis de
 *   `next/font/google`), e componentes usam `style={{...}}` — que vira
 *   atributo `style` e exigiria 'unsafe-hashes' + um hash por atributo, o que
 *   é impraticável de manter à mão. O risco residual é menor que o de script:
 *   CSS injetado permite exfiltração por seletor de atributo, não execução.
 *   Fingir que não existe seria pior do que escrever isto aqui.
 *
 * DÍVIDA 3 — `frame-ancestors 'none'` duplica o X-Frame-Options DENY de
 *   next.config.mjs, e isso é intencional: em Report-Only a diretiva não vale
 *   nada (a especificação manda ignorar `frame-ancestors` em relatório), então
 *   quem barra clickjacking HOJE continua sendo o X-Frame-Options. Ela está
 *   escrita para já estar certa no dia da promoção.
 */

/**
 * Origem do projeto Supabase, no formato que a CSP entende (esquema + host +
 * porta, sem caminho).
 *
 * `publicEnv.supabaseUrl` é lido por ACESSO LITERAL POR PONTO lá em
 * src/lib/env.ts — ver o comentário grande daquele arquivo. Aqui só se
 * consome o valor já resolvido; nunca `process.env[algo]`.
 *
 * Devolve lista (vazia quando não configurado) para o caso do ambiente sem
 * Supabase, que a aplicação suporta de propósito: `isSupabaseConfigured()`
 * deixa a interface renderizar em modo de setup, e uma CSP com a string
 * "undefined" no meio seria inválida — o navegador descarta a DIRETIVA
 * inteira, não só o token ruim, e connect-src viraria uma diretiva ausente.
 */
function origensDoSupabase(): string[] {
  const url = publicEnv.supabaseUrl;
  if (!url) return [];
  try {
    // `origin` já entrega "https://abc.supabase.co" sem barra final, que é
    // exatamente a forma de host-source aceita pela CSP.
    return [new URL(url).origin];
  } catch {
    // URL malformada no ambiente: melhor uma política mais apertada (que só
    // gera relatório) do que uma política inválida (que o navegador ignora).
    return [];
  }
}

/**
 * Origem do Sentry, DERIVADA do DSN — nunca escrita à mão.
 *
 * ============================================================================
 * ⚠️ POR QUE ISTO ANDA JUNTO COM A INSTALAÇÃO DO SDK
 * ============================================================================
 * O SDK do Sentry faz `fetch` para o endpoint de ingestão do projeto, e isso é
 * exatamente o que `connect-src` governa. Instalar o SDK sem tocar aqui produz
 * o pior modo de falha possível: enquanto a política estiver em Report-Only
 * tudo funciona e ninguém percebe, e no dia em que `CSP_EM_BLOQUEIO` virar
 * `true` a telemetria morre EM SILÊNCIO — sem erro na tela, sem log, só o
 * Sentry parando de receber. Descobrir isso exigiria notar a ausência de algo.
 *
 * O DSN tem a forma `https://<chave>@<org>.ingest.sentry.io/<projeto>`, então a
 * origem sai dele por construção. Derivar em vez de escrever "*.sentry.io" tem
 * dois ganhos: a política fica restrita ao HOST exato que este projeto usa, e
 * trocar de organização (ou usar Sentry auto-hospedado) não exige lembrar de
 * mudar mais nada.
 *
 * Sem DSN configurado a lista é VAZIA, e é o certo: o SDK também não inicializa
 * sem DSN (ver `sentry.client.config.ts`), então não há para onde a política se
 * abrir. Um `*.sentry.io` fixo abriria a política de todo mundo que não usa
 * Sentry — a exata categoria de permissão que a CSP existe para não dar.
 */
function origemDoSentry(): string[] {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return [];
  try {
    return [new URL(dsn).origin];
  } catch {
    // Mesma escolha de `origensDoSupabase`: uma política mais apertada é melhor
    // que uma política inválida, que o navegador descarta inteira.
    return [];
  }
}

/**
 * Hash do `themeInitScript` de src/components/theme/tema-init.ts.
 *
 * É uma CONSTANTE e não um cálculo em tempo de execução por duas razões: o
 * middleware roda no Edge, onde `crypto.subtle.digest` é assíncrono (e a
 * política é montada de forma síncrona), e recalcular a cada requisição um
 * valor que só muda quando alguém edita o script seria trabalho por nada.
 *
 * ⚠️ SE O SCRIPT DO TEMA MUDAR, ESTE VALOR PRECISA MUDAR JUNTO. Um hash
 * desatualizado não quebra nada em Report-Only — só produz uma violação no
 * relatório —, mas depois da promoção ele apaga o tema antes da primeira
 * pintura e a tela pisca em branco a cada carregamento.
 *
 * Por isso existe `csp.test.ts`, que recalcula o hash a partir do arquivo real
 * e falha apontando o valor novo. A constante não depende de ninguém lembrar.
 */
export const HASH_DO_SCRIPT_DE_TEMA = "sha256-2k/4j58eKv/7VzpSAzNLMu5o1TxQ87d1uf5F9YXeOVk=";

/**
 * Monta a política para UMA requisição.
 *
 * Recebe o nonce porque ele é, por definição, diferente a cada requisição —
 * por isso a política deixou de ser montada uma vez por processo e passou a
 * ser montada a cada chamada. É o custo real do nonce: uma concatenação de
 * strings por requisição, ao lado de um `getRandomValues` de 16 bytes.
 */
export function politicaDeSegurancaDeConteudo(nonce: string): string {
  const supabase = origensDoSupabase();
  const sentry = origemDoSentry();

  /*
    O `next dev` precisa de duas coisas que produção não precisa, e as duas
    entram SÓ em desenvolvimento:
      - 'unsafe-eval': o webpack do modo dev avalia módulos com eval para dar
        recarga rápida e stack trace decente;
      - ws://localhost:*: o canal de HMR.
    Sem esse recorte, todo relatório local viria com duas violações de
    ferramenta no topo — e relatório com ruído conhecido é relatório que
    ninguém lê.
  */
  const desenvolvimento = process.env.NODE_ENV !== "production";

  const diretivas: Record<string, string[]> = {
    // Base fechada: tudo que não tiver diretiva própria cai aqui.
    "default-src": ["'self'"],

    "script-src": [
      // Cobre os CHUNKS do Next servidos de /_next/static — arquivos externos,
      // que nonce não alcança (nonce vale para tags inline e para <script src>
      // que o próprio Next carimba).
      "'self'",
      // Os scripts inline do Next. Ver DÍVIDA 1(a).
      `'nonce-${nonce}'`,
      // O script de tema do layout raiz. Ver DÍVIDA 1(b).
      `'${HASH_DO_SCRIPT_DE_TEMA}'`,
      /*
        O Cofre deriva a chave mestra com Argon2id via `hash-wasm`
        (src/lib/crypto/vault.ts), e isso roda no NAVEGADOR — é o que mantém a
        promessa de conhecimento zero. `WebAssembly.instantiate` é bloqueado
        por uma CSP sem 'wasm-unsafe-eval', e o sintoma seria o Cofre parar de
        destrancar em produção com um erro de compilação de WASM que não
        parece ter nada a ver com CSP. Este token é a diferença entre a
        promoção funcionar e o dono perder o acesso às senhas.
      */
      "'wasm-unsafe-eval'",
      ...(desenvolvimento ? ["'unsafe-eval'"] : []),
    ],

    // Ver DÍVIDA 2.
    "style-src": ["'self'", "'unsafe-inline'"],

    /*
      `next/font/google` BAIXA a Inter em tempo de build e a serve de
      /_next/static/media — não há requisição a fonts.gstatic.com em runtime.
      Por isso 'self' basta e o domínio do Google NÃO entra aqui: liberar host
      que a aplicação não usa é ampliar a superfície de graça.
      `data:` fica porque é o formato de fonte embutida que alguma dependência
      pode trazer sem avisar; se o relatório mostrar que ninguém usa, some.
    */
    "font-src": ["'self'", "data:"],

    /*
      A foto de perfil é uma URL ASSINADA do Supabase Storage
      (src/lib/data.ts, `createSignedUrl`), servida pelo mesmo host do projeto
      — daí a origem do Supabase aqui. `blob:` e `data:` cobrem pré-visualização
      local de arquivo escolhido no seletor antes do upload.
    */
    "img-src": ["'self'", "data:", "blob:", ...supabase],

    /*
      Quem o navegador chama de verdade:
        - a própria origem (Server Actions e rotas /api);
        - o Supabase, para auth e para o UPLOAD DIRETO do Drive
          (DriveView.tsx envia o arquivo do navegador para o Storage, sem
          passar pelo servidor Next).
      As APIs do Google (googleapis.com, oauth2.googleapis.com) NÃO entram:
      todas as chamadas a elas são feitas no SERVIDOR (src/lib/google/*), onde
      CSP não tem efeito nenhum. O único contato do navegador com o Google é o
      REDIRECIONAMENTO do OAuth, que é navegação de topo — governada por
      `form-action`/`frame-ancestors`, não por `connect-src`.
      Realtime do Supabase (wss://) também não entra: o projeto não usa
      canais. Se um dia usar, o relatório vai apontar exatamente esta linha.
    */
    "connect-src": [
      "'self'",
      ...supabase,
      ...sentry,
      ...(desenvolvimento ? ["ws://localhost:*"] : []),
    ],

    // Nada de <object>/<embed>/<applet>: a aplicação não usa e são vetores
    // clássicos de execução.
    "object-src": ["'none'"],
    // Impede um <base href> injetado de sequestrar todo caminho relativo da
    // página — inclusive o dos chunks do Next.
    "base-uri": ["'self'"],
    // Nenhum formulário desta aplicação posta para fora. Vale contra o
    // "formulário de login" injetado que manda a senha para outro domínio.
    "form-action": ["'self'"],
    // Ver DÍVIDA 3.
    "frame-ancestors": ["'none'"],
    // A aplicação não embute iframes de ninguém.
    "frame-src": ["'none'"],
    // O download do Drive abre em aba nova (window.open), não em <video>/<audio>
    // embutido; `blob:` cobre pré-visualização local.
    "media-src": ["'self'", "blob:", ...supabase],
    // Workers, se algum dia existirem, só do próprio domínio. `blob:` porque é
    // como bibliotecas costumam instanciar worker embutido.
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
  };

  return Object.entries(diretivas)
    .map(([nome, valores]) => `${nome} ${valores.join(" ")}`)
    .join("; ");
}

/**
 * Nome do cabeçalho, DERIVADO de `CSP_EM_BLOQUEIO`.
 *
 * Antes era uma string literal e a promoção era editar esta linha. Agora é uma
 * consequência da constante lá em cima, e a diferença importa: o nome do
 * cabeçalho é lido em dois lugares (a resposta, que o navegador vê, e a
 * requisição, de onde o Next extrai o nonce). Com duas edições manuais em vez
 * de uma, o estado meio-promovido — resposta bloqueando, requisição ainda
 * dizendo report-only — passaria despercebido.
 */
export const CABECALHO_CSP = CSP_EM_BLOQUEIO
  ? "Content-Security-Policy"
  : "Content-Security-Policy-Report-Only";

/**
 * Sorteia o nonce da requisição: 16 bytes (128 bits) em base64.
 *
 * `crypto.getRandomValues` e nunca `Math.random()`. Um nonce previsível é um
 * nonce inútil — o atacante que consegue adivinhá-lo carimba o próprio script
 * e a CSP inteira vira decoração. É a mesma exigência de um token de sessão.
 *
 * `globalThis.crypto` existe tanto no runtime Edge (onde o middleware roda)
 * quanto no Node moderno, então não há polyfill a carregar.
 */
export function gerarNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  // `btoa` sobre a string binária: disponível nos dois runtimes, e evita
  // depender de `Buffer`, que não existe no Edge.
  return btoa(String.fromCharCode(...bytes));
}
