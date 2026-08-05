// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * O ÚNICO teste de render do projeto, e ele existe por um motivo específico.
 *
 * O módulo do Conhecimento ficou inteiramente inacessível — toda página abria na
 * tela de erro — e NADA pegou: `tsc --noEmit` limpo, `next lint` limpo, as ~450
 * asserções da suíte verdes. Não foi descuido: os overloads de `useEditor`
 * prometem `Editor` não-nulo justamente na configuração que devolve `null` em
 * tempo de execução, então o compilador estava conferindo um contrato que a
 * biblioteca não cumpre nesse caminho. A única coisa capaz de pegar isso é
 * MONTAR o componente.
 *
 * ⚠️ E montar não basta: é preciso montar SOB A CONDIÇÃO DO BUG.
 *
 * O TipTap decide se cria o editor na hora ou devolve `null` olhando
 * `window.next`, e faz isso UMA VEZ, no escopo do módulo:
 *
 *     var isNext = isSSR || Boolean(typeof window !== "undefined" && window.next);
 *
 * Duas consequências que mandam na forma deste arquivo:
 *
 *   1. Sem `window.next`, o TipTap acha que não está no Next, cria o editor
 *      normalmente e O TESTE PASSA MESMO COM O BUG PRESENTE. Um teste assim é
 *      pior que nenhum: dá a impressão de cobertura.
 *   2. Como a leitura é no escopo do módulo, definir a global depois do `import`
 *      não adianta. Por isso NÃO há `import` estático do componente aqui — os
 *      imports são içados para antes de qualquer código, e o componente puxa
 *      `@tiptap/react` junto. O `await import()` lá embaixo é o que garante a
 *      ordem: primeiro a global, depois o módulo.
 */

/** A marca que o Next põe na janela (`next/dist/client/app-bootstrap.js`). */
function fingirEstarNoNext() {
  (window as unknown as { next?: unknown }).next = { version: "15", appDir: true };
}

/**
 * `updatePageContent` é Server Action: importá-la de verdade arrastaria o
 * cliente do Supabase e `next/cache` para dentro do teste. Nada aqui chega a
 * salvar — o autosave só dispara com texto digitado.
 */
vi.mock("@/app/(app)/conhecimento/actions", () => ({
  updatePageContent: vi.fn(async () => ({ ok: true as const, data: { updatedAt: "2026-01-01" } })),
}));

beforeAll(() => {
  fingirEstarNoNext();
  // Diz ao React que este ambiente sabe processar `act()`. Sem isto ele avisa a
  // cada render, e o aviso some no meio da saída — inclusive o dia em que for um
  // aviso de verdade.
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // O ProseMirror mede a seleção ao montar. O jsdom tem `Range`, mas não
  // implementa as medições — e sem elas a montagem estoura antes de chegar ao
  // que este teste quer observar. Zeros bastam: o assunto aqui é "montou?", não
  // layout.
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () =>
      Object.assign([] as unknown as DOMRectList, { item: () => null });
    Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

const PAGINA = {
  pageId: "11111111-1111-4111-8111-111111111111",
  titulo: "Página de teste",
  conteudo: { type: "doc", content: [{ type: "paragraph" }] },
  atualizadoEm: "2026-01-01T00:00:00.000Z",
};

describe("EditorDePagina", () => {
  it("monta com window.next definido — a condição exata em que o TipTap devolve null", async () => {
    // A ordem importa: a global já foi posta no `beforeAll`, e só agora o módulo
    // (e com ele o `@tiptap/react`) é carregado.
    const { createElement } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const { default: EditorDePagina } = await import("./Editor");

    const raiz = document.createElement("div");
    document.body.appendChild(raiz);
    const root = createRoot(raiz);

    // Sem `immediatelyRender: true` isto lança
    // `TypeError: Cannot read properties of null (reading 'isActive')`,
    // vindo do seletor do `useEditorState` — que roda DURANTE a renderização,
    // não num efeito. É por isso que o `expect` é sobre o ato de renderizar.
    await act(async () => {
      root.render(createElement(EditorDePagina, PAGINA));
    });

    // A área editável do ProseMirror existir prova que o editor foi criado de
    // fato, e não que o React apenas engoliu a exceção em algum lugar.
    expect(raiz.querySelector(".sb-editor-conteudo")).not.toBeNull();
    // E os `aria-pressed` da barra saírem preenchidos prova que o seletor do
    // `useEditorState` — o ponto exato onde a exceção nascia — chegou a produzir
    // estado. `data-ferramenta` sem `aria-pressed` significaria barra pintada
    // com o editor ainda nulo.
    const negrito = raiz.querySelector('button[data-ferramenta][aria-label="Negrito"]');
    expect(negrito?.getAttribute("aria-pressed")).toBe("false");

    expect(raiz.querySelector<HTMLInputElement>("#titulo-da-pagina")?.value).toBe(
      "Página de teste",
    );

    await act(async () => {
      root.unmount();
    });
    raiz.remove();
  });

  it("window.next continua definido — se esta asserção cair, o teste acima virou fachada", () => {
    expect((window as unknown as { next?: unknown }).next).toBeDefined();
  });
});

/*
 * O contrato do TipTap sobre `editor.view` antes de a view montar mora em
 * `tiptap-view.test.ts`, ao lado. Ele NÃO pode ficar aqui: este arquivo roda em
 * jsdom, e com um DOM disponível o TipTap consegue montar a view mesmo sem
 * `element` — o estado a testar deixa de existir e os casos viram fachada.
 */
