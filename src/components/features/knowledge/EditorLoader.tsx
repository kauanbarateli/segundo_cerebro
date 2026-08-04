"use client";

import dynamic from "next/dynamic";
import type { EditorDePaginaProps } from "./Editor";

/**
 * FRONTEIRA DE CARREGAMENTO DO EDITOR. Importe DAQUI, nunca de `./Editor`.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------
 * `./Editor` arrasta ProseMirror, TipTap e highlight.js: ~150 kB de JavaScript
 * que só fazem sentido em `/conhecimento/pagina/<id>`. Um `import` ESTÁTICO
 * desse módulo em qualquer componente faria o empacotador colocá-lo no grafo do
 * bundle comum — e o Next serve o bundle comum em TODA rota. `/tarefas`,
 * `/calendario`, `/login`: todas passariam a baixar um editor de texto que nunca
 * vão mostrar.
 *
 * Isso não é só desperdício, é REGRESSÃO DIRETA da correção C1 da Fase 1 (a
 * lentidão ao alternar entre abas). O critério de pronto desta fase é que o
 * "First Load JS" das rotas que não são `/conhecimento` fique INALTERADO, e a
 * única coisa que garante isso é o `import()` dentro do `dynamic` abaixo: uma
 * chamada de função, não uma dependência estática, o que faz o empacotador
 * emitir um chunk separado buscado só quando o componente aparece na tela.
 *
 * POR QUE `ssr: false`
 * --------------------
 * Duas razões, e a segunda é a que impede o arquivo de ser "simplificado":
 *
 *   1. O ProseMirror monta sobre um `contenteditable` e mede o DOM. Renderizar
 *      no servidor produziria uma árvore que o cliente descarta e remonta na
 *      hidratação — trabalho dobrado e divergência de hidratação.
 *   2. `ssr: false` é o que mantém o módulo FORA do bundle do servidor e fora do
 *      payload de hidratação da rota. Com `ssr: true` o Next precisa do
 *      componente já no primeiro render do cliente, e boa parte do ganho de
 *      separar o chunk evapora.
 *
 * `ssr: false` só é permitido em Componente de Cliente — daí o `"use client"` no
 * topo. É exatamente por isso que esta camada é um arquivo próprio: a página em
 * `(app)/conhecimento/pagina/[pageId]/page.tsx` é Componente de Servidor e não
 * poderia declarar o `dynamic` ela mesma.
 *
 * ⚠️ E há uma TERCEIRA razão, que não é de desempenho: `./Editor` passa
 * `immediatelyRender: true` ao `useEditor`, e essa flag só é correta porque o
 * componente nunca renderiza no servidor. Tirar o `ssr: false` daqui obriga a
 * tirar aquela flag lá — e o inverso também vale. As duas linhas são uma decisão
 * só, escrita em dois arquivos.
 *
 * O TIPO CRUZA A FRONTEIRA, O CÓDIGO NÃO
 * --------------------------------------
 * `import type` é apagado na compilação e não cria aresta no grafo de módulos, e
 * é por isso que ele pode apontar para `./Editor` sem anular tudo o que está
 * escrito acima. Se um dia alguém precisar de um VALOR daquele arquivo aqui, a
 * resposta certa é mover o valor para um terceiro módulo sem dependências — não
 * trocar `import type` por `import`.
 */
const Editor = dynamic(() => import("./Editor"), {
  ssr: false,
  /**
   * Reserva de espaço com a MESMA altura da área de edição (`.sb-editor-area`,
   * definida em `globals.css`). Sem ela a página nasceria curta e daria um
   * salto quando o chunk chegasse — justo enquanto o usuário já está lendo o
   * breadcrumb ou mirando um link da barra lateral.
   */
  loading: () => (
    <div className="rounded-md border border-line bg-surface" aria-hidden="true">
      <div className="border-b border-line px-5 pb-3 pt-4">
        <div className="h-7 w-1/2 rounded-sm bg-surface-muted" />
      </div>
      <div className="border-b border-line px-3 py-2">
        <div className="h-8 w-full max-w-sm rounded-sm bg-surface-muted" />
      </div>
      <div className="sb-editor-area space-y-3 px-5 py-4">
        <div className="h-4 w-full rounded-sm bg-surface-muted" />
        <div className="h-4 w-11/12 rounded-sm bg-surface-muted" />
        <div className="h-4 w-4/6 rounded-sm bg-surface-muted" />
      </div>
      <div className="border-t border-line px-5 py-2.5">
        <div className="h-3 w-24 rounded-sm bg-surface-muted" />
      </div>
    </div>
  ),
});

export type { EditorDePaginaProps };
export default Editor;
