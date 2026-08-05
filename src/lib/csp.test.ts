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
  return modulo.politicaDeSegurancaDeConteudo("NONCE-DE-TESTE");
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

describe("CABECALHO_CSP e CSP_EM_BLOQUEIO", () => {
  it("está em MODO RELATÓRIO — virar a constante é a promoção, não um detalhe", async () => {
    vi.resetModules();
    const { CABECALHO_CSP, CSP_EM_BLOQUEIO } = await import("./csp");
    /*
      Se este caso quebrou, alguém virou `CSP_EM_BLOQUEIO`. Isso é o objetivo —
      mas só DEPOIS de percorrer a aplicação em produção com o DevTools aberto
      e não ver nenhuma linha "[Report Only] Refused to ...". Ver o roteiro no
      topo de csp.ts.

      A CSP em bloqueio falha em silêncio: o script não roda, a tela fica
      parcialmente morta, e nada chega ao servidor. Este teste existe para que
      a virada seja uma decisão consciente, com o diff mostrando as duas linhas.
    */
    expect(CSP_EM_BLOQUEIO).toBe(false);
    expect(CABECALHO_CSP).toBe("Content-Security-Policy-Report-Only");
  });

  it("o nome do cabeçalho é derivado da constante, não escrito duas vezes", async () => {
    // O nome é lido na resposta E na requisição (de onde o Next tira o nonce).
    // Derivar impede o estado meio-promovido, em que os dois divergem.
    vi.resetModules();
    const { CABECALHO_CSP, CSP_EM_BLOQUEIO } = await import("./csp");
    expect(CABECALHO_CSP).toBe(
      CSP_EM_BLOQUEIO ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only",
    );
  });
});

describe("nonce", () => {
  it("script-src carrega o nonce da requisição e NÃO tem mais 'unsafe-inline'", async () => {
    const politica = await politicaCom("https://abc.supabase.co");
    const script = diretiva(politica, "script-src");

    expect(script).toContain("'nonce-NONCE-DE-TESTE'");
    // O buraco que a CSP existe para tapar. Se voltar, a política inteira vira
    // decoração: um XSS que injete <script> passa.
    expect(script).not.toContain("'unsafe-inline'");
  });

  it("gerarNonce devolve 128 bits imprevisíveis, diferentes a cada chamada", async () => {
    vi.resetModules();
    const { gerarNonce } = await import("./csp");

    const amostras = new Set(Array.from({ length: 200 }, () => gerarNonce()));
    // Nonce repetido é nonce adivinhável, e nonce adivinhável não protege nada.
    expect(amostras.size).toBe(200);

    const um = gerarNonce();
    expect(Buffer.from(um, "base64")).toHaveLength(16);
  });

  it("style-src MANTÉM 'unsafe-inline' — é a DÍVIDA 2, e é consciente", async () => {
    // Remover exigiria 'unsafe-hashes' + um hash por atributo `style={{...}}`,
    // impraticável de manter. O risco residual é exfiltração por seletor, não
    // execução. Este caso existe para a diferença não passar por descuido.
    const politica = await politicaCom("https://abc.supabase.co");
    expect(diretiva(politica, "style-src")).toContain("'unsafe-inline'");
  });
});

describe("hash do script de tema", () => {
  it("bate com o conteúdo REAL de themeInitScript", async () => {
    /*
      O hash é uma constante em csp.ts (o middleware roda no Edge, onde o
      digest é assíncrono, e a política é montada de forma síncrona). Este caso
      é o que impede a constante de envelhecer: ele recalcula a partir do
      arquivo de verdade.

      Se falhou, alguém editou `themeInitScript`. Copie o valor esperado para
      HASH_DO_SCRIPT_DE_TEMA em src/lib/csp.ts. Um hash desatualizado não
      quebra nada em Report-Only, mas depois da promoção apaga o tema antes da
      primeira pintura e a tela pisca em branco a cada carregamento.
    */
    const { readFileSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    const { HASH_DO_SCRIPT_DE_TEMA } = await import("./csp");

    // O caminho mudou junto com a constante: ela saiu de `ThemeToggle.tsx`
    // ("use client") para um módulo sem diretiva, porque o layout raiz é
    // Componente de Servidor e recebia uma referência de cliente no lugar da
    // string. Ver o cabeçalho de `tema-init.ts`. A conta abaixo é a mesma.
    const fonte = readFileSync("src/components/theme/tema-init.ts", "utf8");
    const encontrado = fonte.match(/export const themeInitScript = `([\s\S]*?)`;/);
    expect(encontrado, "themeInitScript não foi encontrado no arquivo").not.toBeNull();

    const esperado = `sha256-${createHash("sha256").update(encontrado![1]!, "utf8").digest("base64")}`;
    expect(HASH_DO_SCRIPT_DE_TEMA).toBe(esperado);
  });

  it("entra em script-src entre aspas simples, como a CSP exige", async () => {
    const { HASH_DO_SCRIPT_DE_TEMA } = await import("./csp");
    const politica = await politicaCom("https://abc.supabase.co");
    expect(diretiva(politica, "script-src")).toContain(`'${HASH_DO_SCRIPT_DE_TEMA}'`);
  });
});
