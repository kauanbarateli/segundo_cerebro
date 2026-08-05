import { describe, expect, it } from "vitest";
import {
  DOCUMENTO_VAZIO,
  achatarVisiveis,
  caminhoDaPagina,
  descendentesDe,
  destacarOcorrencias,
  mesmoDocumento,
  montarArvore,
  normalizarDocumento,
  posicaoEntre,
  reconciliarPagina,
  rotuloDaPagina,
  semAcento,
} from "./knowledge";
import { knowledgePageContentSchema, prosemirrorDocSchema } from "./validation";
import type { KnowledgePageSummary } from "./database.types";

const CADERNO = "11111111-2222-4333-8444-555555555555";

function pagina(
  id: string,
  parentId: string | null,
  position = 0,
  title = `p-${id}`,
): KnowledgePageSummary {
  return {
    id,
    notebook_id: CADERNO,
    parent_id: parentId,
    title,
    position,
    updated_at: "2026-08-02T12:00:00.000000+00:00",
  };
}

describe("montarArvore", () => {
  it("pendura cada filha na mãe e calcula a profundidade", () => {
    const arvore = montarArvore([
      pagina("a", null, 1),
      pagina("b", "a", 2),
      pagina("c", "b", 3),
      pagina("d", null, 4),
    ]);

    expect(arvore.map((n) => n.id)).toEqual(["a", "d"]);
    expect(arvore[0]!.depth).toBe(0);
    expect(arvore[0]!.children[0]!.id).toBe("b");
    expect(arvore[0]!.children[0]!.depth).toBe(1);
    expect(arvore[0]!.children[0]!.children[0]!.depth).toBe(2);
  });

  it("preserva a ordem que veio do banco entre irmãs", () => {
    const arvore = montarArvore([
      pagina("mae", null, 1),
      pagina("x", "mae", 10),
      pagina("y", "mae", 20),
      pagina("z", "mae", 30),
    ]);
    expect(arvore[0]!.children.map((n) => n.id)).toEqual(["x", "y", "z"]);
  });

  it("promove ao topo a página cuja mãe não está na lista", () => {
    // Mãe apagada (soft delete) ou fora do recorte: sem a promoção, esta página
    // sumiria da barra lateral sem erro nenhum.
    const arvore = montarArvore([pagina("orfa", "some-outra-id", 1)]);
    expect(arvore.map((n) => n.id)).toEqual(["orfa"]);
    expect(arvore[0]!.depth).toBe(0);
  });

  it("não perde páginas quando um ciclo escapou do banco", () => {
    // a -> b -> a. Sem quebrar o ciclo, nenhuma das duas seria raiz e ambas
    // ficariam invisíveis.
    const arvore = montarArvore([pagina("a", "b", 1), pagina("b", "a", 2)]);
    const ids = arvore.map((n) => n.id).sort();
    expect(ids).toContain("a");
    expect(arvore.length).toBeGreaterThan(0);
  });

  it("trata a página que é mãe de si mesma como raiz", () => {
    const arvore = montarArvore([pagina("solo", "solo", 1)]);
    expect(arvore.map((n) => n.id)).toEqual(["solo"]);
  });

  it("lista vazia devolve árvore vazia", () => {
    expect(montarArvore([])).toEqual([]);
  });
});

describe("caminhoDaPagina", () => {
  const paginas = [pagina("a", null, 1), pagina("b", "a", 2), pagina("c", "b", 3)];

  it("sobe da página até a raiz, na ordem de leitura", () => {
    expect(caminhoDaPagina(paginas, "c").map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("página de topo devolve só ela", () => {
    expect(caminhoDaPagina(paginas, "a").map((p) => p.id)).toEqual(["a"]);
  });

  it("página fora da lista devolve caminho vazio, não parcial", () => {
    expect(caminhoDaPagina(paginas, "inexistente")).toEqual([]);
  });

  it("termina mesmo com ciclo gravado", () => {
    const ciclo = [pagina("x", "y", 1), pagina("y", "x", 2)];
    expect(caminhoDaPagina(ciclo, "x").length).toBeLessThanOrEqual(2);
  });
});

describe("posicaoEntre", () => {
  it("lista vazia devolve um número (a página nasce no fim)", () => {
    const p = posicaoEntre(null, null);
    expect(typeof p).toBe("number");
    expect(Number.isFinite(p as number)).toBe(true);
  });

  it("no começo e no fim da lista, afasta-se do vizinho", () => {
    expect(posicaoEntre(null, 10)).toBe(9);
    expect(posicaoEntre(10, null)).toBe(11);
  });

  it("entre duas irmãs, devolve o meio", () => {
    expect(posicaoEntre(10, 20)).toBe(15);
  });

  it("devolve null quando o double não consegue mais partir o intervalo", () => {
    // Duas posições adjacentes em ponto flutuante: a média empata com uma das
    // pontas e a ordem travaria. Ver o comentário da função.
    const a = 1;
    const b = 1 + Number.EPSILON;
    expect(posicaoEntre(a, b)).toBeNull();
    expect(posicaoEntre(5, 5)).toBeNull();
  });
});

describe("normalizarDocumento", () => {
  it("conserta o default '{}' do banco, que não é documento do ProseMirror", () => {
    expect(normalizarDocumento({})).toEqual(DOCUMENTO_VAZIO);
  });

  it("recusa null, array e texto", () => {
    expect(normalizarDocumento(null)).toEqual(DOCUMENTO_VAZIO);
    expect(normalizarDocumento([])).toEqual(DOCUMENTO_VAZIO);
    expect(normalizarDocumento("texto")).toEqual(DOCUMENTO_VAZIO);
  });

  it("nunca devolve a mesma referência da constante compartilhada", () => {
    expect(normalizarDocumento({})).not.toBe(DOCUMENTO_VAZIO);
  });

  it("deixa passar um documento válido, intacto", () => {
    const doc = { type: "doc", content: [{ type: "paragraph" }] };
    expect(normalizarDocumento(doc)).toBe(doc);
  });

  it("cura o documento COM type e SEM bloco nenhum — a forma que travava o editor", () => {
    // É o que ficou gravado nas páginas criadas antes da correção. Sem esta
    // cura, elas continuariam abrindo em somente-leitura para sempre.
    const curado = normalizarDocumento({ type: "doc", content: [] });
    expect(curado.content).toHaveLength(1);
  });

  it("preserva os campos do original ao curar", () => {
    // `attrs` (e o que uma versão futura acrescentar) não pode ser perdido só
    // porque o `content` estava vazio.
    const curado = normalizarDocumento({ type: "doc", attrs: { versao: 2 }, content: [] });
    expect((curado as { attrs?: unknown }).attrs).toEqual({ versao: 2 });
  });
});

/**
 * O TESTE QUE FALTAVA — e a ausência dele custou o módulo inteiro duas vezes.
 *
 * Afirmar a FORMA de `DOCUMENTO_VAZIO` com `toEqual` não prova nada: foi
 * exatamente assim que `{ type: "doc", content: [] }` atravessou 499 testes
 * verdes enquanto tornava toda página nova impossível de escrever.
 *
 * O contrato real não é a forma, é o SCHEMA DO EDITOR. Por isso este teste
 * monta o mesmo schema que `Editor.tsx` monta (mesmas extensões, mesma
 * configuração) e pede ao ProseMirror que valide. `doc` tem content spec
 * `block+`; um documento sem bloco nenhum é recusado com "Invalid content for
 * node doc", e é isso que `enableContentCheck` transforma em editor travado.
 */
describe("DOCUMENTO_VAZIO contra o schema real do editor", () => {
  it("é aceito pelo ProseMirror", async () => {
    const [{ getSchema }, { default: StarterKit }, { default: CodeBlockLowlight }, { Node }] =
      await Promise.all([
        import("@tiptap/core"),
        import("@tiptap/starter-kit"),
        import("@tiptap/extension-code-block-lowlight"),
        import("@tiptap/pm/model"),
      ]);

    // As MESMAS extensões de Editor.tsx. Se aquela lista mudar, esta precisa
    // mudar junto — é o preço de o teste ser sobre o schema, e não sobre texto.
    const schema = getSchema([
      StarterKit.configure({ codeBlock: false }),
      CodeBlockLowlight.configure({ defaultLanguage: "plaintext" }),
    ]);

    expect(() => Node.fromJSON(schema, DOCUMENTO_VAZIO).check()).not.toThrow();
  });

  it("e o documento sem blocos é MESMO recusado (prova que o teste acima tem valor)", async () => {
    // Sem este caso, o teste anterior passaria mesmo que a verificação do
    // ProseMirror não estivesse checando nada.
    const [{ getSchema }, { default: StarterKit }, { Node }] = await Promise.all([
      import("@tiptap/core"),
      import("@tiptap/starter-kit"),
      import("@tiptap/pm/model"),
    ]);
    const schema = getSchema([StarterKit.configure({ codeBlock: false })]);

    expect(() => Node.fromJSON(schema, { type: "doc", content: [] }).check()).toThrow();
  });
});

describe("rotuloDaPagina", () => {
  it("título em branco vira o padrão, para o item não sumir da árvore", () => {
    expect(rotuloDaPagina("   ")).toBe("Sem título");
    expect(rotuloDaPagina("")).toBe("Sem título");
    expect(rotuloDaPagina(null)).toBe("Sem título");
  });

  it("título com conteúdo é preservado sem espaço nas pontas", () => {
    expect(rotuloDaPagina("  Anotações ")).toBe("Anotações");
  });
});

describe("prosemirrorDocSchema", () => {
  it("exige type 'doc' na raiz", () => {
    expect(prosemirrorDocSchema.safeParse({ type: "paragraph" }).success).toBe(false);
    expect(prosemirrorDocSchema.safeParse({}).success).toBe(false);
    expect(prosemirrorDocSchema.safeParse({ type: "doc" }).success).toBe(true);
  });

  it("NÃO apaga campos desconhecidos da raiz (passthrough)", () => {
    const r = prosemirrorDocSchema.parse({ type: "doc", attrs: { versao: 2 }, content: [] });
    expect((r as { attrs?: unknown }).attrs).toEqual({ versao: 2 });
  });

  it("preserva os nós internos sem tocar no schema do editor", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "codeBlock", attrs: { language: "sql" }, content: [{ type: "text", text: "select 1" }] },
      ],
    };
    expect(prosemirrorDocSchema.parse(doc)).toEqual(doc);
  });

  it("recusa documento grande demais", () => {
    const gigante = { type: "doc", content: [{ type: "text", text: "x".repeat(1_100_000) }] };
    expect(prosemirrorDocSchema.safeParse(gigante).success).toBe(false);
  });

  it("recusa aninhamento profundo demais sem estourar a pilha", () => {
    // 300 níveis: passa no teste de tamanho e tem de ser barrado pelo de
    // profundidade.
    let fundo: Record<string, unknown> = { type: "text" };
    for (let i = 0; i < 300; i++) fundo = { type: "wrap", content: [fundo] };
    const doc = { type: "doc", content: [fundo] };
    expect(prosemirrorDocSchema.safeParse(doc).success).toBe(false);
  });
});

describe("knowledgePageContentSchema", () => {
  const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const CARIMBO = "2026-08-02T12:00:00.123456+00:00";

  it("aceita o carimbo com microssegundos e deslocamento que o PostgREST devolve", () => {
    const r = knowledgePageContentSchema.safeParse({
      id: ID,
      content: { type: "doc" },
      updatedAt: CARIMBO,
    });
    expect(r.success).toBe(true);
  });

  it("aceita também a forma com Z", () => {
    const r = knowledgePageContentSchema.safeParse({
      id: ID,
      content: { type: "doc" },
      updatedAt: "2026-08-02T12:00:00Z",
    });
    expect(r.success).toBe(true);
  });

  it("recusa carimbo com caractere de sintaxe do PostgREST", () => {
    for (const ruim of ["2026-08-02T12:00:00Z,extra", "agora", "", "2026-08-02"]) {
      expect(
        knowledgePageContentSchema.safeParse({ id: ID, content: { type: "doc" }, updatedAt: ruim })
          .success,
      ).toBe(false);
    }
  });

  it("aceita título vazio (o usuário apaga o título enquanto digita)", () => {
    const r = knowledgePageContentSchema.safeParse({
      id: ID,
      title: "",
      content: { type: "doc" },
      updatedAt: CARIMBO,
    });
    expect(r.success).toBe(true);
  });

  it("preserva o título como digitado, sem trim", () => {
    const r = knowledgePageContentSchema.parse({
      id: ID,
      title: "Rascunho ",
      content: { type: "doc" },
      updatedAt: CARIMBO,
    });
    expect(r.title).toBe("Rascunho ");
  });
});

describe("achatarVisiveis", () => {
  const arvore = () =>
    montarArvore([
      pagina("a", null, 1),
      pagina("a1", "a", 1),
      pagina("a2", "a", 2),
      pagina("a1x", "a1", 1),
      pagina("b", null, 2),
    ]);

  it("com tudo fechado, mostra só as raízes", () => {
    const linhas = achatarVisiveis(arvore(), new Set());
    expect(linhas.map((l) => l.no.id)).toEqual(["a", "b"]);
    expect(linhas[0]!.temFilhas).toBe(true);
    expect(linhas[1]!.temFilhas).toBe(false);
    expect(linhas[0]!.expandida).toBe(false);
  });

  it("expande na ordem visual e só o ramo pedido", () => {
    const linhas = achatarVisiveis(arvore(), new Set(["a"]));
    expect(linhas.map((l) => l.no.id)).toEqual(["a", "a1", "a2", "b"]);
    // "a1x" continua escondida: a mãe dela está fechada.
    expect(linhas.some((l) => l.no.id === "a1x")).toBe(false);
  });

  it("preenche nivel, posicao e total como o ARIA espera (1-based)", () => {
    const linhas = achatarVisiveis(arvore(), new Set(["a", "a1"]));
    const porId = new Map(linhas.map((l) => [l.no.id, l]));
    expect(porId.get("a")).toMatchObject({ nivel: 1, posicao: 1, total: 2, maeId: null });
    expect(porId.get("b")).toMatchObject({ nivel: 1, posicao: 2, total: 2 });
    expect(porId.get("a1")).toMatchObject({ nivel: 2, posicao: 1, total: 2, maeId: "a" });
    expect(porId.get("a2")).toMatchObject({ nivel: 2, posicao: 2, total: 2, maeId: "a" });
    expect(porId.get("a1x")).toMatchObject({ nivel: 3, posicao: 1, total: 1, maeId: "a1" });
  });

  it("expandir uma folha não inventa linha nenhuma", () => {
    const linhas = achatarVisiveis(arvore(), new Set(["b"]));
    expect(linhas.map((l) => l.no.id)).toEqual(["a", "b"]);
    expect(linhas[1]!.expandida).toBe(false);
  });

  it("não repete linha quando o mesmo nó aparece duas vezes na árvore", () => {
    // Árvore montada à mão com um nó pendurado em dois lugares — o que uma
    // travessia ingênua percorreria para sempre.
    const folha = { ...pagina("x", "a"), children: [], depth: 1 };
    const raiz = { ...pagina("a", null), children: [folha, folha], depth: 0 };
    const linhas = achatarVisiveis([raiz], new Set(["a"]));
    expect(linhas.map((l) => l.no.id)).toEqual(["a", "x"]);
  });
});

describe("descendentesDe", () => {
  const lista = [
    pagina("a", null),
    pagina("a1", "a"),
    pagina("a2", "a"),
    pagina("a1x", "a1"),
    pagina("b", null),
  ];

  it("devolve a subárvore inteira, sem a própria página", () => {
    expect([...descendentesDe(lista, "a")].sort()).toEqual(["a1", "a1x", "a2"]);
  });

  it("devolve vazio para folha e para id desconhecido", () => {
    expect(descendentesDe(lista, "a1x").size).toBe(0);
    expect(descendentesDe(lista, "nao-existe").size).toBe(0);
  });

  it("não trava com ciclo gravado", () => {
    const ciclo = [pagina("p", "q"), pagina("q", "p")];
    expect([...descendentesDe(ciclo, "p")]).toEqual(["q"]);
  });
});

describe("mesmoDocumento", () => {
  it("ignora a ORDEM DAS CHAVES — é o ponto todo da função", () => {
    // O lado do editor serializa na ordem de inserção; o lado do banco vem do
    // jsonb, que reordena as chaves. Comparar por JSON.stringify diria "mudou"
    // para dois documentos idênticos, e o editor deixaria de reconciliar.
    const doEditor = { type: "doc", content: [{ type: "paragraph", attrs: { a: 1 } }] };
    const doBanco = { content: [{ attrs: { a: 1 }, type: "paragraph" }], type: "doc" };
    expect(mesmoDocumento(doEditor, doBanco)).toBe(true);
  });

  it("respeita a ordem dos ARRAYS, que é conteúdo e não representação", () => {
    const a = { type: "doc", content: [{ type: "a" }, { type: "b" }] };
    const b = { type: "doc", content: [{ type: "b" }, { type: "a" }] };
    expect(mesmoDocumento(a, b)).toBe(false);
  });

  it("recusa quando um lado tem campo a mais, mesmo contendo tudo do outro", () => {
    expect(mesmoDocumento({ type: "doc" }, { type: "doc", content: [] })).toBe(false);
  });

  it("distingue tipos que se parecem", () => {
    expect(mesmoDocumento({ a: 1 }, { a: "1" })).toBe(false);
    expect(mesmoDocumento([], {})).toBe(false);
    expect(mesmoDocumento(null, {})).toBe(false);
  });

  it("não estoura a pilha com documento absurdamente fundo", () => {
    let fundo: unknown = { type: "text", text: "fim" };
    for (let i = 0; i < 50_000; i++) fundo = { type: "wrap", content: [fundo] };
    expect(mesmoDocumento(fundo, fundo)).toBe(true);
  });
});

describe("reconciliarPagina", () => {
  const T0 = "2026-08-02T10:00:00.000+00:00";
  const T1 = "2026-08-02T10:00:05.000+00:00";
  const DOC = { type: "doc", content: [{ type: "paragraph" }] };

  const local = (extra: Partial<Parameters<typeof reconciliarPagina>[0]> = {}) => ({
    carimbo: T0,
    tituloAtual: "Antigo",
    tituloSalvo: "Antigo",
    conteudoNoServidor: DOC,
    ...extra,
  });

  it("adota carimbo e título quando só o rótulo mudou (renomear pela barra lateral)", () => {
    // É O DEFEITO: renomear a página aberta dispara set_updated_at + refresh, a
    // instância não remonta por causa da key={pageId} e o carimbo congela. Sem
    // adotar, a próxima gravação vira "Conflito" numa aba só.
    expect(reconciliarPagina(local(), { carimbo: T1, titulo: "Novo", conteudo: DOC })).toEqual({
      carimbo: T1,
      titulo: "Novo",
    });
  });

  it("NÃO adota nada quando o conteúdo do servidor mudou", () => {
    // Outra aba gravou conteúdo. Adotar o carimbo faria a gravação seguinte
    // passar e apagar aquele texto — aqui o conflito é o comportamento certo.
    const outro = { type: "doc", content: [{ type: "paragraph" }, { type: "paragraph" }] };
    expect(
      reconciliarPagina(local(), { carimbo: T1, titulo: "Antigo", conteudo: outro }),
    ).toEqual({ carimbo: null, titulo: null });
  });

  it("compara com o conteúdo GRAVADO, não com o que está sendo digitado", () => {
    // Digitação local pendente não impede a reconciliação: o que importa é o que
    // o servidor tem, e ele continua com o documento que já conhecíamos.
    expect(
      reconciliarPagina(local(), { carimbo: T1, titulo: "Novo", conteudo: { ...DOC } }),
    ).toEqual({ carimbo: T1, titulo: "Novo" });
  });

  it("preserva o título que está sendo digitado, mas ainda adota o carimbo", () => {
    expect(
      reconciliarPagina(local({ tituloAtual: "Meio de digitar" }), {
        carimbo: T1,
        titulo: "Novo",
        conteudo: DOC,
      }),
    ).toEqual({ carimbo: T1, titulo: null });
  });

  it("ignora foto ATRASADA — o carimbo só anda para a frente", () => {
    expect(
      reconciliarPagina(local({ carimbo: T1 }), { carimbo: T0, titulo: "Novo", conteudo: DOC }),
    ).toEqual({ carimbo: null, titulo: null });
  });

  it("não faz nada quando o carimbo é o mesmo", () => {
    expect(reconciliarPagina(local(), { carimbo: T0, titulo: "Antigo", conteudo: DOC })).toEqual({
      carimbo: null,
      titulo: null,
    });
  });

  it("não faz nada com carimbo ilegível de qualquer um dos lados", () => {
    expect(
      reconciliarPagina(local({ carimbo: "nao e data" }), {
        carimbo: T1,
        titulo: "Novo",
        conteudo: DOC,
      }),
    ).toEqual({ carimbo: null, titulo: null });
    expect(
      reconciliarPagina(local(), { carimbo: "nao e data", titulo: "Novo", conteudo: DOC }),
    ).toEqual({ carimbo: null, titulo: null });
  });
});

describe("semAcento", () => {
  it("tira acento e caixa", () => {
    expect(semAcento("Índice de Códigos")).toBe("indice de codigos");
    expect(semAcento("Ação")).toBe("acao");
  });
});

describe("destacarOcorrencias", () => {
  const junta = (trechos: { texto: string }[]) => trechos.map((t) => t.texto).join("");

  it("marca a ocorrência preservando a caixa original", () => {
    const trechos = destacarOcorrencias("Notas sobre Postgres", "postgres");
    expect(junta(trechos)).toBe("Notas sobre Postgres");
    expect(trechos.filter((t) => t.destaque).map((t) => t.texto)).toEqual(["Postgres"]);
  });

  it("casa sem acento e RECORTA na posição certa do texto original", () => {
    // A armadilha: "í" em NFD tem dois caracteres. Um índice calculado sobre a
    // string normalizada e aplicado ao texto original sai deslocado.
    const trechos = destacarOcorrencias("Índice de códigos", "codigos");
    expect(junta(trechos)).toBe("Índice de códigos");
    expect(trechos.filter((t) => t.destaque).map((t) => t.texto)).toEqual(["códigos"]);
  });

  it("preserva o texto inteiro mesmo com emoji antes do termo", () => {
    const texto = "🚀 lançamento do índice";
    const trechos = destacarOcorrencias(texto, "indice");
    expect(junta(trechos)).toBe(texto);
    expect(trechos.filter((t) => t.destaque).map((t) => t.texto)).toEqual(["índice"]);
  });

  it("funde ocorrências que se sobrepõem", () => {
    const trechos = destacarOcorrencias("caderno", "caderno cad");
    expect(trechos.filter((t) => t.destaque).map((t) => t.texto)).toEqual(["caderno"]);
  });

  it("ignora operadores do websearch e termos curtos demais", () => {
    for (const termo of ["-postgres", "or", "a", '"', ""]) {
      const trechos = destacarOcorrencias("um a postgres or dois", termo);
      expect(trechos.every((t) => !t.destaque)).toBe(true);
    }
  });

  it("devolve o texto inteiro sem marca quando nada casa", () => {
    const trechos = destacarOcorrencias("Nada aqui", "postgres");
    expect(trechos).toEqual([{ texto: "Nada aqui", destaque: false }]);
  });
});
