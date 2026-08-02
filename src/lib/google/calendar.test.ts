import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Prova do CONSUMIDOR da sincronização — a metade que `sync-plan.test.ts` não
 * alcança.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * `sync-plan.test.ts` prova o particionamento puro e o formato de `SyncPlan`.
 * Nenhum desses testes muda de cor se alguém trocar, aqui em `calendar.ts`, o
 * `.update({status:'cancelled'})` por um `.delete()`: `paraCancelar` continua
 * sendo `string[]`, o tipo continua com duas chaves e a suíte fica inteira
 * verde. Só que o `.delete()` dispara o `on delete cascade` das tabelas de
 * vínculo da 0009 e apaga, em silêncio, todo "esta tarefa nasceu daquela
 * reunião" — exatamente o que o soft delete foi decidido para impedir.
 *
 * A decisão entre APAGAR e MARCAR só é observável no I/O, então é o I/O que este
 * arquivo observa: um cliente Supabase falso que registra cada chamada, sem
 * banco e sem rede. Os testes abaixo travam três coisas que só existem aqui:
 * (1) cancelado vira UPDATE, nunca DELETE; (2) escrita que falha aborta ANTES de
 * o `next_sync_token` avançar; (3) a lista de cancelados vai em lotes, porque o
 * `.in()` do PostgREST viaja na URL.
 */

vi.mock("@/lib/crypto/tokens", () => ({
  // O teste não exercita criptografia — `tokens.test.ts` já faz isso. Aqui elas
  // são só o caminho até o access token, e precisam sair da frente.
  fromPgHex: (v: string) => Buffer.from(v.replace(/^\\x/, ""), "hex"),
  decryptRefreshToken: () => "refresh-token-falso",
}));

vi.mock("@/lib/google/oauth", () => ({
  refreshAccessToken: async () => ({ access_token: "access-token-falso", expires_in: 3600 }),
}));

// O `vi.mock` acima é içado para antes dos imports pelo transform do Vitest, e é
// por isso que este import estático já enxerga os dublês.
import { syncCalendarAccount } from "@/lib/google/calendar";

/* ------------------------------------------------------------ cliente falso */

/** Uma chamada ao cliente: a tabela e a cadeia de métodos, na ordem. */
interface Chamada {
  tabela: string;
  metodos: string[];
  args: unknown[][];
}

interface OpcoesDoFalso {
  /** Linhas de `calendar_sources` que a leitura devolve. */
  sources?: Record<string, unknown>[];
  /** Erro a devolver no upsert de `calendar_events`. */
  erroUpsert?: { message: string } | null;
  /** Erro a devolver no UPDATE de cancelamento de `calendar_events`. */
  erroCancelamento?: { message: string } | null;
}

/**
 * Cliente Supabase falso: cada método encadeável devolve o MESMO objeto e anota
 * o que foi chamado; a resolução acontece no `await`, quando a cadeia já está
 * completa. É por isso que o objeto é um "thenable" em vez de uma Promise — o
 * código de produção às vezes aguarda em `.upsert()`, às vezes em `.select()`,
 * às vezes em `.eq()`, e todos precisam funcionar.
 *
 * `delete` está deliberadamente presente na lista de métodos: se ele sumisse, um
 * `.delete()` reintroduzido explodiria com "not a function" e o teste falharia
 * pelo motivo errado (erro de digitação, e não regressão de comportamento). Do
 * jeito que está, o `.delete()` funciona, é REGISTRADO, e o teste falha
 * apontando o dedo para a linha certa.
 */
function criarAdminFalso(opts: OpcoesDoFalso = {}) {
  const chamadas: Chamada[] = [];

  function resolver(c: Chamada): { data: unknown; error: unknown } {
    if (c.tabela === "google_oauth_credentials") {
      return {
        data: { refresh_token_ciphertext: "\\x00", refresh_token_iv: "\\x00" },
        error: null,
      };
    }
    if (c.tabela === "calendar_sources") {
      if (c.metodos[0] === "select") return { data: opts.sources ?? [], error: null };
      return { data: null, error: null };
    }
    if (c.tabela === "calendar_events") {
      if (c.metodos[0] === "upsert") return { data: null, error: opts.erroUpsert ?? null };
      if (c.metodos[0] === "update") {
        if (opts.erroCancelamento) return { data: null, error: opts.erroCancelamento };
        // Simula "toda linha pedida existia e mudou": uma linha por id do
        // `.in()`. É o que faz `eventsCancelled` poder ser conferido.
        const idx = c.metodos.indexOf("in");
        const ids = (idx >= 0 ? (c.args[idx]?.[1] as string[]) : []) ?? [];
        return { data: ids.map((id) => ({ id: `local-${id}` })), error: null };
      }
      // Inclui o `delete`: devolver sucesso é proposital, para que a regressão
      // seja pega pela ASSERÇÃO e não por uma exceção acidental.
      return { data: [], error: null };
    }
    return { data: null, error: null };
  }

  const METODOS = [
    "select", "eq", "in", "or", "is", "neq", "order", "limit", "update", "upsert", "delete",
  ];

  function from(tabela: string) {
    const chamada: Chamada = { tabela, metodos: [], args: [] };
    chamadas.push(chamada);

    const consulta: Record<string, unknown> = {};
    for (const nome of METODOS) {
      consulta[nome] = (...args: unknown[]) => {
        chamada.metodos.push(nome);
        chamada.args.push(args);
        return consulta;
      };
    }
    consulta.single = () => {
      chamada.metodos.push("single");
      chamada.args.push([]);
      return Promise.resolve(resolver(chamada));
    };
    consulta.then = (
      aoResolver: (v: unknown) => unknown,
      aoRejeitar?: (e: unknown) => unknown,
    ) => Promise.resolve(resolver(chamada)).then(aoResolver, aoRejeitar);
    return consulta;
  }

  return { admin: { from } as unknown as SupabaseClient, chamadas };
}

/** Filtra as chamadas de uma tabela cuja cadeia começa pelo método dado. */
function chamadasDe(chamadas: Chamada[], tabela: string, metodo?: string): Chamada[] {
  return chamadas.filter((c) => c.tabela === tabela && (!metodo || c.metodos[0] === metodo));
}

/** O argumento de valores do `.in(coluna, valores)` de uma chamada. */
function idsDoIn(c: Chamada): string[] {
  const idx = c.metodos.indexOf("in");
  return idx >= 0 ? ((c.args[idx]?.[1] as string[]) ?? []) : [];
}

/* --------------------------------------------------------------- Google API */

interface RespostasDoGoogle {
  eventos: { id: string; status?: string; summary?: string }[];
  nextSyncToken?: string;
}

/** Responde as duas chamadas que a sincronização faz: calendarList e events. */
function mockarGoogle(resp: RespostasDoGoogle) {
  const fetchFalso = vi.fn(async (url: string | URL) => {
    const alvo = String(url);
    const corpo = alvo.includes("/users/me/calendarList")
      ? { items: [{ id: "cal-1", summary: "Principal", primary: true }] }
      : { items: resp.eventos, nextSyncToken: resp.nextSyncToken ?? "token-novo" };
    return {
      ok: true,
      status: 200,
      json: async () => corpo,
      text: async () => JSON.stringify(corpo),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchFalso);
  return fetchFalso;
}

const CONTA = { id: "acc-1", user_id: "user-1" };
const FONTES = [
  { id: "src-1", google_calendar_id: "cal-1", next_sync_token: "token-velho", is_enabled: true },
];

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("syncCalendarAccount — cancelamento é soft delete", () => {
  it("marca o cancelado com UPDATE e NUNCA apaga a linha", async () => {
    mockarGoogle({ eventos: [{ id: "g1", status: "confirmed" }, { id: "g2", status: "cancelled" }] });
    const { admin, chamadas } = criarAdminFalso({ sources: FONTES });

    const resultado = await syncCalendarAccount(admin, CONTA);

    // A asserção que trava a regressão: nada em `calendar_events` pode ser um
    // DELETE. Com o cascade da 0009, um DELETE aqui levaria junto
    // task_event_links e capture_event_links, sem erro e sem aviso.
    expect(chamadasDe(chamadas, "calendar_events", "delete")).toHaveLength(0);

    const updates = chamadasDe(chamadas, "calendar_events", "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.args[0]![0]).toEqual({ status: "cancelled" });
    expect(idsDoIn(updates[0]!)).toEqual(["g2"]);
    // O filtro NULL-SAFE precisa continuar lá: `.neq("status","cancelled")`
    // avaliaria para NULL na linha de status nulo e não a atualizaria.
    expect(updates[0]!.args[updates[0]!.metodos.indexOf("or")]![0]).toBe(
      "status.is.null,status.neq.cancelled",
    );

    expect(resultado.eventsCancelled).toBe(1);
    expect(resultado.eventsUpserted).toBe(1);
  });

  it("sem cancelados, não emite UPDATE nenhum", async () => {
    mockarGoogle({ eventos: [{ id: "g1", status: "confirmed" }] });
    const { admin, chamadas } = criarAdminFalso({ sources: FONTES });

    const resultado = await syncCalendarAccount(admin, CONTA);

    expect(chamadasDe(chamadas, "calendar_events", "update")).toHaveLength(0);
    expect(chamadasDe(chamadas, "calendar_events", "delete")).toHaveLength(0);
    expect(resultado.eventsCancelled).toBe(0);
  });
});

describe("syncCalendarAccount — o next_sync_token não avança sobre escrita perdida", () => {
  /**
   * ESTE É O TESTE QUE IMPORTA MAIS.
   *
   * A coleta incremental só devolve o que mudou DESDE o token. Se o token avança
   * depois de um PATCH que falhou, o Google nunca mais reenvia aquele evento —
   * nada mudou nele — e a linha local fica divergente PARA SEMPRE, com o
   * relatório da sincronização informando sucesso.
   */
  it("falha no cancelamento aborta antes de gravar o token e de marcar 'connected'", async () => {
    mockarGoogle({ eventos: [{ id: "g2", status: "cancelled" }] });
    const { admin, chamadas } = criarAdminFalso({
      sources: FONTES,
      erroCancelamento: { message: "414 URI Too Long" },
    });

    await expect(syncCalendarAccount(admin, CONTA)).rejects.toThrow(/414/);

    const gravouToken = chamadasDe(chamadas, "calendar_sources", "update").some(
      (c) => (c.args[0]![0] as { next_sync_token?: string }).next_sync_token === "token-novo",
    );
    expect(gravouToken).toBe(false);
    // E a conta não pode ser marcada como saudável: quem chama (rota de sync e
    // callback do OAuth) é que registra status 'error' ao pegar a exceção.
    expect(chamadasDe(chamadas, "calendar_accounts", "update")).toHaveLength(0);
  });

  it("falha no upsert aborta antes de gravar o token", async () => {
    mockarGoogle({ eventos: [{ id: "g1", status: "confirmed" }] });
    const { admin, chamadas } = criarAdminFalso({
      sources: FONTES,
      erroUpsert: { message: "timeout" },
    });

    await expect(syncCalendarAccount(admin, CONTA)).rejects.toThrow(/timeout/);

    const gravouToken = chamadasDe(chamadas, "calendar_sources", "update").some(
      (c) => (c.args[0]![0] as { next_sync_token?: string }).next_sync_token === "token-novo",
    );
    expect(gravouToken).toBe(false);
  });

  it("com tudo gravado, o token avança e a conta volta a 'connected'", async () => {
    mockarGoogle({ eventos: [{ id: "g2", status: "cancelled" }], nextSyncToken: "token-novo" });
    const { admin, chamadas } = criarAdminFalso({ sources: FONTES });

    await syncCalendarAccount(admin, CONTA);

    const gravouToken = chamadasDe(chamadas, "calendar_sources", "update").some(
      (c) => (c.args[0]![0] as { next_sync_token?: string }).next_sync_token === "token-novo",
    );
    expect(gravouToken).toBe(true);
    expect(chamadasDe(chamadas, "calendar_accounts", "update")).toHaveLength(1);
  });
});

describe("syncCalendarAccount — a lista de cancelados vai em lotes", () => {
  /**
   * O `.in()` do PostgREST vira `google_event_id=in.(g1,g2,…)` na QUERY STRING
   * do PATCH, não no corpo. Uma série diária cancelada com singleEvents=true
   * gera uma instância cancelada por ocorrência; centenas de ids num `.in()` só
   * estouram o limite de URL do gateway (414) antes de a consulta chegar ao
   * Postgres.
   */
  it("divide 250 cancelados em lotes e não perde nenhum id", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `evento-recorrente-${i}@google.com`);
    mockarGoogle({ eventos: ids.map((id) => ({ id, status: "cancelled" })) });
    const { admin, chamadas } = criarAdminFalso({ sources: FONTES });

    const resultado = await syncCalendarAccount(admin, CONTA);

    const updates = chamadasDe(chamadas, "calendar_events", "update");
    expect(updates.length).toBeGreaterThan(1);
    for (const u of updates) expect(idsDoIn(u).length).toBeLessThanOrEqual(100);
    // União dos lotes = a lista inteira, sem repetição e sem sobra.
    expect(updates.flatMap(idsDoIn).sort()).toEqual([...ids].sort());
    // A contagem soma os lotes, e não o tamanho do último.
    expect(resultado.eventsCancelled).toBe(250);
  });
});
