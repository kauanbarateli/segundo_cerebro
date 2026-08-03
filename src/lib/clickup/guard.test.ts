import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { garantirResponsavel } from "./guard";
import { ErroClickUp } from "./erros";

/**
 * A invariante I3 — toda escrita verifica a responsabilidade antes.
 *
 * O cenário que estes casos cobrem não é hipotético: Server Action é endpoint
 * HTTP público, e `mudarStatusClickUp(taskId, status)` pode ser chamada com
 * qualquer id do workspace, direto por POST, sem passar pela tela.
 */

const TOKEN = "pk_123_TOKENFALSO";
const EU = "12345";

let fetchFalso: ReturnType<typeof vi.fn>;

function resposta(corpo: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(corpo),
  } as unknown as Response;
}

beforeEach(() => {
  fetchFalso = vi.fn();
  vi.stubGlobal("fetch", fetchFalso);
});

afterEach(() => vi.unstubAllGlobals());

describe("garantirResponsavel", () => {
  it("aceita quando eu estou entre os responsáveis", async () => {
    fetchFalso.mockResolvedValue(
      resposta({ id: "abc", name: "Minha tarefa", assignees: [{ id: 999 }, { id: 12345 }] }),
    );
    const tarefa = await garantirResponsavel(TOKEN, "abc", EU);
    expect(tarefa.id).toBe("abc");
  });

  it("compara por STRING — a API mistura number e string no mesmo campo", async () => {
    // `12345 === "12345"` é false. Sem a normalização, TODA escrita seria
    // recusada, com uma mensagem culpando a atribuição da tarefa.
    fetchFalso.mockResolvedValue(resposta({ id: "abc", assignees: [{ id: 12345 }] }));
    await expect(garantirResponsavel(TOKEN, "abc", "12345")).resolves.toBeTruthy();

    fetchFalso.mockResolvedValue(resposta({ id: "abc", assignees: [{ id: "12345" }] }));
    await expect(garantirResponsavel(TOKEN, "abc", "12345")).resolves.toBeTruthy();
  });

  it("RECUSA tarefa de outra pessoa — o caso que a invariante existe para fechar", async () => {
    fetchFalso.mockResolvedValue(
      resposta({ id: "do-colega", name: "Tarefa do colega", assignees: [{ id: 999 }] }),
    );
    const erro = await garantirResponsavel(TOKEN, "do-colega", EU).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroClickUp);
    expect((erro as ErroClickUp).motivo).toBe("nao_sou_responsavel");
  });

  it("RECUSA tarefa sem responsável nenhum", async () => {
    fetchFalso.mockResolvedValue(resposta({ id: "abc", assignees: [] }));
    await expect(garantirResponsavel(TOKEN, "abc", EU)).rejects.toBeInstanceOf(ErroClickUp);
  });

  it("RECUSA quando o campo assignees nem vem", async () => {
    fetchFalso.mockResolvedValue(resposta({ id: "abc" }));
    await expect(garantirResponsavel(TOKEN, "abc", EU)).rejects.toBeInstanceOf(ErroClickUp);
  });

  it("FALHA FECHADA: erro de rede na verificação recusa a operação", async () => {
    /*
      O caso mais importante do arquivo. A tentação é tratar "não deu para
      checar" como "segue". O custo de recusar uma operação legítima é o
      usuário clicar de novo; o custo de permitir uma ilegítima é escrever na
      tarefa de outra pessoa.
    */
    fetchFalso.mockRejectedValue(new Error("ECONNRESET"));
    await expect(garantirResponsavel(TOKEN, "abc", EU)).rejects.toBeInstanceOf(ErroClickUp);
  });

  it("FALHA FECHADA: 401 na verificação também recusa", async () => {
    fetchFalso.mockResolvedValue(resposta({ err: "Token invalid" }, 401));
    await expect(garantirResponsavel(TOKEN, "abc", EU)).rejects.toBeInstanceOf(ErroClickUp);
  });

  it("FALHA FECHADA: 404 recusa em vez de assumir que pode", async () => {
    fetchFalso.mockResolvedValue(resposta({ err: "not found" }, 404));
    await expect(garantirResponsavel(TOKEN, "inexistente", EU)).rejects.toBeInstanceOf(
      ErroClickUp,
    );
  });

  it("devolve a tarefa para o chamador não buscar de novo", async () => {
    // `mudarStatus` precisa da lista para validar o status contra os status
    // daquela lista. Sem devolver, a verificação custaria dois GET por escrita.
    fetchFalso.mockResolvedValue(
      resposta({ id: "abc", assignees: [{ id: 12345 }], list: { id: "lista1" } }),
    );
    const tarefa = await garantirResponsavel(TOKEN, "abc", EU);
    expect(tarefa.list?.id).toBe("lista1");
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });
});
