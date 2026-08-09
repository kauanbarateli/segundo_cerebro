import { describe, expect, it } from "vitest";
import {
  plural,
  concorda,
  formatBytes,
  parseBRLToCents,
  formatBRL,
  dayRangeInTimeZone,
  startOfDay,
} from "./utils";

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

describe("dayRangeInTimeZone", () => {
  const SP = "America/Sao_Paulo";

  it("recorta o dia civil de São Paulo, não o dia UTC", () => {
    // 2 de agosto de 2026, 15h em São Paulo (18h UTC).
    const r = dayRangeInTimeZone(new Date("2026-08-02T18:00:00.000Z"), SP);
    expect(r.dayKey).toBe("2026-08-02");
    expect(r.startIso).toBe("2026-08-02T03:00:00.000Z"); // meia-noite -03:00
    expect(r.endIso).toBe("2026-08-03T03:00:00.000Z"); // exclusivo
  });

  it("às 22h de São Paulo o dia ainda é hoje — o caso que quebrava no servidor", () => {
    // 22h de 2/8 em SP = 01h UTC de 3/8. Num processo rodando em UTC — que é o
    // caso da Vercel — `startOfDay` diria que "hoje" é 3 de agosto, e das 21h à
    // meia-noite a agenda mostraria os eventos de amanhã.
    const instante = new Date("2026-08-03T01:00:00.000Z");
    expect(dayRangeInTimeZone(instante, SP).dayKey).toBe("2026-08-02");

    // `startOfDay` depende do fuso do processo; a função nova, não. Só dá para
    // afirmar a divergência quando o processo de teste realmente está em UTC.
    if (new Date().getTimezoneOffset() === 0) {
      expect(startOfDay(instante).toISOString().slice(0, 10)).toBe("2026-08-03");
    }
  });

  it("a chave do dia NÃO é o recorte do fim do intervalo", () => {
    // A armadilha que motiva o campo `dayKey`: o `endIso` de um dia de São Paulo
    // cai sempre na data seguinte quando lido como texto.
    const r = dayRangeInTimeZone(new Date("2026-08-02T18:00:00.000Z"), SP);
    expect(r.endIso.slice(0, 10)).toBe("2026-08-03");
    expect(r.dayKey).toBe("2026-08-02");
  });

  it("vira o mês e o ano corretamente", () => {
    const fimDoMes = dayRangeInTimeZone(new Date("2026-08-31T20:00:00.000Z"), SP);
    expect(fimDoMes.dayKey).toBe("2026-08-31");
    expect(fimDoMes.endIso).toBe("2026-09-01T03:00:00.000Z");

    // 31/12 às 22h em SP = 01h UTC de 1º de janeiro.
    const reveillon = dayRangeInTimeZone(new Date("2027-01-01T01:00:00.000Z"), SP);
    expect(reveillon.dayKey).toBe("2026-12-31");
    expect(reveillon.endIso).toBe("2027-01-01T03:00:00.000Z");
  });

  it("o intervalo tem exatamente 24 h e o fim é exclusivo", () => {
    const r = dayRangeInTimeZone(new Date("2026-08-02T18:00:00.000Z"), SP);
    const duracao = new Date(r.endIso).getTime() - new Date(r.startIso).getTime();
    expect(duracao).toBe(24 * 60 * 60 * 1000);
    // Meia-noite do dia seguinte pertence ao dia seguinte, não a este.
    expect(dayRangeInTimeZone(new Date(r.endIso), SP).dayKey).toBe("2026-08-03");
  });

  it("funciona em fuso com horário de verão (a segunda passada do cálculo)", () => {
    // 8 de março de 2026, virada do DST nos EUA: 2h vira 3h em Nova York.
    // A meia-noite desse dia ainda é -05:00; o dia dura 23 h.
    const r = dayRangeInTimeZone(new Date("2026-03-08T18:00:00.000Z"), "America/New_York");
    expect(r.dayKey).toBe("2026-03-08");
    expect(r.startIso).toBe("2026-03-08T05:00:00.000Z");
    expect(r.endIso).toBe("2026-03-09T04:00:00.000Z");
    const duracao = new Date(r.endIso).getTime() - new Date(r.startIso).getTime();
    expect(duracao).toBe(23 * 60 * 60 * 1000);
  });
});

describe("concorda — a flexão SEM o número", () => {
  it("devolve só a palavra, para o meio de uma frase que já disse o número", () => {
    // O defeito que motivou a função: `plural(3, "Ele conta", "Eles contam")`
    // renderizava "3 Eles contam" no meio de uma frase que já começava com
    // "3 lançamentos" — o número repetido, colado num verbo.
    expect(concorda(1, "Ele conta", "Eles contam")).toBe("Ele conta");
    expect(concorda(3, "Ele conta", "Eles contam")).toBe("Eles contam");
    expect(concorda(0, "aparece", "aparecem")).toBe("aparecem");
  });

  it("plural continua prefixando o número — as ~15 chamadas legítimas dependem disso", () => {
    expect(plural(1, "tarefa aberta", "tarefas abertas")).toBe("1 tarefa aberta");
  });
});
