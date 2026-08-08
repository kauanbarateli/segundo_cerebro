import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  comentar,
  identificar,
  listarMinhasTarefas,
  mudarPrazo,
  mudarStatus,
  statusDaLista,
} from "./client";
import { ErroClickUp } from "./erros";

/**
 * 6.3 — A PROVA DO CORPO (§1 do plano).
 *
 * `PUT /task/{id}` não é "o endpoint de mudar status": é o de ALTERAR TAREFA, e
 * o que ele faz depende do corpo. Renomear, reescrever a descrição, mudar
 * prazo, ARQUIVAR e — o pior — `assignees: { rem: [...] }`, que tira um colega
 * da tarefa, são todos o mesmo PUT.
 *
 * Um allowlist por rota deixaria tudo isso passar. Estes casos afirmam sobre o
 * que de fato viaja na requisição.
 */

const TOKEN = "pk_123_TOKENFALSO";

let fetchFalso: ReturnType<typeof vi.fn>;

function resposta(corpo: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => (corpo === null ? "" : JSON.stringify(corpo)),
  } as unknown as Response;
}

beforeEach(() => {
  fetchFalso = vi.fn(async () => resposta({}));
  vi.stubGlobal("fetch", fetchFalso);
});

afterEach(() => vi.unstubAllGlobals());

function ultima() {
  const [url, init] = fetchFalso.mock.calls.at(-1) as [URL, RequestInit];
  return {
    url: new URL(url.toString()),
    metodo: init.method,
    corpo: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null,
  };
}

describe("mudarStatus — o corpo tem EXATAMENTE uma chave", () => {
  it("manda { status } e nada mais", async () => {
    await mudarStatus(TOKEN, "901234567890", "in progress");
    const { corpo, metodo, url } = ultima();

    expect(metodo).toBe("PUT");
    expect(url.pathname).toBe("/api/v2/task/901234567890");
    expect(corpo).toEqual({ status: "in progress" });
    expect(Object.keys(corpo!)).toHaveLength(1);
  });

  it("os campos perigosos do PUT NÃO aparecem na requisição", async () => {
    await mudarStatus(TOKEN, "abc", "done");
    const chaves = Object.keys(ultima().corpo!);

    // Cada um destes altera a tarefa de um jeito que o aplicativo não deve ser
    // capaz de fazer. `assignees` é o mais grave: tira um colega da tarefa.
    for (const proibido of [
      "assignees",
      "archived",
      "name",
      "description",
      "due_date",
      "priority",
      "parent",
      "time_estimate",
    ]) {
      expect(chaves).not.toContain(proibido);
    }
  });

  it("não há por onde injetar campo: `status` é string, não objeto", async () => {
    /*
      A prova de que a limitação é ESTRUTURAL e não uma lista de bloqueio.
      Mesmo forçando o tipo (como faria uma chamada vinda da rede), o valor
      inteiro vira o conteúdo de `status` — não vira chaves irmãs.
    */
    const hostil = { status: "done", archived: true, name: "renomeada" } as unknown as string;
    await mudarStatus(TOKEN, "abc", hostil);

    const corpo = ultima().corpo!;
    expect(Object.keys(corpo)).toEqual(["status"]);
    expect(corpo.archived).toBeUndefined();
    expect(corpo.name).toBeUndefined();
  });
});

describe("comentar", () => {
  it("manda comment_text e notify_all: false", async () => {
    fetchFalso.mockResolvedValue(resposta({ id: "c1" }));
    await comentar(TOKEN, "abc", "meu comentário");

    const { corpo, metodo } = ultima();
    expect(metodo).toBe("POST");
    expect(corpo).toEqual({ comment_text: "meu comentário", notify_all: false });
  });

  it("notify_all é sempre false — comentário daqui não notifica o time inteiro", async () => {
    fetchFalso.mockResolvedValue(resposta({ id: "c1" }));
    await comentar(TOKEN, "abc", "x");
    expect(ultima().corpo!.notify_all).toBe(false);
  });
});

describe("listarMinhasTarefas — o filtro de responsável não é opcional", () => {
  it("SEMPRE manda assignees[] com o meu id", async () => {
    // Sem o filtro, GET /team/{id}/task devolve o workspace INTEIRO — todas as
    // tarefas de todos os colegas.
    fetchFalso.mockResolvedValue(resposta({ tasks: [], last_page: true }));
    await listarMinhasTarefas(TOKEN, { teamId: "999", meuId: "12345" });

    const { url } = ultima();
    expect(url.searchParams.getAll("assignees[]")).toEqual(["12345"]);
    expect(url.searchParams.get("include_closed")).toBe("false");
  });

  it("para de paginar quando a API diz que é a última página", async () => {
    fetchFalso.mockResolvedValue(resposta({ tasks: [{ id: "1", name: "a" }], last_page: true }));
    const r = await listarMinhasTarefas(TOKEN, { teamId: "999", meuId: "1" });
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    expect(r.truncado).toBe(false);
  });

  it("respeita o teto de 5 páginas e AVISA que truncou", async () => {
    // Um workspace enorme (ou um dia em que a API ignore o filtro) viraria um
    // laço consumindo a cota da conta. O teto transforma o pior caso em "a tela
    // diz que há mais".
    const cheia = { tasks: Array.from({ length: 100 }, (_, i) => ({ id: `t${i}`, name: "x" })) };
    fetchFalso.mockResolvedValue(resposta(cheia));

    const r = await listarMinhasTarefas(TOKEN, { teamId: "999", meuId: "1" });
    expect(fetchFalso).toHaveBeenCalledTimes(5);
    expect(r.tarefas).toHaveLength(500);
    expect(r.truncado).toBe(true);
  });

  it("passa space_ids só quando há filtro", async () => {
    fetchFalso.mockResolvedValue(resposta({ tasks: [], last_page: true }));

    await listarMinhasTarefas(TOKEN, { teamId: "9", meuId: "1", spaceIds: [] });
    expect(ultima().url.searchParams.has("space_ids[]")).toBe(false);

    await listarMinhasTarefas(TOKEN, { teamId: "9", meuId: "1", spaceIds: ["s1", "s2"] });
    expect(ultima().url.searchParams.getAll("space_ids[]")).toEqual(["s1", "s2"]);
  });
});

describe("leituras simples", () => {
  it("identificar normaliza o id numérico para string", async () => {
    // A API devolve number em algumas rotas e string em outras; a comparação
    // do guard é por string, então a normalização precisa acontecer na borda.
    fetchFalso.mockResolvedValue(resposta({ user: { id: 12345, username: "Kauan" } }));
    const eu = await identificar(TOKEN);
    expect(eu.id).toBe("12345");
    expect(typeof eu.id).toBe("string");
  });

  it("statusDaLista devolve ordenado por orderindex", async () => {
    fetchFalso.mockResolvedValue(
      resposta({
        statuses: [
          { status: "done", orderindex: 2, color: "#0f0" },
          { status: "todo", orderindex: 0, color: "#888" },
          { status: "doing", orderindex: 1, color: "#00f" },
        ],
      }),
    );
    const s = await statusDaLista(TOKEN, "lista1");
    expect(s.map((x) => x.status)).toEqual(["todo", "doing", "done"]);
  });
});

/* ========================================================================== */
/*  mudarPrazo — o corpo tem EXATAMENTE duas chaves                           */
/* ========================================================================== */

describe("mudarPrazo — o corpo tem EXATAMENTE duas chaves", () => {
  it("manda só due_date e due_date_time, no PUT da tarefa", async () => {
    await mudarPrazo(TOKEN, "901234567890", 1_775_000_000_000, true);
    const { corpo, metodo, url } = ultima();

    expect(metodo).toBe("PUT");
    // `url.pathname` e não a URL inteira, como nos casos acima — e a razão é
    // literal: a varredura de `capabilities.test.ts` reprova qualquer arquivo
    // de `src/` que CONTENHA o domínio da API, inclusive dentro de um
    // comentário. O caminho já identifica a rota, que é o que importa aqui.
    expect(url.pathname).toBe("/api/v2/task/901234567890");
    expect(corpo).toEqual({ due_date: 1_775_000_000_000, due_date_time: true });
    expect(Object.keys(corpo!)).toHaveLength(2);
  });

  /**
   * ⚠️ O TESTE QUE IMPORTA.
   *
   * `PUT /task/{id}` é o endpoint de ALTERAR TAREFA: o mesmo que arquiva, move,
   * renomeia e remove colegas, dependendo do corpo. A rota está liberada; o que
   * impede o abuso é o corpo ser construído do zero a partir de parâmetros
   * PRIMITIVOS — não há caminho por onde um objeto vindo da interface chegue
   * até aqui.
   *
   * Este caso prova isso empurrando um objeto hostil no lugar do timestamp.
   */
  it("não deixa chave extra entrar, nem por objeto forjado no lugar do prazo", async () => {
    const hostil = {
      valueOf: () => 1_775_000_000_000,
      archived: true,
      assignees: { rem: [123] },
      name: "renomeada",
    } as unknown as number;

    await mudarPrazo(TOKEN, "abc", hostil, true);

    const corpo = ultima().corpo!;
    expect(Object.keys(corpo).sort()).toEqual(["due_date", "due_date_time"]);
    expect(corpo.archived).toBeUndefined();
    expect(corpo.assignees).toBeUndefined();
    expect(corpo.name).toBeUndefined();
  });

  /**
   * `due_date_time: false` é o que diz "dia inteiro, sem hora".
   *
   * Omitir o campo faria o ClickUp assumir false sozinho, e toda tarefa com
   * hora marcada passaria a exibir 00:00 — que a interface dele mostra como
   * VENCIDA desde a meia-noite. É o mesmo defeito da Etapa 1 em outro módulo.
   */
  it("distingue dia inteiro de hora marcada", async () => {
    await mudarPrazo(TOKEN, "abc", 1_775_000_000_000, false);
    expect(ultima().corpo!.due_date_time).toBe(false);

    await mudarPrazo(TOKEN, "abc", 1_775_000_000_000, true);
    expect(ultima().corpo!.due_date_time).toBe(true);
  });

  it("null limpa o prazo — é operação legítima, não erro", async () => {
    await mudarPrazo(TOKEN, "abc", null, false);
    expect(ultima().corpo).toEqual({ due_date: null, due_date_time: false });
  });

  it("recusa id de tarefa malformado antes de chamar a rede", async () => {
    await expect(mudarPrazo(TOKEN, "../../user", 1, true)).rejects.toBeInstanceOf(ErroClickUp);
  });
});
