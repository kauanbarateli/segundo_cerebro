import { describe, expect, it } from "vitest";
import { FUSO_DO_APP, diaCivilDe, instanteDe, paraCampoLocal } from "./tempo";

/**
 * Estes testes valem por rodarem em QUALQUER fuso de máquina — é o ponto
 * inteiro do módulo. Nenhum deles usa `new Date(string ingênua)` para montar a
 * expectativa, porque essa é justamente a função que estava errada: a
 * expectativa é sempre um instante absoluto escrito à mão.
 */
describe("instanteDe", () => {
  it("lê só-data como MEIA-NOITE no fuso do app, não como meia-noite UTC", () => {
    // O defeito original: `new Date("2026-08-07")` dava "2026-08-07T00:00:00Z",
    // que em São Paulo é 06/08 às 21h — o dia voltava um.
    expect(instanteDe("2026-08-07")).toBe("2026-08-07T03:00:00.000Z");
  });

  it("lê horário ingênuo no fuso do app, não no de quem executa", () => {
    expect(instanteDe("2026-08-07T14:00")).toBe("2026-08-07T17:00:00.000Z");
  });

  it("preserva o dia civil no ida-e-volta de uma data só", () => {
    for (const dia of ["2026-01-01", "2026-02-28", "2026-06-15", "2026-12-31"]) {
      expect(diaCivilDe(instanteDe(dia))).toBe(dia);
    }
  });

  it("não retrocede na virada de mês nem na de ano", () => {
    expect(diaCivilDe(instanteDe("2026-03-01"))).toBe("2026-03-01");
    expect(diaCivilDe(instanteDe("2027-01-01"))).toBe("2027-01-01");
  });

  it("aceita 29 de fevereiro em ano bissexto e recusa em ano comum", () => {
    expect(instanteDe("2028-02-29")).not.toBeNull();
    expect(instanteDe("2026-02-29")).toBeNull();
  });

  it("recusa dia que não existe no mês", () => {
    expect(instanteDe("2026-02-31")).toBeNull();
    expect(instanteDe("2026-04-31")).toBeNull();
    expect(instanteDe("2026-13-01")).toBeNull();
    expect(instanteDe("2026-00-10")).toBeNull();
  });

  it("recusa hora e minuto fora do relógio", () => {
    expect(instanteDe("2026-08-07T24:00")).toBeNull();
    expect(instanteDe("2026-08-07T10:60")).toBeNull();
  });

  it("recusa texto que não é data", () => {
    expect(instanteDe("x")).toBeNull();
    expect(instanteDe("")).toBeNull();
    expect(instanteDe("07/08/2026")).toBeNull();
  });

  it("aceita segundos opcionais", () => {
    expect(instanteDe("2026-08-07T14:00:30")).toBe("2026-08-07T17:00:30.000Z");
  });

  /**
   * O horário de verão foi abolido no Brasil em 2019, mas o app guarda datas
   * anteriores. Em 2018 São Paulo estava em UTC-2 no verão — se o módulo
   * travasse em -3, esta data voltaria uma hora errada.
   */
  it("respeita o horário de verão histórico", () => {
    expect(instanteDe("2018-01-15T12:00")).toBe("2018-01-15T14:00:00.000Z");
    expect(instanteDe("2018-07-15T12:00")).toBe("2018-07-15T15:00:00.000Z");
  });

  it("aceita fuso explícito para quem precisar sair do padrão", () => {
    expect(instanteDe("2026-08-07T00:00", "UTC")).toBe("2026-08-07T00:00:00.000Z");
    expect(instanteDe("2026-08-07T00:00", "Asia/Tokyo")).toBe("2026-08-06T15:00:00.000Z");
  });
});

describe("paraCampoLocal", () => {
  it("devolve 10 caracteres para type=date e 16 para datetime-local", () => {
    const iso = "2026-08-07T17:00:00.000Z";
    expect(paraCampoLocal(iso, "date")).toBe("2026-08-07");
    expect(paraCampoLocal(iso, "datetime")).toBe("2026-08-07T14:00");
  });

  /**
   * O defeito que o parâmetro `formato` existe para impedir: a versão anterior
   * devolvia sempre 16 caracteres, e um `<input type="date">` recebendo
   * "2026-08-07T14:00" DESCARTA o valor — o campo aparecia vazio mesmo havendo
   * data salva.
   */
  it("o valor de type=date casa com o formato que o input aceita", () => {
    expect(paraCampoLocal("2026-08-07T17:00:00.000Z", "date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("devolve string vazia para nulo, indefinido e data inválida", () => {
    expect(paraCampoLocal(null, "date")).toBe("");
    expect(paraCampoLocal(undefined, "datetime")).toBe("");
    expect(paraCampoLocal("nada disso", "datetime")).toBe("");
  });

  it("mostra a meia-noite de São Paulo como 00:00, não como 21:00 do dia anterior", () => {
    const meiaNoite = instanteDe("2026-08-07")!;
    expect(paraCampoLocal(meiaNoite, "datetime")).toBe("2026-08-07T00:00");
  });

  it("fecha o ciclo: campo → instante → campo devolve o mesmo texto", () => {
    for (const valor of ["2026-08-07T14:00", "2026-01-01T00:00", "2026-12-31T23:59"]) {
      expect(paraCampoLocal(instanteDe(valor), "datetime")).toBe(valor);
    }
  });
});

describe("FUSO_DO_APP", () => {
  it("é o mesmo fuso em que a interface formata", () => {
    expect(FUSO_DO_APP).toBe("America/Sao_Paulo");
  });
});
