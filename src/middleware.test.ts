import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * O encanamento do nonce (E3).
 *
 * A parte não óbvia da CSP com nonce não é gerar o número — é fazê-lo CHEGAR ao
 * Next. O Next carimba os próprios scripts inline com um nonce que ele NÃO
 * inventa: ele o extrai do cabeçalho de CSP presente na REQUISIÇÃO. Se o
 * middleware escrever a política só na resposta, o Next não carimba nada e todo
 * script dele vira violação — silenciosamente, porque em Report-Only nada
 * quebra e o efeito só aparece depois da promoção.
 *
 * Estes casos existem para que essa ligação não possa ser desfeita sem alguém
 * perceber.
 */

// `updateSession` faz I/O de sessão; aqui interessa só o que o middleware
// carimba em volta dela. O mock devolve exatamente o que o real devolve no
// caminho feliz: um `next()` construído a partir da requisição recebida — é
// esse construtor que propaga os cabeçalhos de requisição adiante.
vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: async (request: NextRequest) => NextResponse.next({ request }),
}));

const { middleware } = await import("./middleware");
const { CABECALHO_CSP } = await import("./lib/csp");

function requisicao(caminho = "/tarefas") {
  return new NextRequest(new URL(`https://exemplo.com${caminho}`));
}

/** O que o Next lê depois: `NextResponse.next({ request })` reescreve os
 *  cabeçalhos de requisição com este prefixo. */
function cabecalhoDeRequisicao(resposta: Response, nome: string): string | null {
  return resposta.headers.get(`x-middleware-request-${nome}`);
}

describe("middleware — CSP com nonce", () => {
  it("escreve a política na RESPOSTA e na REQUISIÇÃO, com o mesmo nonce", async () => {
    const resposta = await middleware(requisicao());

    const naResposta = resposta.headers.get(CABECALHO_CSP);
    const naRequisicao = cabecalhoDeRequisicao(resposta, CABECALHO_CSP.toLowerCase());

    expect(naResposta).toBeTruthy();
    // Se esta igualdade cair, o Next passa a carimbar os scripts com um nonce
    // que a política enviada ao navegador não reconhece.
    expect(naRequisicao).toBe(naResposta);
  });

  it("o nonce da política é o mesmo de x-nonce", async () => {
    const resposta = await middleware(requisicao());
    const politica = resposta.headers.get(CABECALHO_CSP)!;
    const xNonce = cabecalhoDeRequisicao(resposta, "x-nonce");

    expect(xNonce).toBeTruthy();
    expect(politica).toContain(`'nonce-${xNonce}'`);
  });

  it("cada requisição recebe um nonce DIFERENTE", async () => {
    // O defeito que isto tranca: montar a política uma vez por processo (como
    // era antes da E3) e reutilizá-la. Nonce fixo é nonce adivinhável, e uma
    // CSP com nonce previsível não protege de nada.
    const a = (await middleware(requisicao())).headers.get(CABECALHO_CSP)!;
    const b = (await middleware(requisicao())).headers.get(CABECALHO_CSP)!;
    expect(a).not.toBe(b);
  });

  it("não sobrou 'unsafe-inline' em script-src", async () => {
    const resposta = await middleware(requisicao());
    const politica = resposta.headers.get(CABECALHO_CSP)!;
    const scriptSrc = politica.split("; ").find((d) => d.startsWith("script-src "))!;
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });
});
