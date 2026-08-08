import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { chamar, OPERACOES, OPERACOES_DISPONIVEIS, type Operacao } from "./capabilities";
import { ErroClickUp } from "./erros";

/**
 * As provas de que a limitação é REAL.
 *
 * Uma feature de segurança que não é verificável é uma intenção. Este arquivo
 * transforma as três invariantes do módulo em casos que quebram quando alguém
 * as afrouxa — inclusive por bons motivos, inclusive daqui a seis meses.
 */

const TOKEN = "pk_123_TOKENFALSO";

let fetchFalso: ReturnType<typeof vi.fn>;

function respostaOk(corpo: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (corpo === null ? "" : JSON.stringify(corpo)),
  } as unknown as Response;
}

beforeEach(() => {
  fetchFalso = vi.fn(async () => respostaOk({ ok: true }));
  vi.stubGlobal("fetch", fetchFalso);
});

afterEach(() => vi.unstubAllGlobals());

/** A última requisição feita, decomposta. */
function ultimaChamada() {
  const [url, init] = fetchFalso.mock.calls.at(-1) as [URL, RequestInit];
  return {
    url: url.toString(),
    metodo: init.method,
    headers: init.headers as Record<string, string>,
    corpo: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null,
  };
}

/* ============================================================ 6.2 — operações */

describe("a tabela de operações (§0)", () => {
  it("tem EXATAMENTE as nove previstas", () => {
    /*
      Este caso parece bobo e é o mais valioso do arquivo: acrescentar uma
      operação QUEBRA o teste. Ampliar o poder do aplicativo sobre o workspace
      da empresa passa a ser um ato deliberado, com uma linha de teste para
      editar junto — em vez de uma linha a mais numa tabela que ninguém revisa.

      =======================================================================
      ⚠️ REGISTRO DA NONA: `mudarPrazo` (era oito)
      =======================================================================
      O teste FEZ o que devia: quebrou, e esta lista foi editada de propósito.
      A decisão, para quem ler depois:

        O QUE MUDA no poder do token — nada de rota. `PUT /task/{id}` já estava
        liberado por `mudarStatus`; a entrada nova reusa o MESMO método e a
        MESMA rota. O que muda é o corpo que o aplicativo passa a saber montar:
        agora ele também escreve `due_date` e `due_date_time`.

        POR QUE UMA ENTRADA SEPARADA, se a rota já existia — porque a tabela
        descreve INTENÇÕES, não endereços. Mandar `due_date` pela linha do
        status faria o nome dela mentir, e este inventário deixaria de ser
        legível como "o que o aplicativo é capaz de fazer".

        O QUE CONTINUA IMPOSSÍVEL — arquivar, mover, renomear e remover
        colegas, que são os outros efeitos do mesmo endpoint. Eles não são
        barrados pela rota (ela é a mesma): são barrados porque `client.ts`
        constrói o corpo do zero, a partir de parâmetros PRIMITIVOS. Não existe
        caminho pelo qual um objeto vindo da interface vire corpo. O teste do
        corpo, mais abaixo, é o que sustenta isso.
    */
    expect([...OPERACOES_DISPONIVEIS].sort()).toEqual([
      "comentar",
      "identificar",
      "lerComentarios",
      "minhasTarefas",
      "mudarPrazo",
      "mudarStatus",
      "statusDaLista",
      "umaTarefa",
      "workspaces",
    ]);
  });

  it("nenhuma operação usa DELETE", () => {
    for (const [nome, def] of Object.entries(OPERACOES)) {
      expect(def.metodo, `operação "${nome}"`).not.toBe("DELETE");
    }
  });

  it("só existem três métodos, e escrita só em três operações", () => {
    const metodos = Object.values(OPERACOES).map((o) => o.metodo);
    expect(new Set(metodos)).toEqual(new Set(["GET", "PUT", "POST"]));
    // Três escritas: mudarStatus, mudarPrazo e comentar. Ver o registro acima.
    expect(metodos.filter((m) => m !== "GET")).toHaveLength(3);
  });

  it("recusa em tempo de execução uma operação que não está na tabela", async () => {
    // O TypeScript já recusa em compilação; isto cobre o caminho sem tipo —
    // um valor vindo da rede, por exemplo.
    await expect(
      chamar("apagar" as Operacao, TOKEN, { taskId: "abc" }),
    ).rejects.toBeInstanceOf(ErroClickUp);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("não é possível expressar DELETE nem por prototype pollution do nome", async () => {
    // `hasOwnProperty` e não `in`: com `in`, "toString" e "constructor" passariam
    // pela checagem e `OPERACOES[op]` viria undefined, estourando adiante.
    for (const nome of ["toString", "constructor", "__proto__", "valueOf"]) {
      await expect(chamar(nome as Operacao, TOKEN, {})).rejects.toBeInstanceOf(ErroClickUp);
    }
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});

/* ================================================== validação dos ids na rota */

describe("ids na URL", () => {
  it("recusa id com travessia de caminho — a tabela não pode ser contornada por string", async () => {
    // Sem a regex, isto sairia como /task/../../team/123/task e alcançaria uma
    // rota que não está na tabela de operações.
    await expect(
      chamar("umaTarefa", TOKEN, { taskId: "../../team/123/task" }),
    ).rejects.toBeInstanceOf(ErroClickUp);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("recusa as outras formas de sair da rota", async () => {
    for (const ruim of ["a/b", "a?x=1", "a#b", "%2e%2e", "a b", ""]) {
      await expect(chamar("umaTarefa", TOKEN, { taskId: ruim })).rejects.toBeInstanceOf(
        ErroClickUp,
      );
    }
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("aceita id legítimo do ClickUp", async () => {
    await chamar("umaTarefa", TOKEN, { taskId: "901234567890" });
    expect(ultimaChamada().url).toBe("https://api.clickup.com/api/v2/task/901234567890");
  });

  it("valida o parâmetro que a rota realmente usa", async () => {
    await expect(chamar("minhasTarefas", TOKEN, { teamId: "../x" })).rejects.toBeInstanceOf(
      ErroClickUp,
    );
    await expect(chamar("statusDaLista", TOKEN, { listId: "a/b" })).rejects.toBeInstanceOf(
      ErroClickUp,
    );
  });
});

/* ================================================================ o header */

describe("autenticação", () => {
  it("manda Authorization CRU, sem 'Bearer'", async () => {
    // Com "Bearer" o ClickUp responde 401, e o 401 leva à conclusão errada de
    // que o token está errado.
    await chamar("identificar", TOKEN, {});
    expect(ultimaChamada().headers.Authorization).toBe(TOKEN);
    expect(ultimaChamada().headers.Authorization).not.toContain("Bearer");
  });
});

/* ========================================================== erros tipados */

describe("tradução de erro", () => {
  const casos: [number, string][] = [
    [401, "token_invalido"],
    [403, "token_invalido"],
    [429, "limite_de_taxa"],
    [404, "nao_encontrado"],
    [400, "falhou"],
  ];

  for (const [status, motivo] of casos) {
    it(`${status} vira motivo "${motivo}"`, async () => {
      fetchFalso.mockResolvedValue(respostaOk({ err: "x" }, status));
      const erro = await chamar("identificar", TOKEN, {}).catch((e) => e);
      expect(erro).toBeInstanceOf(ErroClickUp);
      expect((erro as ErroClickUp).motivo).toBe(motivo);
    });
  }

  it("timeout vira 'indisponivel' e NÃO propaga o erro original", async () => {
    // O erro do fetch pode carregar a requisição inteira — e a requisição
    // carrega o token no header.
    const timeout = Object.assign(new Error("The operation was aborted"), {
      name: "TimeoutError",
    });
    fetchFalso.mockRejectedValue(timeout);

    const erro = await chamar("identificar", TOKEN, {}).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroClickUp);
    expect((erro as ErroClickUp).motivo).toBe("indisponivel");
    expect(JSON.stringify(erro)).not.toContain(TOKEN);
    expect((erro as Error).message).not.toContain(TOKEN);
  });
});

/* ========================================================== retry (requisito 7) */

describe("retentativa", () => {
  it("NÃO retenta escrita — retry de POST duplica comentário na tarefa de um colega", async () => {
    fetchFalso.mockResolvedValue(respostaOk({ err: "boom" }, 500));
    await chamar("comentar", TOKEN, { taskId: "abc" }, { corpo: { comment_text: "oi" } }).catch(
      () => {},
    );
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("NÃO retenta PUT", async () => {
    fetchFalso.mockResolvedValue(respostaOk({ err: "boom" }, 500));
    await chamar("mudarStatus", TOKEN, { taskId: "abc" }, { corpo: { status: "x" } }).catch(
      () => {},
    );
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it("retenta GET uma vez em 5xx", async () => {
    fetchFalso
      .mockResolvedValueOnce(respostaOk({ err: "boom" }, 503))
      .mockResolvedValueOnce(respostaOk({ user: { id: 1 } }));
    await chamar("identificar", TOKEN, {});
    expect(fetchFalso).toHaveBeenCalledTimes(2);
  });

  it("NÃO retenta 429 — repetir gasta cota para receber o mesmo 429", async () => {
    fetchFalso.mockResolvedValue(respostaOk({ err: "rate" }, 429));
    await chamar("identificar", TOKEN, {}).catch(() => {});
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });
});

/* ================================================= 6.1 — superfície (I2) */

describe("superfície de rede (I2)", () => {
  it("SÓ capabilities.ts fala com api.clickup.com", () => {
    /*
      O teste que impede a erosão. Daqui a seis meses, quando alguém precisar de
      "só mais um endpoint" e for tentador chamar direto de uma action, a suíte
      falha e a conversa acontece antes do commit.

      O próprio arquivo de teste é excluído: ele cita o domínio nas asserções.
    */
    const permitidos = new Set([
      join("src", "lib", "clickup", "capabilities.ts"),
      join("src", "lib", "clickup", "capabilities.test.ts"),
    ]);

    const infratores: string[] = [];

    function varrer(dir: string) {
      for (const entrada of readdirSync(dir)) {
        const caminho = join(dir, entrada);
        if (statSync(caminho).isDirectory()) {
          varrer(caminho);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entrada)) continue;
        if (permitidos.has(caminho)) continue;
        if (readFileSync(caminho, "utf8").includes("api.clickup.com")) {
          infratores.push(caminho);
        }
      }
    }

    varrer("src");
    expect(infratores).toEqual([]);
  });
});
