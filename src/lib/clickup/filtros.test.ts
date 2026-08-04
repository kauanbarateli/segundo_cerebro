import { describe, expect, it } from "vitest";
import { FILTRO_VAZIO, filtrarTarefas, opcoesDeFiltro, temFiltroAtivo } from "./filtros";
import type { TarefaClickUp } from "./types";

/** Instante fixo — sem ele, todo teste de "hoje" quebra à meia-noite. */
const AGORA = new Date("2026-08-04T12:00:00.000Z").getTime();

function tarefa(parcial: Partial<TarefaClickUp> & { id: string }): TarefaClickUp {
  return {
    nome: parcial.id,
    descricao: null,
    status: null,
    statusCor: null,
    fase: "andamento",
    statusOrdem: null,
    prazo: null,
    prioridade: null,
    listaId: null,
    listaNome: null,
    url: null,
    responsaveis: [],
    paiId: null,
    ...parcial,
  };
}

/** Um prazo relativo ao instante fixo, em dias. */
function emDias(dias: number): string {
  return new Date(AGORA + dias * 86_400_000).toISOString();
}

const ids = (lista: TarefaClickUp[]) => lista.map((t) => t.id);

describe("filtrarTarefas — recortes de prazo", () => {
  const lista = [
    tarefa({ id: "vencida", prazo: emDias(-3) }),
    tarefa({ id: "hoje", prazo: emDias(0) }),
    tarefa({ id: "em-3-dias", prazo: emDias(3) }),
    tarefa({ id: "em-20-dias", prazo: emDias(20) }),
    tarefa({ id: "sem-prazo", prazo: null }),
  ];

  it("'todas' não filtra nada", () => {
    expect(filtrarTarefas(lista, FILTRO_VAZIO, AGORA)).toHaveLength(5);
  });

  it("sem prazo NUNCA casa com recorte de data", () => {
    // Uma tarefa sem data não está atrasada nem é de hoje. Incluí-la em
    // qualquer recorte faria o recorte perder o sentido.
    for (const prazo of ["vencidas", "hoje", "semana"] as const) {
      const r = filtrarTarefas(lista, { ...FILTRO_VAZIO, prazo }, AGORA);
      expect(ids(r)).not.toContain("sem-prazo");
    }
  });

  it("'vencidas' é estritamente o passado", () => {
    expect(ids(filtrarTarefas(lista, { ...FILTRO_VAZIO, prazo: "vencidas" }, AGORA))).toEqual([
      "vencida",
    ]);
  });

  it("'hoje' é o dia inteiro, não as próximas 24 horas", () => {
    expect(ids(filtrarTarefas(lista, { ...FILTRO_VAZIO, prazo: "hoje" }, AGORA))).toEqual([
      "hoje",
    ]);
  });

  it("'7 dias' INCLUI as vencidas — é a carga da semana, não uma janela do futuro", () => {
    /*
      A decisão que importa. Uma tarefa que venceu ontem faz parte do que
      precisa de atenção nesta semana, e escondê-la ali esconderia justamente a
      mais urgente.
    */
    const r = filtrarTarefas(lista, { ...FILTRO_VAZIO, prazo: "semana" }, AGORA);
    expect(ids(r)).toEqual(["vencida", "hoje", "em-3-dias"]);
  });

  it("'7 dias' conta hoje como o primeiro dos sete", () => {
    const limite = [
      tarefa({ id: "sexto-dia", prazo: emDias(5) }),
      tarefa({ id: "setimo-dia", prazo: emDias(6) }),
      tarefa({ id: "oitavo-dia", prazo: emDias(7) }),
    ];
    const r = filtrarTarefas(limite, { ...FILTRO_VAZIO, prazo: "semana" }, AGORA);
    expect(ids(r)).toEqual(["sexto-dia", "setimo-dia"]);
  });
});

describe("filtrarTarefas — as outras dimensões", () => {
  const lista = [
    tarefa({
      id: "a",
      status: "in progress",
      prioridade: "alta",
      listaId: "l1",
      responsaveis: [{ id: "1", nome: "Eu", souEu: true }],
    }),
    tarefa({
      id: "b",
      status: "to do",
      prioridade: null,
      listaId: "l2",
      responsaveis: [
        { id: "1", nome: "Eu", souEu: true },
        { id: "2", nome: "Colega", souEu: false },
      ],
    }),
  ];

  it("filtra por status literal", () => {
    expect(ids(filtrarTarefas(lista, { ...FILTRO_VAZIO, status: "to do" }, AGORA))).toEqual(["b"]);
  });

  it("filtra por prioridade", () => {
    expect(ids(filtrarTarefas(lista, { ...FILTRO_VAZIO, prioridade: "alta" }, AGORA))).toEqual([
      "a",
    ]);
  });

  it("filtra por lista", () => {
    expect(ids(filtrarTarefas(lista, { ...FILTRO_VAZIO, listaId: "l2" }, AGORA))).toEqual(["b"]);
  });

  it("filtra por co-responsável — casa se a pessoa estiver ENTRE os responsáveis", () => {
    expect(ids(filtrarTarefas(lista, { ...FILTRO_VAZIO, responsavelId: "2" }, AGORA))).toEqual([
      "b",
    ]);
    expect(filtrarTarefas(lista, { ...FILTRO_VAZIO, responsavelId: "1" }, AGORA)).toHaveLength(2);
  });

  it("as dimensões se somam (E, não OU)", () => {
    const r = filtrarTarefas(lista, { ...FILTRO_VAZIO, status: "to do", listaId: "l1" }, AGORA);
    expect(r).toHaveLength(0);
  });
});

describe("temFiltroAtivo", () => {
  it("o filtro vazio não está ativo", () => {
    expect(temFiltroAtivo(FILTRO_VAZIO)).toBe(false);
  });

  it("qualquer dimensão sozinha já ativa", () => {
    expect(temFiltroAtivo({ ...FILTRO_VAZIO, prazo: "hoje" })).toBe(true);
    expect(temFiltroAtivo({ ...FILTRO_VAZIO, status: "to do" })).toBe(true);
    expect(temFiltroAtivo({ ...FILTRO_VAZIO, prioridade: "baixa" })).toBe(true);
    expect(temFiltroAtivo({ ...FILTRO_VAZIO, listaId: "l1" })).toBe(true);
    expect(temFiltroAtivo({ ...FILTRO_VAZIO, responsavelId: "2" })).toBe(true);
  });
});

describe("opcoesDeFiltro", () => {
  const lista = [
    tarefa({
      id: "a",
      status: "in progress",
      prioridade: "baixa",
      listaId: "l2",
      listaNome: "Zulu",
      responsaveis: [{ id: "2", nome: "Colega", souEu: false }],
    }),
    tarefa({
      id: "b",
      status: "to do",
      prioridade: "urgente",
      listaId: "l1",
      listaNome: "Alfa",
      responsaveis: [{ id: "1", nome: "Eu", souEu: true }],
    }),
    tarefa({ id: "c", status: "to do", prioridade: "urgente", listaId: "l1", listaNome: "Alfa" }),
  ];

  it("deriva das tarefas carregadas, sem repetir", () => {
    const o = opcoesDeFiltro(lista);
    expect(o.status).toEqual(["in progress", "to do"]);
    expect(o.listas).toEqual([
      { id: "l1", nome: "Alfa" },
      { id: "l2", nome: "Zulu" },
    ]);
  });

  it("prioridade sai em ordem de URGÊNCIA, não alfabética", () => {
    // "alta, baixa, normal, urgente" seria uma lista sem sentido para escolher.
    expect(opcoesDeFiltro(lista).prioridades).toEqual(["urgente", "baixa"]);
  });

  it("'você' aparece primeiro e com esse rótulo, não com o nome", () => {
    expect(opcoesDeFiltro(lista).responsaveis).toEqual([
      { id: "1", nome: "você" },
      { id: "2", nome: "Colega" },
    ]);
  });

  it("lista vazia devolve todas as dimensões vazias", () => {
    expect(opcoesDeFiltro([])).toEqual({
      status: [],
      listas: [],
      prioridades: [],
      responsaveis: [],
    });
  });
});
