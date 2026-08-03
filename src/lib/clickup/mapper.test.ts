import { describe, expect, it } from "vitest";
import { mapearComentario, mapearTarefa, msParaIso, porPrazo, traduzirPrioridade } from "./mapper";
import type { TarefaClickUp } from "./types";

describe("msParaIso — a armadilha das datas do ClickUp", () => {
  it("converte string de milissegundos", () => {
    // O formato que a API manda: epoch em ms, COMO STRING.
    expect(msParaIso("1754092800000")).toBe(new Date(1754092800000).toISOString());
  });

  it("aceita número também", () => {
    expect(msParaIso(1754092800000)).toBe(new Date(1754092800000).toISOString());
  });

  it("`new Date(string)` seria Invalid Date — é por isso que existe conversão", () => {
    // Documenta o defeito que a função evita: o construtor trata string como
    // formato de data, não como epoch.
    expect(Number.isNaN(new Date("1754092800000" as unknown as number).getTime())).toBe(true);
    expect(msParaIso("1754092800000")).not.toBeNull();
  });

  it("string vazia vira null, não 1970", () => {
    // `Number("")` é 0, e 0 vira 1970-01-01. Tarefa sem prazo às vezes vem com
    // string vazia em vez de null, e a lista mostraria "vencida há 56 anos".
    expect(msParaIso("")).toBeNull();
  });

  it("lixo vira null, não exceção", () => {
    // `new Date(NaN).toISOString()` lança RangeError e derrubaria a listagem
    // inteira por causa de uma data de uma tarefa.
    expect(msParaIso("abc")).toBeNull();
    expect(msParaIso(null)).toBeNull();
    expect(msParaIso(undefined)).toBeNull();
    expect(msParaIso("0")).toBeNull();
    expect(msParaIso("-1")).toBeNull();
    expect(msParaIso("999999999999999999999")).toBeNull();
  });
});

describe("traduzirPrioridade", () => {
  it("lê o rótulo, não o número", () => {
    // O número já mudou de significado entre versões da API; o rótulo não.
    expect(traduzirPrioridade({ priority: "urgent" })).toBe("urgente");
    expect(traduzirPrioridade({ priority: "High" })).toBe("alta");
    expect(traduzirPrioridade({ priority: "normal" })).toBe("normal");
    expect(traduzirPrioridade({ priority: "low" })).toBe("baixa");
  });

  it("sem prioridade vira null", () => {
    expect(traduzirPrioridade(null)).toBeNull();
    expect(traduzirPrioridade(undefined)).toBeNull();
    expect(traduzirPrioridade({ priority: null })).toBeNull();
    expect(traduzirPrioridade({ priority: "desconhecida" })).toBeNull();
  });
});

describe("mapearTarefa", () => {
  it("reduz a resposta crua ao que a tela desenha", () => {
    const tarefa = mapearTarefa({
      id: "abc",
      name: "Revisar contrato",
      text_content: "texto puro",
      description: "**markdown**",
      status: { status: "in progress", color: "#00f" },
      due_date: "1754092800000",
      priority: { priority: "high" },
      list: { id: "l1", name: "Sprint 4" },
      url: "https://app.clickup.com/t/abc",
      assignees: [{ id: 1 }],
    });

    expect(tarefa).toEqual({
      id: "abc",
      nome: "Revisar contrato",
      descricao: "texto puro", // prefere text_content ao markdown
      status: "in progress",
      statusCor: "#00f",
      prazo: new Date(1754092800000).toISOString(),
      prioridade: "alta",
      listaId: "l1",
      listaNome: "Sprint 4",
      url: "https://app.clickup.com/t/abc",
    });
    // `assignees` NÃO atravessa: é dado de colegas e a tela não desenha.
    expect(tarefa).not.toHaveProperty("assignees");
  });

  it("aguenta a resposta mínima da listagem", () => {
    const tarefa = mapearTarefa({ id: "x", name: "Só o nome" });
    expect(tarefa.nome).toBe("Só o nome");
    expect(tarefa.prazo).toBeNull();
    expect(tarefa.prioridade).toBeNull();
    expect(tarefa.listaId).toBeNull();
  });
});

describe("mapearComentario", () => {
  it("converte texto, autor e data", () => {
    expect(
      mapearComentario({
        id: "c1",
        comment_text: "combinado",
        user: { id: 1, username: "Colega" },
        date: "1754092800000",
      }),
    ).toEqual({
      id: "c1",
      texto: "combinado",
      autor: "Colega",
      quando: new Date(1754092800000).toISOString(),
    });
  });

  it("comentário sem texto vira string vazia, não null", () => {
    expect(mapearComentario({ id: "c1" }).texto).toBe("");
  });
});

describe("porPrazo — sem prazo vai para o FIM", () => {
  const t = (id: string, prazo: string | null): TarefaClickUp => ({
    id,
    nome: id,
    descricao: null,
    status: null,
    statusCor: null,
    prazo,
    prioridade: null,
    listaId: null,
    listaNome: null,
    url: null,
  });

  it("ordena por prazo, com os sem data por último", () => {
    /*
      A decisão que importa: o comparador ingênuo trataria `null` como menor que
      tudo e jogaria as tarefas sem data para o TOPO — exatamente onde elas não
      ajudam. Quem abre a aba quer ver o que está atrasado.
    */
    const lista = [
      t("sem-data", null),
      t("depois", "2026-08-10T00:00:00.000Z"),
      t("antes", "2026-08-01T00:00:00.000Z"),
      t("outra-sem-data", null),
    ];
    expect([...lista].sort(porPrazo).map((x) => x.id)).toEqual([
      "antes",
      "depois",
      "sem-data",
      "outra-sem-data",
    ]);
  });
});
