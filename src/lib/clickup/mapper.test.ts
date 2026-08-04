import { describe, expect, it } from "vitest";
import {
  agruparPorFase,
  aninharTarefas,
  faseDoStatus,
  mapearComentario,
  mapearResponsaveis,
  mapearTarefa,
  msParaIso,
  porPrazo,
  traduzirPrioridade,
} from "./mapper";
import type { FaseClickUp, TarefaClickUp } from "./types";

/** Uma tarefa já mapeada, para os testes que operam sobre o modelo da tela. */
function tarefaDeTeste(
  id: string,
  prazo: string | null,
  fase: FaseClickUp = "andamento",
): TarefaClickUp {
  return {
    id,
    nome: id,
    descricao: null,
    status: null,
    statusCor: null,
    fase,
    statusOrdem: null,
    prazo,
    prioridade: null,
    listaId: null,
    listaNome: null,
    url: null,
    responsaveis: [],
    paiId: null,
  };
}

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
    const tarefa = mapearTarefa(
      {
        id: "abc",
        name: "Revisar contrato",
        text_content: "texto puro",
        description: "**markdown**",
        status: { status: "in progress", color: "#00f", type: "custom", orderindex: 1 },
        due_date: "1754092800000",
        priority: { priority: "high" },
        list: { id: "l1", name: "Sprint 4" },
        url: "https://app.clickup.com/t/abc",
        assignees: [
          { id: 1, username: "Eu", email: "eu@empresa.com" },
          { id: 2, username: "Colega", email: "colega@empresa.com" },
        ],
      },
      1,
    );

    expect(tarefa).toEqual({
      id: "abc",
      nome: "Revisar contrato",
      descricao: "texto puro", // prefere text_content ao markdown
      status: "in progress",
      statusCor: "#00f",
      fase: "andamento",
      statusOrdem: 1,
      prazo: new Date(1754092800000).toISOString(),
      prioridade: "alta",
      listaId: "l1",
      listaNome: "Sprint 4",
      url: "https://app.clickup.com/t/abc",
      responsaveis: [
        { id: "1", nome: "Eu", souEu: true },
        { id: "2", nome: "Colega", souEu: false },
      ],
      paiId: null,
    });
  });

  it("`parent` vira `paiId`, sempre como string", () => {
    // Como os ids de usuário, o `parent` chega ora como número, ora como texto.
    // Um `paiId` numérico nunca casaria com o `id` (string) da mãe no `Map` de
    // `aninharTarefas`, e toda subtarefa viraria órfã em silêncio.
    expect(mapearTarefa({ id: "f", name: "filha", parent: "abc" }).paiId).toBe("abc");
    expect(
      mapearTarefa({ id: "f", name: "filha", parent: 123 as unknown as string }).paiId,
    ).toBe("123");
    expect(mapearTarefa({ id: "t", name: "topo", parent: null }).paiId).toBeNull();
    expect(mapearTarefa({ id: "t", name: "topo" }).paiId).toBeNull();
  });

  it("os responsáveis atravessam, mas o E-MAIL do colega não", () => {
    /*
      Esta asserção substituiu um `not.toHaveProperty("assignees")` que existia
      para impedir que dado de colega atravessasse. A intenção mudou de "nada
      de terceiros passa" para "só o necessário passa, e nada é persistido":
      saber quem mais está na tarefa responde uma pergunta real ("quem está
      comigo nisto?"), enquanto o e-mail só serviria para contatar fora daqui.

      O nome trafega no payload da action, é desenhado e morre ao fechar a aba —
      mesmo tratamento dado aos comentários.
    */
    const tarefa = mapearTarefa({
      id: "abc",
      name: "x",
      assignees: [{ id: 7, username: "Colega", email: "colega@empresa.com" }],
    });

    expect(tarefa.responsaveis).toEqual([{ id: "7", nome: "Colega", souEu: false }]);
    expect(JSON.stringify(tarefa)).not.toContain("colega@empresa.com");
    // A forma crua também não atravessa com outro nome.
    expect(tarefa).not.toHaveProperty("assignees");
  });

  it("aguenta a resposta mínima da listagem", () => {
    const tarefa = mapearTarefa({ id: "x", name: "Só o nome" });
    expect(tarefa.nome).toBe("Só o nome");
    expect(tarefa.prazo).toBeNull();
    expect(tarefa.prioridade).toBeNull();
    expect(tarefa.listaId).toBeNull();
    expect(tarefa.responsaveis).toEqual([]);
    // Sem `status.type`, a fase cai em "andamento" — ver `faseDoStatus`.
    expect(tarefa.fase).toBe("andamento");
    expect(tarefa.statusOrdem).toBeNull();
  });
});

describe("faseDoStatus — o único agrupamento estável entre listas", () => {
  it("open vira 'a fazer'; closed e done viram 'concluído'", () => {
    expect(faseDoStatus("open")).toBe("afazer");
    expect(faseDoStatus("closed")).toBe("concluido");
    // `done` é precaução: a documentação usa `closed`, mas alguns workspaces
    // relatam `done`. Errar para "concluído" é o lado seguro.
    expect(faseDoStatus("done")).toBe("concluido");
  });

  it("tudo o que fica no MEIO é andamento — inclusive o que ainda não existe", () => {
    expect(faseDoStatus("custom")).toBe("andamento");
    expect(faseDoStatus("um_tipo_que_o_clickup_inventar")).toBe("andamento");
    expect(faseDoStatus(null)).toBe("andamento");
    expect(faseDoStatus(undefined)).toBe("andamento");
  });

  it("não depende de maiúsculas", () => {
    expect(faseDoStatus("OPEN")).toBe("afazer");
    expect(faseDoStatus("Closed")).toBe("concluido");
  });
});

describe("mapearResponsaveis", () => {
  it("compara ids como STRING — 1 === '1' é falso", () => {
    // O ClickUp manda o id ora como número, ora como string, dependendo da
    // rota. Sem o `String()` dos dois lados, "você" nunca seria marcado.
    expect(mapearResponsaveis([{ id: 1 }], "1")[0]?.souEu).toBe(true);
    expect(mapearResponsaveis([{ id: "1" }], 1)[0]?.souEu).toBe(true);
  });

  it("sem meuId, ninguém é 'você' — é o honesto, não dá para saber", () => {
    expect(mapearResponsaveis([{ id: 1 }])[0]?.souEu).toBe(false);
    expect(mapearResponsaveis([{ id: 1 }], null)[0]?.souEu).toBe(false);
  });

  it("sem username, cai no id — que ao menos distingue duas pessoas", () => {
    expect(mapearResponsaveis([{ id: 9 }])[0]?.nome).toBe("#9");
    expect(mapearResponsaveis([{ id: 9, username: "   " }])[0]?.nome).toBe("#9");
  });

  it("campo ausente ou nulo vira lista vazia, não exceção", () => {
    expect(mapearResponsaveis(null)).toEqual([]);
    expect(mapearResponsaveis(undefined)).toEqual([]);
    expect(mapearResponsaveis([])).toEqual([]);
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
  const t = (id: string, prazo: string | null): TarefaClickUp => tarefaDeTeste(id, prazo);

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

describe("agruparPorFase — as colunas do quadro", () => {
  it("devolve as TRÊS fases mesmo quando alguma está vazia", () => {
    /*
      A coluna que some ao ficar sem cartão faria o quadro mudar de largura
      conforme o trabalho anda. E "Concluído" precisa existir vazio para poder
      explicar POR QUE está vazio: `include_closed=false` é fixo na listagem, e
      sem a explicação o quadro afirmaria "você não concluiu nada".
    */
    const mapa = agruparPorFase([tarefaDeTeste("a", null, "afazer")]);
    expect([...mapa.keys()]).toEqual(["afazer", "andamento", "concluido"]);
    expect(mapa.get("andamento")).toEqual([]);
    expect(mapa.get("concluido")).toEqual([]);
  });

  it("ordena dentro da coluna por prazo, com os sem data por último", () => {
    const mapa = agruparPorFase([
      tarefaDeTeste("sem-data", null, "afazer"),
      tarefaDeTeste("depois", "2026-08-10T00:00:00.000Z", "afazer"),
      tarefaDeTeste("antes", "2026-08-01T00:00:00.000Z", "afazer"),
    ]);
    expect(mapa.get("afazer")?.map((t) => t.id)).toEqual(["antes", "depois", "sem-data"]);
  });

  it("cada tarefa vai para uma coluna só", () => {
    const entrada = [
      tarefaDeTeste("a", null, "afazer"),
      tarefaDeTeste("b", null, "andamento"),
      tarefaDeTeste("c", null, "concluido"),
    ];
    const mapa = agruparPorFase(entrada);
    const total = [...mapa.values()].reduce((n, l) => n + l.length, 0);
    expect(total).toBe(entrada.length);
  });

  it("não altera o array recebido", () => {
    // `sort` é in-place: sem a cópia implícita do agrupamento, ordenar a coluna
    // reordenaria a lista que a aba guarda em cache.
    const entrada = [
      tarefaDeTeste("depois", "2026-08-10T00:00:00.000Z", "afazer"),
      tarefaDeTeste("antes", "2026-08-01T00:00:00.000Z", "afazer"),
    ];
    agruparPorFase(entrada);
    expect(entrada.map((t) => t.id)).toEqual(["depois", "antes"]);
  });
});

describe("aninharTarefas — subtasks v1", () => {
  const comPai = (id: string, paiId: string | null): TarefaClickUp => ({
    ...tarefaDeTeste(id, null),
    paiId,
  });

  const forma = (linhas: ReturnType<typeof aninharTarefas>) =>
    linhas.map((l) => `${"-".repeat(l.nivel)}${l.tarefa.id}${l.orfa ? "(órfã)" : ""}`);

  it("põe a filha logo abaixo da mãe, recuada", () => {
    expect(forma(aninharTarefas([comPai("mae", null), comPai("filha", "mae")]))).toEqual([
      "mae",
      "-filha",
    ]);
  });

  it("a filha vai para junto da mãe mesmo vindo antes dela na entrada", () => {
    expect(forma(aninharTarefas([comPai("filha", "mae"), comPai("mae", null)]))).toEqual([
      "mae",
      "-filha",
    ]);
  });

  it("ÓRFÃ sobe para o topo, mas continua marcada", () => {
    /*
      É o caso NORMAL, não a exceção: a API aplica `assignees[]` também às
      subtasks, então a subtarefa que é sua chega sem a mãe, que é de um colega.
      Escondê-la faria a tarefa sumir do aplicativo; desmarcá-la esconderia a
      única informação que a distingue.
    */
    expect(forma(aninharTarefas([comPai("filha", "mae-de-colega")]))).toEqual([
      "filha(órfã)",
    ]);
  });

  it("aninha em mais de um nível", () => {
    const linhas = aninharTarefas([
      comPai("a", null),
      comPai("b", "a"),
      comPai("c", "b"),
    ]);
    expect(forma(linhas)).toEqual(["a", "-b", "--c"]);
  });

  it("preserva a ordem de entrada no topo — quem chama já ordenou por prazo", () => {
    const linhas = aninharTarefas([
      comPai("primeira", null),
      comPai("segunda", null),
      comPai("filha-da-primeira", "primeira"),
    ]);
    expect(forma(linhas)).toEqual(["primeira", "-filha-da-primeira", "segunda"]);
  });

  it("um ciclo no `parent` não trava nem some com a tarefa", () => {
    // Um payload malformado não pode apagar tarefa da tela nem pendurar a aba.
    const linhas = aninharTarefas([comPai("a", "b"), comPai("b", "a")]);
    expect(linhas).toHaveLength(2);
    expect(linhas.map((l) => l.tarefa.id).sort()).toEqual(["a", "b"]);
  });

  it("toda tarefa aparece EXATAMENTE uma vez", () => {
    const entrada = [
      comPai("a", null),
      comPai("b", "a"),
      comPai("c", "a"),
      comPai("d", "orfa"),
      comPai("e", null),
    ];
    const linhas = aninharTarefas(entrada);
    expect(linhas).toHaveLength(entrada.length);
    expect(new Set(linhas.map((l) => l.tarefa.id)).size).toBe(entrada.length);
  });

  it("lista vazia devolve lista vazia", () => {
    expect(aninharTarefas([])).toEqual([]);
  });
});
