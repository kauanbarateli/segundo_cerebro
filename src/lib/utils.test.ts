import { describe, expect, it } from "vitest";
import { plural, formatBytes, parseBRLToCents, formatBRL } from "./utils";

describe("plural", () => {
  it("usa o singular apenas para exatamente 1", () => {
    expect(plural(1, "tarefa aberta", "tarefas abertas")).toBe("1 tarefa aberta");
    expect(plural(2, "tarefa aberta", "tarefas abertas")).toBe("2 tarefas abertas");
  });

  it("zero é plural em português", () => {
    expect(plural(0, "reunião à frente", "reuniões à frente")).toBe("0 reuniões à frente");
  });
});

describe("formatBytes", () => {
  it("descreve tamanhos de arquivo", () => {
    expect(formatBytes(0)).toMatch(/0/);
    expect(formatBytes(50 * 1024 * 1024)).toMatch(/MB/);
  });
});

describe("dinheiro em centavos", () => {
  it("0,10 + 0,20 = 0,30 — sem erro de ponto flutuante", () => {
    const a = parseBRLToCents("0,10");
    const b = parseBRLToCents("0,20");
    expect(a).toBe(10);
    expect(b).toBe(20);
    expect(a! + b!).toBe(30);
    expect(formatBRL(a! + b!)).toContain("0,30");
  });

  it("oculta o valor quando pedido", () => {
    expect(formatBRL(123456, { hidden: true })).toBe("R$ ••••");
  });
});
