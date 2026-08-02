import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SB-SEC-011 — a rota de sync autentica ANTES de tocar no corpo.
 *
 * Esta rota é a única isenta do portão de sessão do middleware, então é o único
 * caminho que um anônimo alcança de fato. O defeito era `await request.json()`
 * acontecer antes da checagem de sessão: o 401 chegava, mas só depois de o
 * servidor ter desserializado JSON arbitrário de graça para quem quisesse.
 *
 * COMO O TESTE PROVA ISSO, e por que não bastaria conferir o status: um 401
 * continua sendo 401 com o defeito de volta. O que distingue as duas versões é
 * se o CORPO foi consumido. Por isso a requisição falsa aqui expõe `body`,
 * `json` e `text` como espiões — se qualquer um for tocado antes do 401, o
 * teste falha. É a única forma de o teste morrer quando a ordem regride.
 */

const getUser = vi.fn();
const listarContas = vi.fn();

vi.mock("@/lib/env", () => ({
  isGoogleConfigured: () => true,
  serverEnv: () => ({
    supabaseUrl: "https://exemplo.supabase.co",
    supabaseServiceRoleKey: "chave-de-servico",
    cronSecret: process.env.CRON_SECRET ?? "",
  }),
  publicEnv: () => ({ supabaseUrl: "https://exemplo.supabase.co", supabaseAnonKey: "anon" }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      select: () => ({ eq: listarContas }),
    }),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: listarContas }),
      update: () => ({ eq: vi.fn() }),
    }),
  }),
}));

vi.mock("@/lib/google/calendar", () => ({
  syncCalendarAccount: vi.fn(async () => ({ eventos: 0 })),
}));

const { GET, POST } = await import("./route");

const ORIGINAL_CRON = process.env.CRON_SECRET;

/**
 * Requisição falsa com o corpo instrumentado.
 *
 * `NextRequest` não é usado de propósito: ele exige o ambiente de execução do
 * Next e, mais importante, esconderia exatamente o que se quer observar. O que
 * a rota consome da requisição é pouco — `headers`, `body`, e na leitura o
 * `getReader()` — então um objeto com essa forma basta e deixa cada acesso
 * visível.
 */
function requisicao({
  cabecalhos = {},
  corpo,
}: {
  cabecalhos?: Record<string, string>;
  corpo?: string;
} = {}) {
  const espioes = {
    json: vi.fn(async () => JSON.parse(corpo ?? "{}")),
    text: vi.fn(async () => corpo ?? ""),
    lerFluxo: vi.fn(),
  };

  const body =
    corpo === undefined
      ? null
      : {
          getReader() {
            espioes.lerFluxo();
            let entregue = false;
            return {
              async read() {
                if (entregue) return { done: true, value: undefined };
                entregue = true;
                return { done: false, value: new TextEncoder().encode(corpo) };
              },
              async cancel() {},
              releaseLock() {},
            };
          },
        };

  const request = {
    headers: new Headers(cabecalhos),
    body,
    json: espioes.json,
    text: espioes.text,
  };

  // A rota recebe um NextRequest; o objeto acima tem a forma que ela usa.
  return { request: request as never, espioes };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: null } });
  listarContas.mockResolvedValue({ data: [] });
  process.env.CRON_SECRET = "segredo-correto";
});

afterEach(() => {
  if (ORIGINAL_CRON === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_CRON;
});

describe("POST /api/google/calendar/sync — autenticar antes de parsear", () => {
  it("anônimo recebe 401 E o corpo nunca é lido", async () => {
    const { request, espioes } = requisicao({
      cabecalhos: { "content-type": "application/json" },
      corpo: JSON.stringify({ accountId: "6f1e0b4a-1c3d-4a5b-8e9f-0a1b2c3d4e5f" }),
    });

    const resposta = await POST(request);

    expect(resposta.status).toBe(401);
    await expect(resposta.json()).resolves.toEqual({ ok: false, error: "unauthorized" });

    // O coração do teste: nenhuma forma de consumir o corpo foi tocada.
    expect(espioes.json).not.toHaveBeenCalled();
    expect(espioes.text).not.toHaveBeenCalled();
    expect(espioes.lerFluxo).not.toHaveBeenCalled();
  });

  it("credencial de cron ERRADA morre em 401 sem ler o corpo e sem consultar sessão", async () => {
    const { request, espioes } = requisicao({
      cabecalhos: { "content-type": "application/json", "x-cron-secret": "segredo-errado" },
      corpo: "{}",
    });

    const resposta = await POST(request);

    expect(resposta.status).toBe(401);
    expect(espioes.lerFluxo).not.toHaveBeenCalled();
    // Nem chega a consultar a sessão: quem apresentou credencial é robô, e robô
    // com credencial errada não ganha uma segunda porta para sondar.
    expect(getUser).not.toHaveBeenCalled();
  });

  it("o ramo do CRON ignora o corpo por completo", async () => {
    listarContas.mockResolvedValue({ data: [] });
    const { request, espioes } = requisicao({
      cabecalhos: { "content-type": "application/json", "x-cron-secret": "segredo-correto" },
      corpo: JSON.stringify({ accountId: "6f1e0b4a-1c3d-4a5b-8e9f-0a1b2c3d4e5f" }),
    });

    const resposta = await POST(request);

    // 404 = autorizou, listou, não achou conta conectada. O que importa é o
    // caminho percorrido até aqui.
    expect(resposta.status).toBe(404);
    expect(espioes.lerFluxo).not.toHaveBeenCalled();
    expect(espioes.json).not.toHaveBeenCalled();
  });
});

describe("POST /api/google/calendar/sync — validação do corpo (sessão autenticada)", () => {
  beforeEach(() => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  });

  it("recusa Content-Type que não seja JSON, com 415", async () => {
    const { request } = requisicao({
      cabecalhos: { "content-type": "text/plain" },
      corpo: "accountId=1",
    });
    const resposta = await POST(request);
    expect(resposta.status).toBe(415);
    await expect(resposta.json()).resolves.toEqual({
      ok: false,
      error: "unsupported_media_type",
    });
  });

  it("aceita application/json com parâmetro de charset", async () => {
    const { request } = requisicao({
      cabecalhos: { "content-type": "application/json; charset=utf-8" },
      corpo: "{}",
    });
    const resposta = await POST(request);
    // Passou da validação de corpo: 404 é "nenhuma conta", não erro de entrada.
    expect(resposta.status).toBe(404);
  });

  it("corta corpo acima do teto com 413, sem materializar tudo", async () => {
    const { request } = requisicao({
      cabecalhos: { "content-type": "application/json" },
      corpo: JSON.stringify({ accountId: "x".repeat(2048) }),
    });
    const resposta = await POST(request);
    expect(resposta.status).toBe(413);
    await expect(resposta.json()).resolves.toEqual({ ok: false, error: "payload_too_large" });
  });

  it("recusa accountId que não é uuid, com 400 — antes de tocar no banco", async () => {
    const { request } = requisicao({
      cabecalhos: { "content-type": "application/json" },
      corpo: JSON.stringify({ accountId: "nao-e-uuid" }),
    });
    const resposta = await POST(request);
    expect(resposta.status).toBe(400);
    await expect(resposta.json()).resolves.toEqual({ ok: false, error: "invalid_body" });
    expect(listarContas).not.toHaveBeenCalled();
  });

  it("recusa campo desconhecido no corpo", async () => {
    const { request } = requisicao({
      cabecalhos: { "content-type": "application/json" },
      corpo: JSON.stringify({ accountId: "6f1e0b4a-1c3d-4a5b-8e9f-0a1b2c3d4e5f", extra: 1 }),
    });
    expect((await POST(request)).status).toBe(400);
  });

  it("recusa JSON malformado com 400, não com 500", async () => {
    const { request } = requisicao({
      cabecalhos: { "content-type": "application/json" },
      corpo: "{isto não é json",
    });
    expect((await POST(request)).status).toBe(400);
  });

  it("corpo vazio continua valendo 'todas as minhas contas'", async () => {
    const { request } = requisicao({
      cabecalhos: { "content-type": "application/json" },
      corpo: "",
    });
    const resposta = await POST(request);
    expect(resposta.status).toBe(404); // passou da validação; não há contas
    expect(listarContas).toHaveBeenCalledWith("status", "connected");
  });
});

describe("GET /api/google/calendar/sync", () => {
  it("sem credencial de cron é 401 — inclusive para sessão válida", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const { request } = requisicao();
    expect((await GET(request)).status).toBe(401);
  });

  it("com o segredo correto segue pelo ramo do agendador", async () => {
    const { request } = requisicao({ cabecalhos: { "x-cron-secret": "segredo-correto" } });
    const resposta = await GET(request);
    expect(resposta.status).toBe(404); // autorizou e listou; sem contas conectadas
  });
});
