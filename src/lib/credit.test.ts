import { describe, expect, it } from "vitest";
import {
  statusDaFatura,
  faturaDe,
  fechamentoDaFatura,
  ultimoFechamentoAte,
  vencimentoDaFatura,
  parcelas,
  planoDeParcelas,
  somaMeses,
  somaMesesNaData,
  limiteDisponivel,
  faturaDoCartao,
  patrimonioEDivida,
  ehPagamentoDeFatura,
  ultimoDiaDoMes,
  faturasQueVencemEm,
  totalAPagarEm,
  calcularEncargos,
  faturaDoEncargo,
} from "./credit";
import type { FinanceAccount, FinanceAccountBalance, FinanceTransaction } from "./database.types";

function tx(over: Partial<FinanceTransaction>): FinanceTransaction {
  return {
    id: crypto.randomUUID(),
    user_id: "u1",
    account_id: "cartao",
    category_id: null,
    kind: "expense",
    amount_cents: 1000,
    description: "x",
    payee: null,
    occurred_on: "2026-07-10",
    transfer_group_id: null,
    notes: null,
    is_paid: true,
    created_at: "",
    updated_at: "",
    installment_group_id: null,
    installment_no: null,
    installment_total: null,
    statement_month: null,
    ...over,
  };
}

/* ------------------------------------------------------------------ faturaDe */

describe("faturaDe", () => {
  it("compra depois do fechamento cai na fatura do mês seguinte (20/03 com fechamento 15 = abril)", () => {
    expect(faturaDe("2025-03-20", 15)).toBe("2025-04-01");
  });

  it("compra no PRÓPRIO dia do fechamento já pertence à próxima fatura", () => {
    expect(faturaDe("2025-03-15", 15)).toBe("2025-04-01");
  });

  it("compra no dia seguinte ao fechamento vai para a próxima fatura", () => {
    expect(faturaDe("2025-03-16", 15)).toBe("2025-04-01");
  });

  it("compra na véspera do fechamento fica na fatura corrente", () => {
    expect(faturaDe("2025-03-14", 15)).toBe("2025-03-01");
  });

  it("fechamento dia 31 em fevereiro vale como o último dia do mês (28)", () => {
    expect(faturaDe("2025-02-28", 31)).toBe("2025-03-01");
    expect(faturaDe("2025-02-27", 31)).toBe("2025-02-01");
  });

  it("fechamento dia 30 em fevereiro BISSEXTO vale como dia 29", () => {
    expect(faturaDe("2024-02-29", 30)).toBe("2024-03-01");
    expect(faturaDe("2024-02-28", 30)).toBe("2024-02-01");
  });

  it("fechamento dia 30 em fevereiro NÃO bissexto vale como dia 28", () => {
    expect(faturaDe("2025-02-28", 30)).toBe("2025-03-01");
    expect(faturaDe("2025-02-27", 30)).toBe("2025-02-01");
  });

  it("aplica a regra gregoriana completa: 2000 é bissexto, 2100 não é", () => {
    // Com a regra ingênua (%4 e não %100/%400), 29/02/2000 seria data inválida.
    expect(faturaDe("2000-02-29", 30)).toBe("2000-03-01");
    expect(ultimoDiaDoMes(2000, 2)).toBe(29);
    expect(ultimoDiaDoMes(2100, 2)).toBe(28);
    expect(faturaDe("2100-02-28", 31)).toBe("2100-03-01");
  });

  it("atravessa a virada de ano: dezembro fecha na fatura de janeiro do ano seguinte", () => {
    expect(faturaDe("2025-12-20", 15)).toBe("2026-01-01");
    expect(faturaDe("2025-12-31", 15)).toBe("2026-01-01");
    expect(faturaDe("2025-12-14", 15)).toBe("2025-12-01");
  });

  it("não desloca o dia por fuso horário (UTC-3): compra no dia 1º com fechamento dia 1", () => {
    // Implementação com new Date("2025-03-01").getDate() em America/Sao_Paulo
    // enxergaria 28/02 e devolveria "2025-03-01" — um mês antes do correto.
    expect(faturaDe("2025-03-01", 1)).toBe("2025-04-01");
    expect(faturaDe("2025-03-01", 2)).toBe("2025-03-01");
    expect(faturaDe("2025-01-01", 1)).toBe("2025-02-01");
  });

  it("rejeita dia de fechamento fora de 1-31 e data mal formada", () => {
    expect(() => faturaDe("2025-03-20", 0)).toThrow(RangeError);
    expect(() => faturaDe("2025-03-20", 32)).toThrow(RangeError);
    expect(() => faturaDe("2025-03-20", 15.5)).toThrow(RangeError);
    expect(() => faturaDe("20/03/2025", 15)).toThrow(RangeError);
    expect(() => faturaDe("2025-02-30", 15)).toThrow(RangeError);
  });
});

/* -------------------------------------------------------- vencimentoDaFatura */

describe("fechamentoDaFatura", () => {
  it("fecha no dia do fechamento do PRÓPRIO mês da fatura", () => {
    expect(fechamentoDaFatura("2025-04-01", 15)).toBe("2025-04-15");
    expect(fechamentoDaFatura("2025-12-01", 3)).toBe("2025-12-03");
  });

  it("dia que não existe no mês vira o último dia do mês", () => {
    expect(fechamentoDaFatura("2025-02-01", 31)).toBe("2025-02-28");
    expect(fechamentoDaFatura("2024-02-01", 30)).toBe("2024-02-29");
    expect(fechamentoDaFatura("2025-04-01", 31)).toBe("2025-04-30");
  });

  /**
   * A propriedade que amarra as duas funções: uma compra NO dia do fechamento já
   * é da fatura seguinte, e no dia anterior ainda é da fatura corrente. Se este
   * teste quebrar, `faturaDe` e `fechamentoDaFatura` divergiram e a tela do
   * cartão passará a mostrar uma data de corte que não é o corte de verdade.
   */
  it("é coerente com faturaDe: comprar no dia do fechamento já é da fatura seguinte", () => {
    for (const dia of [1, 5, 15, 28, 31]) {
      for (const mes of ["2025-01-01", "2025-02-01", "2025-04-01", "2024-02-01"]) {
        const corte = fechamentoDaFatura(mes, dia);
        expect(faturaDe(corte, dia)).toBe(somaMeses(mes, 1));
      }
    }
  });

  it("rejeita dia fora de 1-31 e mês mal formado", () => {
    expect(() => fechamentoDaFatura("2025-04-01", 0)).toThrow(RangeError);
    expect(() => fechamentoDaFatura("2025-04-01", 32)).toThrow(RangeError);
    expect(() => fechamentoDaFatura("abril/2025", 10)).toThrow(RangeError);
  });
});

describe("ultimoFechamentoAte", () => {
  it("depois do fechamento do mês, a fronteira é o fechamento DESTE mês", () => {
    expect(ultimoFechamentoAte("2025-04-20", 15)).toBe("2025-04-15");
    expect(ultimoFechamentoAte("2025-04-30", 15)).toBe("2025-04-15");
  });

  it("no PRÓPRIO dia do fechamento ele já ocorreu — mesmo corte >= de faturaDe", () => {
    expect(ultimoFechamentoAte("2025-04-15", 15)).toBe("2025-04-15");
  });

  it("antes do fechamento do mês, a fronteira é a do mês anterior", () => {
    expect(ultimoFechamentoAte("2025-04-14", 15)).toBe("2025-03-15");
    expect(ultimoFechamentoAte("2025-04-01", 15)).toBe("2025-03-15");
  });

  it("atravessa a virada de ano para trás", () => {
    expect(ultimoFechamentoAte("2025-01-05", 15)).toBe("2024-12-15");
  });

  it("aplica o clamp de dia inexistente nos dois lados", () => {
    // Fechamento 31 em março existe; em fevereiro vale 28.
    expect(ultimoFechamentoAte("2025-03-30", 31)).toBe("2025-02-28");
    expect(ultimoFechamentoAte("2025-03-31", 31)).toBe("2025-03-31");
    expect(ultimoFechamentoAte("2024-03-01", 31)).toBe("2024-02-29");
  });

  /**
   * A propriedade que dá sentido à fronteira: tudo que está ANTES dela pertence
   * a uma fatura que já fechou; o que está a partir dela, à fatura ainda aberta.
   * Se isto quebrar, o recálculo de `upsertAccount` passa a reescrever fatura
   * antiga já paga — a opção (b) que a 0010 recusou, entrando pela porta dos
   * fundos.
   */
  it("separa fatura fechada de fatura aberta", () => {
    for (const dia of [1, 5, 15, 28, 31]) {
      for (const hoje of ["2025-01-09", "2025-02-28", "2025-04-15", "2024-02-29", "2025-12-31"]) {
        const corte = ultimoFechamentoAte(hoje, dia);
        expect(corte <= hoje).toBe(true);
        // A fatura da véspera do corte já fechou; a do corte é a que está aberta.
        expect(faturaDe(corte, dia)).toBe(somaMeses(`${corte.slice(0, 7)}-01`, 1));
      }
    }
  });

  it("rejeita dia fora de 1-31 e data mal formada", () => {
    expect(() => ultimoFechamentoAte("2025-04-20", 0)).toThrow(RangeError);
    expect(() => ultimoFechamentoAte("2025-04-20", 32)).toThrow(RangeError);
    expect(() => ultimoFechamentoAte("20/04/2025", 15)).toThrow(RangeError);
    expect(() => ultimoFechamentoAte("2025-02-30", 15)).toThrow(RangeError);
  });
});

describe("vencimentoDaFatura", () => {
  it("vence dentro do próprio mês da fatura quando só o dia é informado", () => {
    expect(vencimentoDaFatura("2025-04-01", 10)).toBe("2025-04-10");
    expect(vencimentoDaFatura("2025-04-01", 7)).toBe("2025-04-07");
  });

  it("dia que não existe no mês vira o último dia do mês", () => {
    expect(vencimentoDaFatura("2025-02-01", 31)).toBe("2025-02-28");
    expect(vencimentoDaFatura("2024-02-01", 30)).toBe("2024-02-29");
    expect(vencimentoDaFatura("2025-04-01", 31)).toBe("2025-04-30");
    expect(vencimentoDaFatura("2025-03-01", 31)).toBe("2025-03-31");
  });

  it("com fechamento informado, vencimento igual ou anterior a ele cai no mês SEGUINTE", () => {
    // Cartão que fecha dia 28 e vence dia 5: a fatura de abril vence em maio.
    expect(vencimentoDaFatura("2025-04-01", 5, 28)).toBe("2025-05-05");
    expect(vencimentoDaFatura("2025-04-01", 28, 28)).toBe("2025-05-28");
  });

  it("com fechamento informado, vencimento posterior fica no próprio mês da fatura", () => {
    expect(vencimentoDaFatura("2025-04-01", 22, 15)).toBe("2025-04-22");
  });

  it("atravessa a virada de ano ao empurrar o vencimento", () => {
    expect(vencimentoDaFatura("2025-12-01", 5, 28)).toBe("2026-01-05");
  });

  it("rejeita dia de vencimento fora de 1-31 e mês mal formado", () => {
    expect(() => vencimentoDaFatura("2025-04-01", 0)).toThrow(RangeError);
    expect(() => vencimentoDaFatura("2025-04-01", 32)).toThrow(RangeError);
    expect(() => vencimentoDaFatura("abril/2025", 10)).toThrow(RangeError);
    expect(() => vencimentoDaFatura("2025-13-01", 10)).toThrow(RangeError);
  });
});

/* ------------------------------------------------------------------ parcelas */

describe("parcelas", () => {
  it("a ÚLTIMA parcela absorve o arredondamento (R$ 100,00 em 3x)", () => {
    expect(parcelas(100_00, 3)).toEqual([3333, 3333, 3334]);
  });

  it("a soma das parcelas bate exatamente com o total, em qualquer divisão", () => {
    for (const total of [100_00, 1, 999_99, 12_345, 7]) {
      for (let n = 1; n <= 12; n++) {
        const lista = parcelas(total, n);
        expect(lista).toHaveLength(n);
        expect(lista.every(Number.isInteger)).toBe(true);
        expect(lista.reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });

  it("uma parcela devolve o total inteiro", () => {
    expect(parcelas(99_99, 1)).toEqual([9999]);
  });

  it("divisão exata não sobrecarrega a última parcela", () => {
    expect(parcelas(90_00, 3)).toEqual([3000, 3000, 3000]);
  });

  it("rejeita número de parcelas <= 0 ou fracionário", () => {
    expect(() => parcelas(100_00, 0)).toThrow(RangeError);
    expect(() => parcelas(100_00, -3)).toThrow(RangeError);
    expect(() => parcelas(100_00, 2.5)).toThrow(RangeError);
  });

  it("rejeita total não inteiro — dinheiro é centavo inteiro, nunca float", () => {
    expect(() => parcelas(100.5, 2)).toThrow(RangeError);
    expect(() => parcelas(Number.NaN, 2)).toThrow(RangeError);
  });
});

/* ---------------------------------------------------- somaMeses / somaMesesNaData */

describe("somaMeses", () => {
  it("avança meses dentro do ano e atravessa a virada", () => {
    expect(somaMeses("2025-04-01", 1)).toBe("2025-05-01");
    expect(somaMeses("2025-11-01", 2)).toBe("2026-01-01");
    expect(somaMeses("2025-01-01", 23)).toBe("2026-12-01");
  });

  it("deslocamento zero devolve o próprio mês e negativo recua", () => {
    expect(somaMeses("2025-04-01", 0)).toBe("2025-04-01");
    expect(somaMeses("2025-01-01", -1)).toBe("2024-12-01");
    expect(somaMeses("2025-01-01", -13)).toBe("2023-12-01");
  });

  it("rejeita mês mal formado e deslocamento fracionário", () => {
    expect(() => somaMeses("abril", 1)).toThrow(RangeError);
    expect(() => somaMeses("2025-04-01", 1.5)).toThrow(RangeError);
  });
});

describe("somaMesesNaData", () => {
  it("mantém o dia quando ele existe no mês de destino", () => {
    expect(somaMesesNaData("2025-03-15", 1)).toBe("2025-04-15");
    expect(somaMesesNaData("2025-12-20", 1)).toBe("2026-01-20");
  });

  it("dia que não existe no destino vira o último dia do mês", () => {
    expect(somaMesesNaData("2025-01-31", 1)).toBe("2025-02-28");
    expect(somaMesesNaData("2024-01-31", 1)).toBe("2024-02-29");
    expect(somaMesesNaData("2025-03-31", 1)).toBe("2025-04-30");
  });

  it("o clamp NÃO é cumulativo: 31/01 + 2 meses é 31/03, não 28/03", () => {
    // Somar "+1 mês" duas vezes mataria o dia 31 em fevereiro e todas as
    // parcelas seguintes ficariam no dia 28 — do lado errado do fechamento.
    expect(somaMesesNaData("2025-01-31", 2)).toBe("2025-03-31");
    expect(somaMesesNaData("2025-01-31", 4)).toBe("2025-05-31");
  });

  it("não desloca o dia por fuso horário", () => {
    expect(somaMesesNaData("2025-03-01", 0)).toBe("2025-03-01");
    expect(somaMesesNaData("2025-03-01", 1)).toBe("2025-04-01");
  });

  it("rejeita data mal formada e data inexistente", () => {
    expect(() => somaMesesNaData("2025-02-30", 1)).toThrow(RangeError);
    expect(() => somaMesesNaData("15/03/2025", 1)).toThrow(RangeError);
  });
});

/* ------------------------------------------------------------ planoDeParcelas */

describe("planoDeParcelas", () => {
  it("a soma das parcelas bate com o total e a última absorve o resto", () => {
    const plano = planoDeParcelas({
      totalCents: 100_00,
      numeroDeParcelas: 3,
      dataCompra: "2025-03-10",
      diaFechamento: 15,
    });
    expect(plano.map((p) => p.amountCents)).toEqual([3333, 3333, 3334]);
    expect(plano.reduce((s, p) => s + p.amountCents, 0)).toBe(100_00);
    expect(plano.map((p) => p.numero)).toEqual([1, 2, 3]);
    expect(plano.every((p) => p.total === 3)).toBe(true);
  });

  it("cada parcela cai na fatura seguinte e um mês à frente na data", () => {
    const plano = planoDeParcelas({
      totalCents: 900_00,
      numeroDeParcelas: 3,
      dataCompra: "2025-03-20",
      diaFechamento: 15,
    });
    // 20/03 já passou do fechamento (15) — a 1ª parcela é da fatura de abril.
    expect(plano.map((p) => p.statementMonth)).toEqual(["2025-04-01", "2025-05-01", "2025-06-01"]);
    expect(plano.map((p) => p.occurredOn)).toEqual(["2025-03-20", "2025-04-20", "2025-05-20"]);
  });

  it("uma parcela por fatura mesmo quando o clamp do fechamento mudaria o corte", () => {
    // A armadilha que justifica deslocar a FATURA em vez de recalcular
    // faturaDe() sobre a data já deslocada: comprando em 28/02 num cartão que
    // fecha dia 29, o fechamento efetivo de fevereiro é 28 (corte >=), então a
    // 1ª parcela é de março. A 2ª ocorre em 28/03, e faturaDe("2025-03-28", 29)
    // devolveria MARÇO — duas parcelas na mesma fatura e abril vazio.
    const plano = planoDeParcelas({
      totalCents: 300_00,
      numeroDeParcelas: 3,
      dataCompra: "2025-02-28",
      diaFechamento: 29,
    });
    expect(plano.map((p) => p.statementMonth)).toEqual(["2025-03-01", "2025-04-01", "2025-05-01"]);
    expect(faturaDe(plano[1]!.occurredOn, 29)).toBe("2025-03-01");
    expect(new Set(plano.map((p) => p.statementMonth)).size).toBe(3);
  });

  it("atravessa a virada de ano nas faturas e nas datas", () => {
    const plano = planoDeParcelas({
      totalCents: 600_00,
      numeroDeParcelas: 3,
      dataCompra: "2025-11-20",
      diaFechamento: 15,
    });
    expect(plano.map((p) => p.statementMonth)).toEqual(["2025-12-01", "2026-01-01", "2026-02-01"]);
    expect(plano.map((p) => p.occurredOn)).toEqual(["2025-11-20", "2025-12-20", "2026-01-20"]);
  });

  it("aplica o clamp de dia inexistente nas datas das parcelas", () => {
    const plano = planoDeParcelas({
      totalCents: 300_00,
      numeroDeParcelas: 3,
      dataCompra: "2025-01-31",
      diaFechamento: 10,
    });
    expect(plano.map((p) => p.occurredOn)).toEqual(["2025-01-31", "2025-02-28", "2025-03-31"]);
    expect(plano.map((p) => p.statementMonth)).toEqual(["2025-02-01", "2025-03-01", "2025-04-01"]);
  });

  it("sem cartão (fechamento null) não há fatura, mas as parcelas continuam mensais", () => {
    const plano = planoDeParcelas({
      totalCents: 100_00,
      numeroDeParcelas: 2,
      dataCompra: "2025-03-10",
      diaFechamento: null,
    });
    expect(plano.map((p) => p.statementMonth)).toEqual([null, null]);
    expect(plano.map((p) => p.occurredOn)).toEqual(["2025-03-10", "2025-04-10"]);
  });

  it("uma parcela só é a compra à vista, na própria data e fatura", () => {
    const plano = planoDeParcelas({
      totalCents: 49_99,
      numeroDeParcelas: 1,
      dataCompra: "2025-03-10",
      diaFechamento: 15,
    });
    expect(plano).toHaveLength(1);
    expect(plano[0]).toEqual({
      numero: 1,
      total: 1,
      amountCents: 4999,
      occurredOn: "2025-03-10",
      statementMonth: "2025-03-01",
    });
  });

  it("nenhuma parcela fica com valor zero quando o total cobre o número de parcelas", () => {
    // Cada linha vira um lançamento, e o banco exige amount_cents > 0.
    const plano = planoDeParcelas({
      totalCents: 36,
      numeroDeParcelas: 36,
      dataCompra: "2025-03-10",
      diaFechamento: 15,
    });
    expect(plano.every((p) => p.amountCents > 0)).toBe(true);
  });

  it("propaga a recusa de entrada inválida em vez de inventar parcela", () => {
    const base = { totalCents: 100_00, dataCompra: "2025-03-10", diaFechamento: 15 };
    expect(() => planoDeParcelas({ ...base, numeroDeParcelas: 0 })).toThrow(RangeError);
    expect(() => planoDeParcelas({ ...base, numeroDeParcelas: 2.5 })).toThrow(RangeError);
    expect(() =>
      planoDeParcelas({ ...base, dataCompra: "2025-02-30", numeroDeParcelas: 2 }),
    ).toThrow(RangeError);
    expect(() =>
      planoDeParcelas({ ...base, dataCompra: "2025-02-30", numeroDeParcelas: 2, diaFechamento: null }),
    ).toThrow(RangeError);
  });
});

/* ---------------------------------------------------------- limiteDisponivel */

describe("limiteDisponivel", () => {
  it("desconta a fatura aberta e os lançamentos ainda não faturados", () => {
    expect(
      limiteDisponivel({
        limiteCents: 5_000_00,
        faturaAbertaCents: 1_200_00,
        naoFaturadoCents: 300_00,
      }),
    ).toBe(350000);
  });

  it("fica NEGATIVO quando o limite estoura — não força zero, a interface precisa saber", () => {
    const disponivel = limiteDisponivel({
      limiteCents: 1_000_00,
      faturaAbertaCents: 900_00,
      naoFaturadoCents: 300_00,
    });
    expect(disponivel).toBe(-20000);
    expect(disponivel).toBeLessThan(0);
  });
});

/* -------------------------------------------------------------- faturaDoCartao */

describe("faturaDoCartao", () => {
  const cartao = { id: "cartao", statement_closing_day: 15 };

  it("agrupa as compras pelo fechamento do cartão, não pelo mês do calendário", () => {
    const fatura = faturaDoCartao(
      [
        tx({ amount_cents: 40_00, occurred_on: "2025-03-14" }), // fatura de março
        tx({ amount_cents: 100_00, occurred_on: "2025-03-20" }), // fatura de abril
        tx({ amount_cents: 50_00, occurred_on: "2025-04-10" }), // fatura de abril
        tx({ amount_cents: 70_00, occurred_on: "2025-04-15" }), // fatura de maio
      ],
      cartao,
      "2025-04-01",
    );
    expect(fatura.totalCents).toBe(15000);
    expect(fatura.itens).toHaveLength(2);
    expect(fatura.itens.map((i) => i.occurred_on)).toEqual(["2025-03-20", "2025-04-10"]);
  });

  it("IGNORA o pagamento da fatura — senão ela se autoabateria", () => {
    const semPagamento = faturaDoCartao(
      [tx({ amount_cents: 500_00, occurred_on: "2025-04-02" })],
      cartao,
      "2025-04-01",
    );
    const comPagamento = faturaDoCartao(
      [
        tx({ amount_cents: 500_00, occurred_on: "2025-04-02" }),
        tx({
          kind: "income",
          amount_cents: 500_00,
          occurred_on: "2025-04-05",
          transfer_group_id: "g-pagamento",
        }),
      ],
      cartao,
      "2025-04-01",
    );
    expect(semPagamento.totalCents).toBe(50000);
    expect(comPagamento.totalCents).toBe(50000);
    expect(comPagamento.itens).toHaveLength(1);
  });

  it("estorno (entrada SEM transferência) abate a fatura de verdade", () => {
    const fatura = faturaDoCartao(
      [
        tx({ amount_cents: 300_00, occurred_on: "2025-04-02" }),
        tx({ kind: "income", amount_cents: 120_00, occurred_on: "2025-04-08" }),
      ],
      cartao,
      "2025-04-01",
    );
    expect(fatura.totalCents).toBe(18000);
    expect(fatura.itens).toHaveLength(2);
  });

  it("saque/transferência SAINDO do cartão continua sendo dívida e entra na fatura", () => {
    const fatura = faturaDoCartao(
      [
        tx({
          kind: "expense",
          amount_cents: 200_00,
          occurred_on: "2025-04-03",
          transfer_group_id: "g-saque",
        }),
      ],
      cartao,
      "2025-04-01",
    );
    expect(fatura.totalCents).toBe(20000);
  });

  it("ignora lançamentos de outras contas e de outros cartões", () => {
    const fatura = faturaDoCartao(
      [
        tx({ amount_cents: 80_00, occurred_on: "2025-04-02" }),
        tx({ amount_cents: 900_00, occurred_on: "2025-04-02", account_id: "outro-cartao" }),
        tx({ amount_cents: 700_00, occurred_on: "2025-04-02", account_id: "conta-corrente" }),
      ],
      cartao,
      "2025-04-01",
    );
    expect(fatura.totalCents).toBe(8000);
    expect(fatura.itens).toHaveLength(1);
  });

  it("não filtra por is_paid — quem define a fatura é a data contra o fechamento", () => {
    const fatura = faturaDoCartao(
      [tx({ amount_cents: 60_00, occurred_on: "2025-04-02", is_paid: false })],
      cartao,
      "2025-04-01",
    );
    expect(fatura.totalCents).toBe(6000);
  });

  it("fatura sem lançamentos vale zero, não NaN", () => {
    const fatura = faturaDoCartao([], cartao, "2025-04-01");
    expect(fatura.totalCents).toBe(0);
    expect(fatura.itens).toEqual([]);
  });

  it("rejeita mês de fatura mal formado em vez de devolver zero em silêncio", () => {
    expect(() => faturaDoCartao([], cartao, "abril")).toThrow(RangeError);
  });
});

/* ------------------------- faturaDoCartao × statement_month gravado */

/**
 * A leitura tem de OBEDECER a coluna `statement_month` gravada na escrita.
 *
 * Recalcular `faturaDe(occurred_on, fechamento_de_hoje)` na leitura é a opção
 * (b) que a 0010 descartou por escrito, e não é uma diferença acadêmica: ela
 * discorda do dado gravado em dois casos que acontecem sozinhos (parcelamento e
 * mudança do dia de fechamento). O número errado não fica só na tela — ele
 * pré-preenche o valor do pagamento da fatura.
 */
describe("faturaDoCartao respeita o statement_month gravado", () => {
  const cartao = { id: "cartao", statement_closing_day: 29 };

  it("parcelamento: uma parcela por fatura, mesmo quando o clamp mudaria o corte", () => {
    // Exatamente o cenário da DECISÃO 1 de planoDeParcelas: compra de R$ 300,00
    // em 3x no dia 28/02 num cartão que fecha dia 29. O fechamento efetivo de
    // fevereiro é 28 (clamp), o de março é 29 — então faturaDe("2025-03-28", 29)
    // devolve MARÇO e a 2ª parcela cairia na mesma fatura da 1ª.
    const plano = planoDeParcelas({
      totalCents: 300_00,
      numeroDeParcelas: 3,
      dataCompra: "2025-02-28",
      diaFechamento: 29,
    });
    const linhas = plano.map((p) =>
      tx({
        amount_cents: p.amountCents,
        occurred_on: p.occurredOn,
        statement_month: p.statementMonth,
        installment_no: p.numero,
        installment_total: p.total,
        installment_group_id: "g-parcelas",
      }),
    );

    // A prova de que o recálculo erraria: a data da 2ª parcela volta para março.
    expect(faturaDe(linhas[1]!.occurred_on, 29)).toBe("2025-03-01");

    for (const [mes, esperado] of [
      ["2025-03-01", 10000],
      ["2025-04-01", 10000],
      ["2025-05-01", 10000],
    ] as const) {
      const fatura = faturaDoCartao(linhas, cartao, mes);
      expect(fatura.totalCents).toBe(esperado);
      expect(fatura.itens).toHaveLength(1);
    }
  });

  it("mudar o dia de fechamento NÃO reescreve a fatura já gravada", () => {
    // Compra de R$ 100,00 em 20/03 gravada com a fatura de abril (fechamento 15).
    const linha = tx({
      amount_cents: 100_00,
      occurred_on: "2025-03-20",
      statement_month: "2025-04-01",
    });
    // O usuário edita o cartão para fechar dia 25. Com recálculo na leitura,
    // faturaDe("2025-03-20", 25) diria MARÇO e a fatura de abril — já fechada e
    // possivelmente paga — cairia de R$ 100,00 para zero.
    expect(faturaDe("2025-03-20", 25)).toBe("2025-03-01");

    const abril = faturaDoCartao([linha], { id: "cartao", statement_closing_day: 25 }, "2025-04-01");
    const marco = faturaDoCartao([linha], { id: "cartao", statement_closing_day: 25 }, "2025-03-01");
    expect(abril.totalCents).toBe(10000);
    expect(marco.totalCents).toBe(0);
  });

  it("linha SEM statement_month cai no cálculo pela data (compatibilidade com o legado)", () => {
    // Lançamento anterior à 0010: não há fato gravado para respeitar, e derivar
    // pela data é melhor que a compra sumir de toda fatura.
    const legado = tx({ amount_cents: 70_00, occurred_on: "2025-04-02", statement_month: null });
    const fatura = faturaDoCartao([legado], { id: "cartao", statement_closing_day: 15 }, "2025-04-01");
    expect(fatura.totalCents).toBe(7000);
    expect(fatura.itens).toHaveLength(1);
  });

  it("aceita statement_month vindo do banco como data completa do dia 1", () => {
    const linha = tx({ amount_cents: 25_00, occurred_on: "2025-01-05", statement_month: "2025-06-01" });
    expect(faturaDoCartao([linha], cartao, "2025-06-01").totalCents).toBe(2500);
    expect(faturaDoCartao([linha], cartao, "2025-01-01").totalCents).toBe(0);
  });
});

/* ---------------------------------------- saldo devedor da fatura (pagamentos) */

describe("faturaDoCartao: quanto já foi pago e quanto falta", () => {
  const cartao = { id: "cartao", statement_closing_day: 15 };
  const compra = tx({
    amount_cents: 1_200_00,
    occurred_on: "2025-04-02",
    statement_month: "2025-04-01",
  });

  /** Perna que ENTRA no cartão, como payStatement grava: income + grupo + mês. */
  function pagamento(amount_cents: number, statement_month: string | null) {
    return tx({
      kind: "income",
      amount_cents,
      occurred_on: "2025-04-20",
      transfer_group_id: crypto.randomUUID(),
      statement_month,
    });
  }

  it("pagamento parcial abate o saldo devedor sem mexer no total lançado", () => {
    const fatura = faturaDoCartao([compra, pagamento(500_00, "2025-04-01")], cartao, "2025-04-01");
    // O total é o que o banco cobrou; o que ainda se deve é o que se paga.
    expect(fatura.totalCents).toBe(120000);
    expect(fatura.paidCents).toBe(50000);
    expect(fatura.openCents).toBe(70000);
    // O pagamento continua fora da lista: ele não é um lançamento da fatura.
    expect(fatura.itens).toHaveLength(1);
  });

  it("soma vários pagamentos da mesma fatura", () => {
    const fatura = faturaDoCartao(
      [compra, pagamento(500_00, "2025-04-01"), pagamento(200_00, "2025-04-01")],
      cartao,
      "2025-04-01",
    );
    expect(fatura.paidCents).toBe(70000);
    expect(fatura.openCents).toBe(50000);
  });

  it("pagamento de OUTRA fatura não abate esta", () => {
    const fatura = faturaDoCartao([compra, pagamento(500_00, "2025-03-01")], cartao, "2025-04-01");
    expect(fatura.paidCents).toBe(0);
    expect(fatura.openCents).toBe(120000);
  });

  it("entrada no cartão SEM statement_month não é atribuída a fatura nenhuma", () => {
    // Transferência solta para o cartão (createTransfer grava null na perna que
    // entra): adivinhar a fatura pela data do crédito abateria o mês errado.
    const fatura = faturaDoCartao([compra, pagamento(500_00, null)], cartao, "2025-04-01");
    expect(fatura.paidCents).toBe(0);
    expect(fatura.openCents).toBe(120000);
  });

  it("pagamento a maior deixa o saldo NEGATIVO — sem piso em zero", () => {
    const fatura = faturaDoCartao([compra, pagamento(1_500_00, "2025-04-01")], cartao, "2025-04-01");
    expect(fatura.openCents).toBe(-30000);
  });

  it("fatura sem pagamento tem openCents igual ao total", () => {
    const fatura = faturaDoCartao([compra], cartao, "2025-04-01");
    expect(fatura.paidCents).toBe(0);
    expect(fatura.openCents).toBe(fatura.totalCents);
  });

  it("estorno abate o total, e o pagamento abate o que sobrou", () => {
    const estorno = tx({
      kind: "income",
      amount_cents: 200_00,
      occurred_on: "2025-04-10",
      statement_month: "2025-04-01",
    });
    const fatura = faturaDoCartao(
      [compra, estorno, pagamento(400_00, "2025-04-01")],
      cartao,
      "2025-04-01",
    );
    expect(fatura.totalCents).toBe(100000);
    expect(fatura.paidCents).toBe(40000);
    expect(fatura.openCents).toBe(60000);
  });
});

describe("ehPagamentoDeFatura", () => {
  it("só a perna de transferência que ENTRA no cartão é pagamento", () => {
    expect(ehPagamentoDeFatura(tx({ kind: "income", transfer_group_id: "g1" }))).toBe(true);
    expect(ehPagamentoDeFatura(tx({ kind: "income", transfer_group_id: null }))).toBe(false);
    expect(ehPagamentoDeFatura(tx({ kind: "expense", transfer_group_id: "g1" }))).toBe(false);
  });
});

/* ------------------------------------------------------------ patrimônio x dívida */

describe("patrimonioEDivida", () => {
  const accounts: Pick<FinanceAccount, "id" | "kind">[] = [
    { id: "corrente", kind: "checking" },
    { id: "poupanca", kind: "savings" },
    { id: "cartao", kind: "credit_card" },
  ];

  function saldo(
    account_id: string,
    balance_cents: number,
  ): Pick<FinanceAccountBalance, "account_id" | "balance_cents"> {
    return { account_id, balance_cents };
  }

  it("cartão vira DÍVIDA positiva e nunca é somado ao patrimônio", () => {
    const r = patrimonioEDivida(
      [saldo("corrente", 2_500_00), saldo("poupanca", 1_000_00), saldo("cartao", -800_00)],
      accounts,
    );
    expect(r.patrimonioCents).toBe(350000);
    expect(r.dividaCents).toBe(80000);
  });

  it("ignora saldos de contas fora da lista informada (ex.: arquivadas)", () => {
    const r = patrimonioEDivida(
      [saldo("corrente", 100_00), saldo("arquivada", 999_00), saldo("cartao", -50_00)],
      accounts,
    );
    expect(r.patrimonioCents).toBe(10000);
    expect(r.dividaCents).toBe(5000);
  });

  it("cartão pago a maior mostra dívida negativa (crédito a favor), sem piso em zero", () => {
    const r = patrimonioEDivida([saldo("cartao", 150_00)], accounts);
    expect(r.dividaCents).toBe(-15000);
    expect(r.patrimonioCents).toBe(0);
  });

  it("usa o kind da conta, não o do saldo: só cartão entra em dívida", () => {
    const r = patrimonioEDivida([saldo("poupanca", -300_00)], accounts);
    expect(r.patrimonioCents).toBe(-30000);
    expect(r.dividaCents).toBe(0);
  });
});

/* ============================================================================ */
/*  statusDaFatura — derivado, nunca gravado                                    */
/* ============================================================================ */

describe("statusDaFatura", () => {
  /** Cartão que fecha dia 10 e vence dia 20 do MESMO mês do fechamento. */
  const cartao = { diaFechamento: 10, diaVencimento: 20 };
  const mes = "2026-03-01";

  const status = (hoje: string, totalCents: number, paidCents: number) =>
    statusDaFatura({
      hoje,
      mesFatura: mes,
      ...cartao,
      resumo: { totalCents, paidCents, openCents: totalCents - paidCents },
    });

  it("aberta enquanto o ciclo não fechou", () => {
    expect(status("2026-03-01", 10_000, 0)).toBe("aberta");
    expect(status("2026-03-09", 10_000, 0)).toBe("aberta");
  });

  it("fechada no dia do fechamento — o dia do corte já é depois", () => {
    // Mesma convenção de `faturaDe`: a compra no dia do fechamento já é da
    // próxima fatura, logo o ciclo fechou no começo desse dia.
    expect(status("2026-03-10", 10_000, 0)).toBe("fechada");
  });

  it("parcial quando pagou algo e ainda deve, dentro do prazo", () => {
    expect(status("2026-03-15", 10_000, 4_000)).toBe("parcial");
  });

  it("vencida quando passou o vencimento e ainda deve", () => {
    expect(status("2026-03-21", 10_000, 0)).toBe("vencida");
    expect(status("2026-03-21", 10_000, 4_000)).toBe("vencida");
  });

  it("no DIA do vencimento ainda não está vencida", () => {
    // Quem paga no dia paga em dia. Marcar vermelho às 00h01 do vencimento
    // seria cobrar antes da hora.
    expect(status("2026-03-20", 10_000, 0)).toBe("fechada");
  });

  /*
    A ordem dos testes dentro da função: PAGA vem antes de VENCIDA. Sem isso,
    toda fatura antiga já quitada apareceria como vencida — que é a maioria
    delas.
  */
  it("paga vence 'vencida': fatura quitada continua paga depois do prazo", () => {
    expect(status("2027-01-01", 10_000, 10_000)).toBe("paga");
  });

  it("pagamento a maior conta como paga, não como aberta", () => {
    // openCents negativo é crédito a favor. Ver o comentário de `openCents`.
    expect(status("2026-03-21", 10_000, 12_000)).toBe("paga");
  });

  it("mês sem uso nenhum nunca aparece como vencida", () => {
    expect(status("2026-03-05", 0, 0)).toBe("aberta");
    expect(status("2026-04-30", 0, 0)).toBe("paga");
  });

  it("respeita cartão que vence no mês SEGUINTE ao fechamento", () => {
    // "fecha 28, vence 5": o vencimento cai no mês seguinte, e é o caso que o
    // `diaVencimento <= diaFechamento` de `vencimentoDaFatura` resolve.
    const r = (hoje: string) =>
      statusDaFatura({
        hoje,
        mesFatura: "2026-03-01",
        diaFechamento: 28,
        diaVencimento: 5,
        resumo: { totalCents: 10_000, paidCents: 0, openCents: 10_000 },
      });

    expect(r("2026-03-27")).toBe("aberta");
    expect(r("2026-03-29")).toBe("fechada");
    // Vence em 05/04, não em 05/03.
    expect(r("2026-04-04")).toBe("fechada");
    expect(r("2026-04-06")).toBe("vencida");
  });

  it("fechamento 31 em fevereiro cai no último dia do mês", () => {
    const r = (hoje: string) =>
      statusDaFatura({
        hoje,
        mesFatura: "2026-02-01",
        diaFechamento: 31,
        diaVencimento: 10,
        resumo: { totalCents: 5_000, paidCents: 0, openCents: 5_000 },
      });

    // 2026 não é bissexto: fevereiro fecha em 28.
    expect(r("2026-02-27")).toBe("aberta");
    expect(r("2026-02-28")).toBe("fechada");
  });
});

/* ------------------------------------------------------- o que vence no mês */

describe("faturasQueVencemEm", () => {
  const CARTAO = { id: "cartao", statement_closing_day: 28, payment_due_day: 5 };

  it("⚠️ 'FECHA 28, VENCE 5': o que vence em MAIO é a fatura de ABRIL", () => {
    /*
      A distinção que motiva a função inteira. "Quanto sai do meu bolso em maio?"
      não é "quanto veio na fatura de maio" — no arranjo mais comum do Brasil as
      duas respostas estão a um ciclo inteiro de distância, e responder com a
      fatura de maio erraria por um mês de dinheiro.
    */
    const abril = tx({ occurred_on: "2026-04-10", statement_month: "2026-04-01", amount_cents: 300_00 });
    const maio = tx({ occurred_on: "2026-05-10", statement_month: "2026-05-01", amount_cents: 999_00 });

    const vencendo = faturasQueVencemEm([abril, maio], [CARTAO], "2026-05-01");

    expect(vencendo).toHaveLength(1);
    expect(vencendo[0]!.mesFatura).toBe("2026-04-01");
    expect(vencendo[0]!.vence).toBe("2026-05-05");
    expect(vencendo[0]!.openCents).toBe(30000);
  });

  it("'fecha 5, vence 12': a fatura vence DENTRO do próprio mês", () => {
    const cartao = { id: "cartao", statement_closing_day: 5, payment_due_day: 12 };
    const maio = tx({ occurred_on: "2026-05-02", statement_month: "2026-05-01", amount_cents: 120_00 });

    const vencendo = faturasQueVencemEm([maio], [cartao], "2026-05-01");

    expect(vencendo).toHaveLength(1);
    expect(vencendo[0]!.mesFatura).toBe("2026-05-01");
    expect(vencendo[0]!.vence).toBe("2026-05-12");
  });

  it("desconta o que já foi pago daquela fatura", () => {
    const compra = tx({ occurred_on: "2026-04-10", statement_month: "2026-04-01", amount_cents: 300_00 });
    const pagamento = tx({
      kind: "income",
      transfer_group_id: "g1",
      occurred_on: "2026-05-05",
      statement_month: "2026-04-01",
      amount_cents: 100_00,
    });

    const [fatura] = faturasQueVencemEm([compra, pagamento], [CARTAO], "2026-05-01");

    expect(fatura!.totalCents).toBe(30000);
    expect(fatura!.paidCents).toBe(10000);
    expect(fatura!.openCents).toBe(20000);
  });

  it("cartão sem os dias cadastrados fica de fora, em vez de derrubar a tela", () => {
    // `vencimentoDaFatura` LANÇA para dia inválido. Sem esta guarda, um cartão
    // cadastrado pela metade quebraria o Painel inteiro — e não há resposta
    // honesta a dar sobre um cartão que não disse quando fecha.
    const incompleto = { id: "cartao", statement_closing_day: null, payment_due_day: null };
    expect(faturasQueVencemEm([], [incompleto], "2026-05-01")).toEqual([]);
  });

  it("totalAPagarEm: crédito a favor de um cartão NÃO abate a dívida do outro", () => {
    /*
      `openCents` fica negativo quando a fatura foi paga a maior. Somando cru, o
      crédito de um cartão apagaria dívida de outro e o número mostraria menos a
      pagar do que vai sair da conta. O piso é POR FATURA, não na soma.
    */
    const total = totalAPagarEm([
      { cardId: "a", mesFatura: "2026-04-01", vence: "2026-05-05", totalCents: 0, paidCents: 0, openCents: -50_00 },
      { cardId: "b", mesFatura: "2026-04-01", vence: "2026-05-10", totalCents: 0, paidCents: 0, openCents: 200_00 },
    ]);
    expect(total).toBe(20000);
  });
});

/* ------------------------------------------------------ rotativo e encargos */

describe("calcularEncargos", () => {
  it("juros simples sobre o saldo remanescente", () => {
    // R$ 600 a 10% ao mês = R$ 60. É a conta que o usuário confere de cabeça —
    // e é por isso que ela é simples, e não composta.
    expect(
      calcularEncargos({ saldoRemanescenteCents: 60_000, taxaMensalPercent: 10 }),
    ).toEqual({ jurosCents: 6_000, iofCents: 0, totalCents: 6_000 });
  });

  it("soma o IOF sem misturá-lo com os juros", () => {
    // Separados no retorno porque a tela mostra os dois, e porque um dia o IOF
    // pode virar linha própria sem mexer no cálculo dos juros.
    const r = calcularEncargos({
      saldoRemanescenteCents: 100_000,
      taxaMensalPercent: 5,
      iofCents: 1_234,
    });
    expect(r.jurosCents).toBe(5_000);
    expect(r.iofCents).toBe(1_234);
    expect(r.totalCents).toBe(6_234);
  });

  it("taxa zero não gera encargo — rolar sem juros é permitido", () => {
    expect(
      calcularEncargos({ saldoRemanescenteCents: 100_000, taxaMensalPercent: 0 }).totalCents,
    ).toBe(0);
  });

  it("saldo zero não gera encargo, mesmo com taxa", () => {
    expect(
      calcularEncargos({ saldoRemanescenteCents: 0, taxaMensalPercent: 15 }).totalCents,
    ).toBe(0);
  });

  it("⚠️ SALDO NEGATIVO (fatura paga a maior) NÃO vira juros negativos", () => {
    /*
      `openCents` fica negativo quando se paga mais do que se deve — é crédito a
      favor, não dívida. Sem o piso em zero, os "juros" sairiam negativos e o
      lançamento entraria como uma RECEITA no cartão: pagar demais passaria a
      render dinheiro.
    */
    expect(
      calcularEncargos({ saldoRemanescenteCents: -50_000, taxaMensalPercent: 15 }).jurosCents,
    ).toBe(0);
  });

  it("arredonda uma vez, no fim, e sempre para o centavo mais próximo", () => {
    // R$ 333,33 a 3,33% = 1109,98... centavos -> 1110.
    expect(
      calcularEncargos({ saldoRemanescenteCents: 33_333, taxaMensalPercent: 3.33 }).jurosCents,
    ).toBe(1_110);
    // Meio centavo exato sobe: 10000 * 0.005% = 0,5 centavo -> 1.
    expect(
      calcularEncargos({ saldoRemanescenteCents: 10_000, taxaMensalPercent: 0.005 }).jurosCents,
    ).toBe(1);
    // O resultado é SEMPRE inteiro — dinheiro fracionário aqui viraria erro de
    // constraint no banco (`finance_tx_amount_positive` sobre bigint).
    for (const taxa of [1.7, 2.35, 7.77, 12.5, 19.99]) {
      const r = calcularEncargos({ saldoRemanescenteCents: 87_654, taxaMensalPercent: taxa });
      expect(Number.isSafeInteger(r.totalCents)).toBe(true);
    }
  });

  it("recusa taxa negativa e IOF fracionário", () => {
    expect(() =>
      calcularEncargos({ saldoRemanescenteCents: 1000, taxaMensalPercent: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      calcularEncargos({ saldoRemanescenteCents: 1000, taxaMensalPercent: 1, iofCents: 1.5 }),
    ).toThrow(RangeError);
  });
});

describe("faturaDoEncargo", () => {
  it("pagando depois do fechamento, os juros caem na fatura da data", () => {
    // Fatura de agosto paga em 20/08 com fechamento dia 15: 20/08 já pertence à
    // fatura de setembro, que é a seguinte. As duas regras concordam.
    expect(faturaDoEncargo("2026-08-01", "2026-08-20", 15)).toBe("2026-09-01");
  });

  it("⚠️ PAGANDO ANTES DO FECHAMENTO, o piso impede o juro de cair na própria fatura paga", () => {
    /*
      Cartão que fecha dia 5. Quem paga a fatura de agosto no dia 3 de agosto
      faria `faturaDe("2026-08-03", 5)` devolver AGOSTO — a mesma fatura que
      acabou de ser quitada. Os juros inflariam o total já pago, e o pagamento
      pareceria não ter fechado a conta.
    */
    expect(faturaDe("2026-08-03", 5)).toBe("2026-08-01");
    expect(faturaDoEncargo("2026-08-01", "2026-08-03", 5)).toBe("2026-09-01");
  });

  it("pagando MUITO atrasado, o encargo acompanha a data — não fica preso no mês seguinte", () => {
    // Juros continuam correndo enquanto a fatura não é paga. Prender o encargo
    // em setembro cobraria o rotativo de novembro numa fatura já fechada.
    expect(faturaDoEncargo("2026-08-01", "2026-11-20", 15)).toBe("2026-12-01");
  });

  it("atravessa a virada de ano", () => {
    expect(faturaDoEncargo("2026-12-01", "2026-12-20", 15)).toBe("2027-01-01");
  });
});

describe("invariante do rotativo: o principal NÃO é relançado", () => {
  it("⚠️ A DÍVIDA DA FATURA NÃO MUDA COM O PAGAMENTO PARCIAL — só o que falta pagar", () => {
    /*
      O TESTE QUE PROTEGE A MODELAGEM INTEIRA DA ETAPA.

      Um lançamento de "saldo remanescente" na fatura seguinte contaria a mesma
      despesa duas vezes. Aqui isso apareceria como `totalCents` mudando depois
      do pagamento, ou como a soma das duas faturas passando de R$ 1.000.
    */
    const conta = { id: "cartao", statement_closing_day: 15 };
    const compra = tx({
      occurred_on: "2026-08-05",
      statement_month: "2026-08-01",
      amount_cents: 100_000,
    });

    const antes = faturaDoCartao([compra], conta, "2026-08-01");
    expect(antes.totalCents).toBe(100_000);
    expect(antes.openCents).toBe(100_000);

    const pagamentoParcial = tx({
      kind: "income",
      transfer_group_id: "g1",
      occurred_on: "2026-08-20",
      statement_month: "2026-08-01",
      amount_cents: 40_000,
    });
    const encargo = tx({
      occurred_on: "2026-08-20",
      statement_month: "2026-09-01",
      amount_cents: 6_000,
      description: "Juros sobre a fatura 08/2026",
    });

    const depois = faturaDoCartao([compra, pagamentoParcial, encargo], conta, "2026-08-01");
    // O que veio na fatura NÃO mudou: nenhum lançamento novo entrou nela.
    expect(depois.totalCents).toBe(100_000);
    // Só o que falta pagar mudou.
    expect(depois.paidCents).toBe(40_000);
    expect(depois.openCents).toBe(60_000);

    // A fatura seguinte recebe EXATAMENTE os juros — nunca o principal rolado.
    const seguinte = faturaDoCartao([compra, pagamentoParcial, encargo], conta, "2026-09-01");
    expect(seguinte.totalCents).toBe(6_000);
    expect(seguinte.itens).toHaveLength(1);
  });
});
