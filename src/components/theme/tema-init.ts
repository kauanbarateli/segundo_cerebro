/**
 * =============================================================================
 * O SCRIPT QUE APLICA O TEMA ANTES DA PRIMEIRA PINTURA
 * =============================================================================
 *
 * ⚠️ POR QUE ESTA CONSTANTE MORA AQUI, E NÃO EM `ThemeToggle.tsx`
 *
 * Ela morava lá, e estava QUEBRADA — silenciosamente, do jeito que este projeto
 * mais teme. `ThemeToggle.tsx` tem "use client"; `src/app/layout.tsx` é
 * Componente de Servidor. Um módulo de cliente importado por um componente de
 * servidor não entrega VALORES: o next-flight-loader substitui cada export por
 * uma referência de cliente. O que o layout raiz recebia era isto, tirado do
 * bundle de verdade:
 *
 *   const themeInitScript = registerClientReference(
 *     function() { throw new Error("Attempted to call themeInitScript() from
 *     the server but themeInitScript is on the client. …"); }, …);
 *
 * E `dangerouslySetInnerHTML` faz `'' + __html`, que numa função é o CÓDIGO-
 * FONTE dela. O `<head>` recebia, a cada requisição:
 *
 *   <script>function() { throw new Error("Attempted to call …"); }</script>
 *
 * que o navegador nem chega a executar — `function() {…}` como instrução é
 * SyntaxError ("Function statements require a function name"). Resultado: o
 * tema nunca era aplicado antes da pintura e a tela piscava clara antes de
 * escurecer, exatamente o defeito que o script existe para impedir. Nada
 * quebrava alto: sem erro de compilação, sem teste vermelho, sem exceção no
 * servidor. Só o pisca-pisca.
 *
 * De quebra, o hash da CSP (`HASH_DO_SCRIPT_DE_TEMA` em src/lib/csp.ts) é
 * calculado sobre o texto REAL do script — então o que era servido também não
 * batia com a política. Dois defeitos, uma causa.
 *
 * A regra, escrita por extenso porque ela vale para todo script deste tipo:
 * CONSTANTE PARTILHADA ENTRE SERVIDOR E CLIENTE FICA EM MÓDULO SEM DIRETIVA.
 * É a mesma decisão, pelo mesmo motivo, de
 * `src/components/layout/sidebar-preferencia.tsx` — que documenta a regra e a
 * cumpre. Este arquivo é a segunda ocorrência dela.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ AO EDITAR O SCRIPT, O HASH DA CSP MUDA JUNTO
 * -----------------------------------------------------------------------------
 * `src/lib/csp.test.ts` lê ESTE arquivo, extrai a string com uma expressão
 * regular ancorada na declaração de `themeInitScript` e recalcula o sha256. Se
 * o teste falhar, ele imprime o valor novo — copie-o para
 * `HASH_DO_SCRIPT_DE_TEMA` em src/lib/csp.ts.
 *
 * Três consequências práticas dessa regex, todas já pagas uma vez:
 *
 *   1. a declaração precisa continuar sendo UMA atribuição delimitada por
 *      crases;
 *   2. a string NÃO pode interpolar — o que a regex captura é o texto do
 *      template, não o valor, e o hash sairia de um conteúdo que nunca é
 *      servido;
 *   3. NENHUM comentário deste arquivo pode repetir a declaração por extenso.
 *      A regex é preguiçosa e casa a PRIMEIRA ocorrência: uma citação em prosa
 *      passa a ser o que ela mede, e o hash vira o de um trecho de comentário.
 *      Foi exatamente o que aconteceu ao escrever este cabeçalho.
 */

/** Chave do localStorage. Mesmo prefixo `sb-` de `sb-sidebar`. */
export const CHAVE_TEMA = "sb-theme";

/**
 * Roda no `<head>`, antes da pintura, para evitar o flash de tema errado.
 *
 * IIFE de uma linha e tudo dentro de try/catch: `localStorage` LANÇA — não
 * devolve `null` — quando o armazenamento está bloqueado (modo privado, cookies
 * de terceiros desligados). Sem o catch, a exceção interromperia o parser no
 * meio do `<head>` e a aplicação inteira sumiria por causa de uma preferência
 * de cor.
 *
 * `sb-theme` está escrito à mão aqui, e não como `${CHAVE_TEMA}`, por causa da
 * regex do teste de CSP descrita no topo do arquivo.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('sb-theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var dark=t==='dark'||((!t||t==='system')&&m);document.documentElement.classList.toggle('dark',dark);}catch(e){}})();`;
