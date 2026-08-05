import { describe, expect, it } from "vitest";

/**
 * CONTRATO COM O TIPTAP — a armadilha que derrubou o Conhecimento pela terceira vez.
 *
 * Este arquivo não testa código nosso: testa a BIBLIOTECA. Ele existe porque as
 * guardas `isInitialized` de `Editor.tsx` se apoiam em comportamento que nenhuma
 * ferramenta estática consegue verificar.
 *
 * =============================================================================
 * O QUE ACONTECEU
 * =============================================================================
 * Abrir uma página mostrava a tela de erro do módulo, e o "Tentar novamente"
 * funcionava — o editor abria e escrevia normalmente. No console:
 *
 *   [tiptap error]: The editor view is not available.
 *   Cannot access view['dom']. The editor may not be mounted yet.
 *
 * A linha culpada era `const dom = editor.view?.dom`, e o `?.` NÃO PROTEGIA NADA.
 * Antes de a view existir, `editor.view` não é `undefined`: é um **Proxy**. Um
 * objeto — portanto truthy — portanto o encadeamento opcional passa direto, e
 * quem lança é o acesso à propriedade seguinte.
 *
 * O Proxy finge ter só um punhado de chaves (`dispatch`, `composing`,
 * `dragging`, `editable`, `isDestroyed`, `state`). `dom` e `coordsAtPos` não
 * estão entre elas.
 *
 * E o compilador não tinha como ajudar: o tipo declarado é
 * `get view(): EditorView`, não-nulo. Para o TypeScript, o `?.` era redundante.
 *
 * =============================================================================
 * POR QUE ESTE ARQUIVO RODA EM NODE, E NÃO EM JSDOM
 * =============================================================================
 * Não há pragma de ambiente aqui de propósito: `vitest.config.ts` usa `node` por
 * padrão, e é o que este teste precisa.
 *
 * Com um DOM disponível, o TipTap consegue montar a view mesmo sem receber
 * `element` — o estado "instância existe, view não" simplesmente não acontece, e
 * as asserções abaixo passariam a testar o oposto do que descrevem. A primeira
 * versão destes casos foi escrita em `Editor.test.tsx` (jsdom) e falhou por
 * exatamente isso; a correção foi mudar de ambiente, NÃO afrouxar a asserção.
 *
 * =============================================================================
 * ⚠️ `isInitialized` É CONSERVADOR, E ISSO É DE PROPÓSITO
 * =============================================================================
 * O Proxy consulta um campo interno (`editorView`) que NÃO é o mesmo que
 * `isInitialized`. Existe janela em que a view já foi criada e a flag ainda é
 * falsa — foi o que este arquivo revelou ao rodar em jsdom.
 *
 * A consequência é que a guarda erra para o lado seguro: pode pular trabalho
 * quando a view já estava disponível. Isso é aceitável porque as duas coisas que
 * ela protege — os atributos ARIA do menu e o posicionamento do menu de "/" —
 * são recalculadas na próxima renderização ou na próxima transação. O erro
 * inverso, tocar na view cedo demais, derruba o módulo inteiro.
 *
 * SE ALGUM CASO ABAIXO FALHAR depois de atualizar o TipTap, não conserte o
 * teste: vá reler as guardas em `Editor.tsx`, porque o chão delas mudou.
 */

async function editorSemView() {
  // Sem `element` e sem DOM no ambiente, a instância existe e a view não —
  // exatamente a janela que `immediatelyRender: true` abre no primeiro render.
  const [{ Editor }, { default: StarterKit }] = await Promise.all([
    import("@tiptap/core"),
    import("@tiptap/starter-kit"),
  ]);
  return new Editor({
    extensions: [StarterKit.configure({ codeBlock: false })],
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
}

describe("contrato do TipTap: editor.view antes de a view montar", () => {
  it("`isInitialized` é false — é a guarda que Editor.tsx usa", async () => {
    const editor = await editorSemView();
    expect(editor.isInitialized).toBe(false);
    editor.destroy();
  });

  it("`editor.view` é TRUTHY nesse estado — a prova de que `?.` não protege", async () => {
    const editor = await editorSemView();
    // Se um dia isto virar `undefined`, o `?.` passaria a funcionar e o aviso
    // longo em Editor.tsx deixaria de descrever a realidade.
    expect(editor.view).toBeTruthy();
    editor.destroy();
  });

  it("acessar `.dom` LANÇA — era este o erro que chegava ao usuário", async () => {
    const editor = await editorSemView();
    expect(() => editor.view.dom).toThrow(/editor view is not available/i);
    editor.destroy();
  });

  it("`coordsAtPos` também lança — o segundo ponto, que era defeito latente", async () => {
    const editor = await editorSemView();
    // `sincronizarMenu` chamava isto sem guarda. Nunca chegou a estourar em uso
    // real porque o menu de "/" só abre com o editor já montado — mas era o
    // mesmo defeito esperando a vez.
    expect(() => editor.view.coordsAtPos(1)).toThrow(/editor view is not available/i);
    editor.destroy();
  });
});
