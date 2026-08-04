import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TETO_DE_LISTAS_POR_LISTAGEM,
  gravarStatusEmCache,
  lerStatusEmCache,
  listasEmCache,
  resolverStatusDasListas,
  zerarCacheDeStatus,
} from "./cache-de-status";
import type { StatusPossivel } from "./types";

const HORA = 60 * 60 * 1000;
const T0 = new Date("2026-08-04T12:00:00.000Z").getTime();

const STATUSES: StatusPossivel[] = [
  { status: "backlog", type: "open", cor: null, ordem: 0 },
  { status: "fazendo", type: "custom", cor: null, ordem: 1 },
];

beforeEach(() => {
  zerarCacheDeStatus();
});

describe("o cache em si", () => {
  it("devolve o que guardou", () => {
    gravarStatusEmCache("l1", STATUSES, T0);
    expect(lerStatusEmCache("l1", T0)).toEqual(STATUSES);
  });

  it("lista desconhecida é null, não lista vazia", () => {
    // `[]` seria interpretado por `faseNaLista` como "lista sem status" e a
    // classificação viraria null de qualquer jeito — mas o caminho é outro, e
    // confundir "não sei" com "sei que está vazio" esconde o motivo.
    expect(lerStatusEmCache("nunca-vista", T0)).toBeNull();
  });

  it("expira em uma hora, e a entrada morta sai da memória", () => {
    gravarStatusEmCache("l1", STATUSES, T0);
    expect(lerStatusEmCache("l1", T0 + HORA - 1)).not.toBeNull();
    expect(lerStatusEmCache("l1", T0 + HORA)).toBeNull();
    // A leitura expirada apaga: sem isso, uma lista consultada uma vez ocuparia
    // memória para sempre.
    expect(listasEmCache()).toBe(0);
  });
});

describe("resolverStatusDasListas", () => {
  it("⚠️ EM REGIME, ZERO CHAMADA — é o que impede o 429", () => {
    /*
      Sem cache, abrir a aba com tarefas de 12 listas passaria a custar 12
      requisições A CADA carregamento, somadas às até 5 páginas da listagem. O
      limite é da conta pessoal dentro do workspace da empresa: trocar "a coluna
      está errada" por "a integração parou" seria um péssimo negócio.
    */
    return (async () => {
      const buscar = vi.fn(async () => STATUSES);

      await resolverStatusDasListas(["l1", "l2"], buscar, T0);
      expect(buscar).toHaveBeenCalledTimes(2);

      buscar.mockClear();
      const segunda = await resolverStatusDasListas(["l1", "l2"], buscar, T0 + 1000);
      expect(buscar).not.toHaveBeenCalled();
      expect(segunda.porLista.get("l1")).toEqual(STATUSES);
    })();
  });

  it("não repete a mesma lista dentro de uma listagem", () => {
    // 500 tarefas da mesma lista são UMA busca, não 500.
    return (async () => {
      const buscar = vi.fn(async () => STATUSES);
      await resolverStatusDasListas(["l1", "l1", "l1"], buscar, T0);
      expect(buscar).toHaveBeenCalledTimes(1);
    })();
  });

  it("⚠️ TETO RÍGIDO — nunca um laço de N chamadas sem limite", async () => {
    const ids = Array.from({ length: TETO_DE_LISTAS_POR_LISTAGEM + 5 }, (_, i) => `l${i}`);
    const buscar = vi.fn(async () => STATUSES);

    const r = await resolverStatusDasListas(ids, buscar, T0);

    expect(buscar).toHaveBeenCalledTimes(TETO_DE_LISTAS_POR_LISTAGEM);
    expect(r.naoResolvidas).toHaveLength(5);
    // Degrada, não quebra: as listas que sobraram simplesmente não entram no
    // mapa, e as tarefas delas caem em `faseDoStatus`.
    expect(r.porLista.size).toBe(TETO_DE_LISTAS_POR_LISTAGEM);
  });

  it("o que já está em cache NÃO consome o teto", async () => {
    // Cache não custa chamada; contá-lo contra o teto faria uma listagem
    // repetida resolver menos listas que a primeira.
    for (let i = 0; i < TETO_DE_LISTAS_POR_LISTAGEM; i++) {
      gravarStatusEmCache(`c${i}`, STATUSES, T0);
    }
    const ids = [
      ...Array.from({ length: TETO_DE_LISTAS_POR_LISTAGEM }, (_, i) => `c${i}`),
      "nova",
    ];
    const buscar = vi.fn(async () => STATUSES);

    const r = await resolverStatusDasListas(ids, buscar, T0);

    expect(buscar).toHaveBeenCalledTimes(1);
    expect(r.naoResolvidas).toHaveLength(0);
    expect(r.porLista.size).toBe(TETO_DE_LISTAS_POR_LISTAGEM + 1);
  });

  it("⚠️ uma lista que falha não derruba as outras", async () => {
    // Falhar tudo por causa de uma lista apagada seria trocar um defeito
    // visível (uma coluna errada) por um apagão.
    const buscar = vi.fn(async (id: string) => {
      if (id === "ruim") throw new Error("404");
      return STATUSES;
    });

    const r = await resolverStatusDasListas(["boa", "ruim"], buscar, T0);

    expect(r.porLista.get("boa")).toEqual(STATUSES);
    expect(r.porLista.has("ruim")).toBe(false);
  });

  it("resposta vazia não ocupa o cache por uma hora", async () => {
    // Uma lista que respondeu sem status não é resposta útil; guardá-la
    // significaria uma hora sem tentar de novo.
    const buscar = vi.fn(async () => [] as StatusPossivel[]);
    await resolverStatusDasListas(["l1"], buscar, T0);
    expect(lerStatusEmCache("l1", T0)).toBeNull();
  });

  it("lista sem id nenhum não chama nada", async () => {
    const buscar = vi.fn(async () => STATUSES);
    const r = await resolverStatusDasListas([], buscar, T0);
    expect(buscar).not.toHaveBeenCalled();
    expect(r.porLista.size).toBe(0);
  });
});

describe("a memória não cresce sem fim", () => {
  it("acima do teto de entradas, o expirado é podado", () => {
    // Sem timer de fundo — ver o cabeçalho do módulo. A poda é preguiçosa,
    // dentro da própria gravação.
    for (let i = 0; i < 250; i++) {
      gravarStatusEmCache(`velha${i}`, STATUSES, T0);
    }
    expect(listasEmCache()).toBeLessThanOrEqual(200);

    // Muito tempo depois, uma gravação nova varre tudo o que expirou.
    gravarStatusEmCache("nova", STATUSES, T0 + 2 * HORA);
    expect(listasEmCache()).toBe(1);
  });
});
