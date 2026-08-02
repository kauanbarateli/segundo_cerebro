import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `publicEnv` é uma constante de MÓDULO: lê `process.env` uma vez, no import.
 * Por isso cada caso aqui reseta os módulos e importa de novo — é o único jeito
 * de exercitar a política com e sem Supabase configurado.
 */
const ORIGINAL = process.env.NEXT_PUBLIC_SUPABASE_URL;

async function politicaCom(url: string | undefined) {
  vi.resetModules();
  if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  const modulo = await import("./csp");
  return modulo.politicaDeSegurancaDeConteudo();
}

/** Extrai os valores de uma diretiva da política já serializada. */
function diretiva(politica: string, nome: string): string {
  const encontrada = politica
    .split("; ")
    .find((parte) => parte.startsWith(`${nome} `));
  return encontrada ?? "";
}

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL;
});

describe("politicaDeSegurancaDeConteudo", () => {
  it("libera a origem do Supabase onde o navegador realmente fala com ele", async () => {
    const politica = await politicaCom("https://abcdefgh.supabase.co");

    // connect-src: auth e o upload DIRETO do Drive (DriveView envia o arquivo
    // do navegador para o Storage). img-src: a URL assinada do avatar.
    expect(diretiva(politica, "connect-src")).toContain("https://abcdefgh.supabase.co");
    expect(diretiva(politica, "img-src")).toContain("https://abcdefgh.supabase.co");
  });

  it("usa a ORIGEM, sem caminho nem barra final (host-source válido para CSP)", async () => {
    const politica = await politicaCom("https://abcdefgh.supabase.co/");
    expect(politica).toContain("https://abcdefgh.supabase.co");
    expect(politica).not.toContain("https://abcdefgh.supabase.co/ ");
  });

  it("sem Supabase configurado, a política continua VÁLIDA (nada de 'undefined')", async () => {
    const politica = await politicaCom(undefined);
    // Um token inválido faz o navegador descartar a DIRETIVA inteira, não só o
    // token — connect-src viraria "ausente" e cairia no default-src.
    expect(politica).not.toContain("undefined");
    expect(diretiva(politica, "connect-src")).toBe("connect-src 'self' ws://localhost:*");
  });

  it("mantém as diretivas que não dependem de ambiente", async () => {
    const politica = await politicaCom("https://abcdefgh.supabase.co");
    expect(diretiva(politica, "default-src")).toBe("default-src 'self'");
    expect(diretiva(politica, "object-src")).toBe("object-src 'none'");
    expect(diretiva(politica, "base-uri")).toBe("base-uri 'self'");
    expect(diretiva(politica, "form-action")).toBe("form-action 'self'");
    expect(diretiva(politica, "frame-ancestors")).toBe("frame-ancestors 'none'");
  });

  it("mantém 'wasm-unsafe-eval' — sem ele o Cofre para de destrancar", async () => {
    // O Argon2id do Cofre roda em WebAssembly no navegador (hash-wasm). Este
    // caso existe para que remover o token seja uma decisão consciente, e não
    // uma "limpeza" que só aparece em produção, na tela das senhas.
    const politica = await politicaCom("https://abcdefgh.supabase.co");
    expect(diretiva(politica, "script-src")).toContain("'wasm-unsafe-eval'");
  });

  it("NÃO aponta report-uri/report-to para lugar nenhum", async () => {
    // Decisão registrada no cabeçalho de csp.ts: os relatórios são lidos no
    // console do navegador. Um coletor seria uma rota POST pública e não
    // autenticada; um `report-uri` para rota inexistente seria pior que nada.
    const politica = await politicaCom("https://abcdefgh.supabase.co");
    expect(politica).not.toContain("report-uri");
    expect(politica).not.toContain("report-to");
  });
});

describe("CABECALHO_CSP", () => {
  it("está em MODO RELATÓRIO — trocar isto é a promoção, não um detalhe", async () => {
    vi.resetModules();
    const { CABECALHO_CSP } = await import("./csp");
    /*
      Se este caso quebrou, alguém promoveu a CSP para modo de bloqueio. Antes
      de só atualizar a string aqui, confira a DÍVIDA 1 do cabeçalho de csp.ts:
      enquanto `script-src` tiver 'unsafe-inline', promover não protege de XSS —
      e enquanto o nonce não existir, remover o 'unsafe-inline' quebra TODA
      página (o Next injeta script inline em todas elas).
    */
    expect(CABECALHO_CSP).toBe("Content-Security-Policy-Report-Only");
  });
});
