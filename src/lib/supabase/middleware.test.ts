import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * O PORTÃO DE SESSÃO E A ROTA DO AGENDADOR.
 *
 * Estes testes existem por causa de um defeito que os testes de
 * src/lib/cron-auth.test.ts não conseguiam ver: eles exercitam a FUNÇÃO PURA de
 * validação do segredo, nunca a rota atrás do middleware. E era o middleware
 * que matava a requisição do agendador — sem cookie de sessão, ela virava um
 * 307 para /login antes de `verificarSegredoDeCron` ter chance de rodar. O
 * controle de segurança estava lá, testado, verde e INOPERANTE.
 *
 * A lição que estes casos travam no lugar: quem decide se a requisição do robô
 * chega ao handler é `updateSession`, então é `updateSession` que precisa ser
 * afirmado — e junto com ele a afirmação de que a isenção NÃO vazou para as
 * outras rotas de API (o "conserto óbvio" de pôr "/api" em PUBLIC_PATHS abriria
 * todas de uma vez).
 */

// `updateSession` só chega na lógica de sessão se o Supabase estiver
// configurado; sem isto ela devolveria `next()` para tudo e os testes passariam
// pelo motivo errado.
vi.mock("@/lib/env", () => ({
  publicEnv: {
    appUrl: "http://localhost:3000",
    supabaseUrl: "https://projeto.supabase.co",
    supabaseAnonKey: "chave-anonima-de-teste",
  },
  isSupabaseConfigured: () => true,
}));

// Cenário de todos os casos: requisição SEM sessão — que é, por definição, a do
// agendador (robô não tem cookie) e também a de um visitante anônimo.
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
  }),
}));

const { updateSession, isSelfAuthenticatedPath } = await import("./middleware");

function requisicao(caminho: string, cabecalhos: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(caminho, "http://localhost:3000"), {
    method: "POST",
    headers: cabecalhos,
  });
}

/** O 307 para /login é a assinatura exata do defeito. */
function redirecionouParaLogin(resposta: Response): boolean {
  return resposta.status === 307 && (resposta.headers.get("location") ?? "").includes("/login");
}

describe("updateSession — a requisição do agendador precisa CHEGAR na rota", () => {
  it("não redireciona /api/google/calendar/sync sem sessão (o defeito)", async () => {
    const resposta = await updateSession(
      requisicao("/api/google/calendar/sync", { "x-cron-secret": "segredo-de-teste" }),
    );
    // Com o bug de volta isto é 307 + location=/login?redirectedFrom=... e o
    // handler POST nunca executa: nem 200, nem 401, nem 400 not_configured.
    expect(redirecionouParaLogin(resposta)).toBe(false);
    expect(resposta.status).toBe(200);
  });

  it("também deixa passar o formato Bearer do Vercel Cron", async () => {
    const resposta = await updateSession(
      requisicao("/api/google/calendar/sync", { authorization: "Bearer segredo-de-teste" }),
    );
    expect(redirecionouParaLogin(resposta)).toBe(false);
  });

  it("deixa passar até sem credencial — quem recusa é a rota, não o middleware", async () => {
    // O middleware não valida segredo (roda no runtime de edge, sem node:crypto),
    // e não precisa: sem credencial a rota cai no caminho da sessão e devolve
    // 401 por não haver usuário. O portão que importa fica no handler.
    const resposta = await updateSession(requisicao("/api/google/calendar/sync"));
    expect(redirecionouParaLogin(resposta)).toBe(false);
  });
});

describe("updateSession — a isenção não pode ter vazado", () => {
  it("as OUTRAS rotas de API continuam exigindo sessão", async () => {
    // Este é o caso que reprova o conserto preguiçoso de acrescentar "/api" a
    // PUBLIC_PATHS: ele passaria no teste de cima e abriria estas quatro.
    for (const rota of [
      "/api/google/calendar/accounts",
      "/api/google/calendar/connect",
      "/api/google/calendar/disconnect",
      "/api/google/calendar/callback",
    ]) {
      const resposta = await updateSession(requisicao(rota));
      expect(redirecionouParaLogin(resposta), `${rota} deveria exigir sessão`).toBe(true);
    }
  });

  it("as páginas continuam exigindo sessão", async () => {
    for (const rota of ["/", "/financeiro", "/conhecimento", "/cofre"]) {
      const resposta = await updateSession(requisicao(rota));
      expect(redirecionouParaLogin(resposta), `${rota} deveria exigir sessão`).toBe(true);
    }
  });

  it("/login segue público", async () => {
    const resposta = await updateSession(requisicao("/login"));
    expect(resposta.status).toBe(200);
  });
});

describe("isSelfAuthenticatedPath — a isenção é nominal, não por prefixo", () => {
  it("isenta a rota exata, com ou sem barra final", () => {
    expect(isSelfAuthenticatedPath("/api/google/calendar/sync")).toBe(true);
    expect(isSelfAuthenticatedPath("/api/google/calendar/sync/")).toBe(true);
  });

  it("não isenta caminho que apenas COMEÇA com o nome isentado", () => {
    // Com `startsWith` (a forma usada por PUBLIC_PATHS) estes três entrariam de
    // carona numa isenção que ninguém escreveu para eles.
    expect(isSelfAuthenticatedPath("/api/google/calendar/sync-tudo")).toBe(false);
    expect(isSelfAuthenticatedPath("/api/google/calendar/syncx")).toBe(false);
    expect(isSelfAuthenticatedPath("/api/google/calendar/sync/interno")).toBe(false);
  });

  it("não isenta o resto da aplicação", () => {
    expect(isSelfAuthenticatedPath("/api")).toBe(false);
    expect(isSelfAuthenticatedPath("/")).toBe(false);
  });
});
