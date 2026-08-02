import { publicEnv } from "@/lib/env";

/**
 * Content-Security-Policy em MODO RELATÓRIO (plano v3, §M8-P0).
 *
 * ============================================================================
 * O QUE ESTE ARQUIVO **NÃO** FAZ — leia antes de achar que a aplicação está
 * protegida
 * ============================================================================
 * O cabeçalho emitido é `Content-Security-Policy-Report-Only`. Report-Only
 * NÃO BLOQUEIA NADA. Um script injetado por XSS continua executando
 * exatamente como executava ontem; a única diferença é que o navegador
 * escreve uma linha no console dizendo que teria bloqueado.
 *
 * Ou seja: subir isto é seguro (não tem como quebrar a aplicação) e é
 * INÚTIL como defesa. O valor está em descobrir, com a aplicação real
 * rodando, o que a política precisa liberar ANTES de trocar o nome do
 * cabeçalho para `Content-Security-Policy` — que é o passo que de fato
 * protege e o único que pode quebrar a tela de alguém.
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
 * DÍVIDA 1 — `script-src` tem 'unsafe-inline', que é o buraco que uma CSP
 *   existe para tapar. Com ele, um XSS que injete `<script>...</script>`
 *   passa. Está aqui porque a aplicação TEM scripts inline hoje: o Next
 *   injeta o bootstrap e os dados de streaming (`self.__next_f.push`) inline
 *   em toda página, e src/app/layout.tsx injeta `themeInitScript` para
 *   aplicar o tema antes da primeira pintura. Sem 'unsafe-inline' o relatório
 *   viria cheio de violações nossas e afogaria o sinal que interessa.
 *
 *   O CAMINHO DA PROMOÇÃO (não é um "algum dia", é o pré-requisito):
 *     a) gerar um nonce aleatório por requisição no middleware;
 *     b) repassá-lo no cabeçalho da REQUISIÇÃO — o Next lê o nonce do próprio
 *        cabeçalho de CSP que chega (`app-render` aceita tanto
 *        `content-security-policy` quanto `content-security-policy-report-only`)
 *        e carimba os scripts DELE sozinho;
 *     c) carimbar o `themeInitScript` à mão — ele é nosso, o Next não sabe
 *        dele. Ou com o nonce (custa `headers()` no layout raiz, o que torna
 *        /login dinâmico) ou com um `'sha256-...'` do conteúdo exato, que
 *        continua valendo mesmo com nonce na política (hash e nonce convivem;
 *        quem some é o 'unsafe-inline');
 *     d) só então trocar o nome do cabeçalho.
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
 * Monta a política.
 *
 * É chamada uma vez por requisição no middleware, mas o resultado é constante
 * dentro do processo — por isso o middleware guarda em módulo. Fica como
 * função (e não constante exportada) porque no dia do nonce ela vai receber o
 * nonce como parâmetro.
 */
export function politicaDeSegurancaDeConteudo(): string {
  const supabase = origensDoSupabase();

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
      "'self'",
      // Ver DÍVIDA 1. Sai no dia do nonce.
      "'unsafe-inline'",
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
 * Nome do cabeçalho, isolado numa constante porque a PROMOÇÃO para bloqueio é
 * literalmente trocar esta linha por "Content-Security-Policy" — depois de
 * pagar a DÍVIDA 1. Deixá-lo visível aqui é o que torna a mudança pequena o
 * bastante para ser revisada em uma linha.
 */
export const CABECALHO_CSP = "Content-Security-Policy-Report-Only";
