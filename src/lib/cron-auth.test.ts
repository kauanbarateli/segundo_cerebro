import { afterEach, describe, expect, it } from "vitest";
import { verificarSegredoDeCron } from "./cron-auth";

/**
 * `serverEnv()` lê `process.env` a cada chamada (não guarda em módulo), então
 * dá para trocar o segredo entre casos. É por isso que estes testes conseguem
 * cobrir o caso do segredo VAZIO — que é o estado real do projeto hoje e o mais
 * perigoso de acertar de cabeça.
 */
const ORIGINAL = process.env.CRON_SECRET;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL;
});

function requisicao(cabecalhos: Record<string, string> = {}): Request {
  return new Request("https://exemplo.com/api/google/calendar/sync", {
    method: "POST",
    headers: cabecalhos,
  });
}

describe("verificarSegredoDeCron", () => {
  it("sem cabeçalho nenhum é 'ausente' — o caminho do usuário logado", () => {
    process.env.CRON_SECRET = "segredo-correto";
    expect(verificarSegredoDeCron(requisicao())).toBe("ausente");
  });

  it("aceita Authorization: Bearer (formato do Vercel Cron)", () => {
    process.env.CRON_SECRET = "segredo-correto";
    expect(
      verificarSegredoDeCron(requisicao({ authorization: "Bearer segredo-correto" })),
    ).toBe("valida");
  });

  it("aceita x-cron-secret (chamada manual)", () => {
    process.env.CRON_SECRET = "segredo-correto";
    expect(verificarSegredoDeCron(requisicao({ "x-cron-secret": "segredo-correto" }))).toBe(
      "valida",
    );
  });

  it("recusa segredo errado", () => {
    process.env.CRON_SECRET = "segredo-correto";
    expect(verificarSegredoDeCron(requisicao({ "x-cron-secret": "chute" }))).toBe("invalida");
  });

  it("recusa um segredo que é PREFIXO do correto (o palpite da força bruta)", () => {
    process.env.CRON_SECRET = "segredo-correto";
    expect(verificarSegredoDeCron(requisicao({ "x-cron-secret": "segredo-corret" }))).toBe(
      "invalida",
    );
    // Tamanhos MUITO diferentes: é aqui que um `timingSafeEqual` sobre os
    // valores crus (em vez de sobre os digests) lançaria exceção e viraria 500.
    expect(verificarSegredoDeCron(requisicao({ "x-cron-secret": "s" }))).toBe("invalida");
    expect(verificarSegredoDeCron(requisicao({ "x-cron-secret": "x".repeat(5_000) }))).toBe(
      "invalida",
    );
  });

  describe("CRON_SECRET vazio = rota FECHADA (o estado atual do projeto)", () => {
    it("credencial vazia contra segredo vazio NÃO passa", () => {
      process.env.CRON_SECRET = "";
      // O `"" === ""` da implementação ingênua diria TRUE aqui e abriria a rota
      // para qualquer um justamente no ambiente que esqueceu de configurá-la.
      expect(verificarSegredoDeCron(requisicao({ "x-cron-secret": "" }))).toBe("invalida");
      expect(verificarSegredoDeCron(requisicao({ authorization: "Bearer " }))).toBe("invalida");
    });

    it("nenhuma credencial é aceita quando o segredo não está configurado", () => {
      delete process.env.CRON_SECRET;
      expect(verificarSegredoDeCron(requisicao({ "x-cron-secret": "qualquer-coisa" }))).toBe(
        "invalida",
      );
    });

    it("mas o caminho do usuário logado continua intocado", () => {
      process.env.CRON_SECRET = "";
      expect(verificarSegredoDeCron(requisicao())).toBe("ausente");
    });
  });

  it("Authorization de outro esquema é recusado, não ignorado", () => {
    process.env.CRON_SECRET = "segredo-correto";
    // Um agendador mal configurado (Basic em vez de Bearer) precisa falhar de
    // forma visível — cair no caminho da sessão daria 401 por outro motivo e
    // mandaria quem está depurando para o lado errado.
    expect(verificarSegredoDeCron(requisicao({ authorization: "Basic segredo-correto" }))).toBe(
      "invalida",
    );
  });

  it("espaços nas pontas não invalidam (o segredo colado do painel)", () => {
    process.env.CRON_SECRET = "segredo-correto";
    expect(verificarSegredoDeCron(requisicao({ "x-cron-secret": "  segredo-correto  " }))).toBe(
      "valida",
    );
  });
});
