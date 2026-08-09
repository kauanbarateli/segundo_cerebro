import { describe, expect, it } from "vitest";
import {
  monthTotals,
  totaisDoPeriodo,
  expensesByCategory,
  despesasPorEtiqueta,
  topBeneficiarios,
  historicoMensal,
  porSemana,
  mesDeCompetencia,
  foraDeCompetencia,
  cartoesDe,
  mesesDoRecorte,
  periodoAnterior,
  variation,
  previousMonthIso,
  nextMonthIso,
  budgetProgress,
  isTransfer,
  type ContaParaCompetencia,
} from "./finance";
import type { FinanceTransaction, FinanceCategory, FinanceBudget } from "./database.types";
import { parseBRLToCents, formatBRL } from "./utils";

/*
  As contas de todos os casos. `a1` é o padrão do helper `tx()` abaixo e NÃO é
  cartão, para que os testes antigos continuem falando do que sempre falaram: o
  dinheiro que já saiu.
*/
const CORRENTE = "a1";
const CARTAO = "cartao-1";
const CONTAS: ContaParaCompetencia[] = [
  { id: CORRENTE, kind: "checking" },
  { id: CARTAO, kind: "credit_card" },
];

function tx(over: Partial<FinanceTransaction>): FinanceTransaction {
  return {
    id: crypto.randomUUID(),
    user_id: "u1",
    account_id: "a1",
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
    // Colunas de cartão (0010). Nulas por padrão: estes testes são sobre o
    // dinheiro que já saiu, não sobre fatura.
    installment_group_id: null,
    installment_no: null,
    installment_total: null,
    statement_month: null,
    ...over,
  };
}

describe("monthTotals", () => {
  it("soma receitas e despesas do mês", () => {
    const t = monthTotals(
      [
        tx({ kind: "income", amount_cents: 500_00 }),
        tx({ kind: "expense", amount_cents: 120_00 }),
        tx({ kind: "expense", amount_cents: 80_00 }),
      ],
      "2026-07-01",
      CONTAS,
    );
    expect(t.incomeCents).toBe(50000);
    expect(t.expenseCents).toBe(20000);
    expect(t.balanceCents).toBe(30000);
    expect(t.transactionCount).toBe(3);
  });

  it("IGNORA transferências — senão o mesmo dinheiro contaria duas vezes", () => {
    const group = "g1";
    const t = monthTotals(
      [
        tx({ kind: "expense", amount_cents: 100_00, transfer_group_id: group }),
        tx({ kind: "income", amount_cents: 100_00, transfer_group_id: group }),
        tx({ kind: "expense", amount_cents: 25_00 }),
      ],
      "2026-07-01",
      CONTAS,
    );
    expect(t.incomeCents).toBe(0);
    expect(t.expenseCents).toBe(2500);
    expect(t.transactionCount).toBe(1);
  });

  it("ignora lançamentos de outros meses", () => {
    const t = monthTotals(
      [
        tx({ kind: "expense", amount_cents: 10_00, occurred_on: "2026-06-30" }),
        tx({ kind: "expense", amount_cents: 20_00, occurred_on: "2026-07-01" }),
      ],
      "2026-07-01",
      CONTAS,
    );
    expect(t.expenseCents).toBe(2000);
  });
});

describe("mesDeCompetencia — o mês de um lançamento de cartão é o da FATURA", () => {
  const cartoes = cartoesDe(CONTAS);

  it("⚠️ COMPRA DEPOIS DO FECHAMENTO PESA NO MÊS SEGUINTE", () => {
    /*
      O CASO QUE JUSTIFICA A CORREÇÃO INTEIRA.

      Compra em 25/03 num cartão que fecha dia 22: ela entra na fatura de ABRIL
      (a de março já fechou), e é em abril que o dinheiro sai. Antes disto, toda
      soma do Painel usava `occurred_on` e contava a compra em MARÇO — o mês em
      que o número aparecia e o mês em que a conta era paga eram diferentes.

      O `statement_month` já vinha gravado desde a 0010. O Painel é que não o lia.
    */
    const compra = tx({
      account_id: CARTAO,
      occurred_on: "2026-03-25",
      statement_month: "2026-04-01",
      amount_cents: 300_00,
    });

    expect(mesDeCompetencia(compra, cartoes)).toBe("2026-04-01");
    expect(monthTotals([compra], "2026-03-01", CONTAS).expenseCents).toBe(0);
    expect(monthTotals([compra], "2026-04-01", CONTAS).expenseCents).toBe(30000);
  });

  it("atravessa a virada de ano pela coluna, sem aritmética de data", () => {
    // Compra em 28/12 com fechamento dia 22 -> fatura de JANEIRO do ano seguinte.
    // O mês vem da coluna gravada; aqui não há soma de mês para errar.
    const compra = tx({
      account_id: CARTAO,
      occurred_on: "2025-12-28",
      statement_month: "2026-01-01",
      amount_cents: 90_00,
    });

    expect(mesDeCompetencia(compra, cartoes)).toBe("2026-01-01");
    expect(monthTotals([compra], "2025-12-01", CONTAS).expenseCents).toBe(0);
    expect(monthTotals([compra], "2026-01-01", CONTAS).expenseCents).toBe(9000);
  });

  it("conta que NÃO é cartão continua indo pela data da compra", () => {
    // O contrapeso: fora de cartão, comprar e pagar são o mesmo evento. Mudar
    // isto teria mexido em todo o resto do produto sem motivo.
    const compra = tx({ occurred_on: "2026-03-25", statement_month: null });
    expect(mesDeCompetencia(compra, cartoes)).toBe("2026-03-01");
    expect(monthTotals([compra], "2026-03-01", CONTAS).expenseCents).toBe(1000);
  });

  it("cartão SEM fechamento: fica fora das somas e é CONTADO à parte", () => {
    /*
      Cartão cadastrado sem dia de fechamento grava `statement_month` nulo
      (financeiro/actions.ts). A linha pesa em `debt_cents` — a view só olha
      `is_paid` — e não pertence a fatura nenhuma.

      Somá-la por `occurred_on` seria voltar ao defeito só para ela. Omiti-la em
      silêncio faria a despesa do mês vir menor que a real sem nenhum sinal. Por
      isso ela sai das somas E é contada por `foraDeCompetencia`, para a tela
      poder dizer que existe.
    */
    const orfa = tx({ account_id: CARTAO, occurred_on: "2026-03-10", statement_month: null });

    expect(mesDeCompetencia(orfa, cartoes)).toBeNull();
    expect(monthTotals([orfa], "2026-03-01", CONTAS).expenseCents).toBe(0);

    const fora = foraDeCompetencia([orfa], cartoes);
    expect(fora.quantidade).toBe(1);
    expect(fora.totalCents).toBe(1000);
  });

  it("pagamento de fatura não vira despesa em mês nenhum", () => {
    // A perna que ENTRA no cartão tem `transfer_group_id`, então `isTransfer` a
    // exclui antes de qualquer conta de competência. Sem isso, pagar a fatura
    // apareceria como receita do mês no cartão.
    const pagamento = tx({
      account_id: CARTAO,
      kind: "income",
      transfer_group_id: "g1",
      statement_month: "2026-04-01",
      amount_cents: 500_00,
    });
    const t = monthTotals([pagamento], "2026-04-01", CONTAS);
    expect(t.incomeCents).toBe(0);
    expect(foraDeCompetencia([pagamento], cartoes).quantidade).toBe(0);
  });
});

describe("recortes", () => {
  it("trimestre e ano são os CIVIS, não os N meses até aqui", () => {
    expect(mesesDoRecorte("2026-08-01", "mes")).toEqual(["2026-08-01"]);
    // Agosto está no 3º trimestre: jul–set. "Os três meses até agosto" seria
    // jun–ago, e aí "3º trimestre" significaria coisas diferentes para cada um.
    expect(mesesDoRecorte("2026-08-01", "trimestre")).toEqual([
      "2026-07-01",
      "2026-08-01",
      "2026-09-01",
    ]);
    expect(mesesDoRecorte("2026-08-01", "ano")).toHaveLength(12);
    expect(mesesDoRecorte("2026-08-01", "ano")[0]).toBe("2026-01-01");
    expect(mesesDoRecorte("2026-08-01", "ano")[11]).toBe("2026-12-01");
  });

  it("o período anterior tem o MESMO tamanho e atravessa o ano", () => {
    expect(periodoAnterior(["2026-01-01"])).toEqual(["2025-12-01"]);
    expect(periodoAnterior(["2026-01-01", "2026-02-01", "2026-03-01"])).toEqual([
      "2025-10-01",
      "2025-11-01",
      "2025-12-01",
    ]);
  });

  it("totaisDoPeriodo soma os meses do recorte", () => {
    const txs = [
      tx({ occurred_on: "2026-07-05", amount_cents: 100_00 }),
      tx({ occurred_on: "2026-08-05", amount_cents: 200_00 }),
      tx({ occurred_on: "2026-09-05", amount_cents: 300_00 }),
      tx({ occurred_on: "2026-10-05", amount_cents: 999_00 }),
    ];
    const t = totaisDoPeriodo(txs, mesesDoRecorte("2026-08-01", "trimestre"), CONTAS);
    expect(t.expenseCents).toBe(60000);
    expect(t.transactionCount).toBe(3);
  });
});

describe("agregações do Painel", () => {
  it("historicoMensal devolve os N meses em ordem, com zero onde não houve nada", () => {
    const txs = [
      tx({ occurred_on: "2026-06-10", amount_cents: 50_00 }),
      tx({ occurred_on: "2026-08-10", kind: "income", amount_cents: 400_00 }),
    ];
    const h = historicoMensal(txs, CONTAS, "2026-08-01", 3);
    expect(h.map((m) => m.mes)).toEqual(["2026-06-01", "2026-07-01", "2026-08-01"]);
    expect(h[0]!.expenseCents).toBe(5000);
    expect(h[1]!.expenseCents).toBe(0);
    expect(h[2]!.balanceCents).toBe(40000);
  });

  it("historicoMensal usa a fatura para cartão, como todo o resto", () => {
    const compra = tx({
      account_id: CARTAO,
      occurred_on: "2026-06-28",
      statement_month: "2026-07-01",
      amount_cents: 77_00,
    });
    const h = historicoMensal([compra], CONTAS, "2026-08-01", 3);
    expect(h[0]!.expenseCents).toBe(0); // junho, quando a compra aconteceu
    expect(h[1]!.expenseCents).toBe(7700); // julho, quando a fatura fecha
  });

  it("porSemana: a soma das faixas é IGUAL ao total do período", () => {
    /*
      A única propriedade que precisa valer. As faixas são ancoradas na primeira
      compra (e não no dia 1), justamente para que uma compra de cartão vinda do
      fim do mês anterior não fique de fora — se ficasse, as barras somariam
      menos que o número exibido logo acima delas.
    */
    const txs = [
      tx({ account_id: CARTAO, occurred_on: "2026-06-25", statement_month: "2026-07-01", amount_cents: 10_00 }),
      tx({ occurred_on: "2026-07-03", amount_cents: 20_00 }),
      tx({ occurred_on: "2026-07-19", amount_cents: 30_00 }),
    ];
    const faixas = porSemana(txs, ["2026-07-01"], CONTAS);
    const soma = faixas.reduce((s, f) => s + f.expenseCents, 0);
    expect(soma).toBe(totaisDoPeriodo(txs, ["2026-07-01"], CONTAS).expenseCents);
    expect(faixas[0]!.inicio).toBe("2026-06-25");
  });

  it("porSemana devolve lista vazia em período sem lançamento", () => {
    expect(porSemana([], ["2026-07-01"], CONTAS)).toEqual([]);
  });

  it("despesasPorEtiqueta conta o lançamento em CADA etiqueta dele", () => {
    // Por isso `share` é sobre a despesa ETIQUETADA, não sobre a do período:
    // sobre o total do período as fatias passariam de 100%.
    const t1 = tx({ id: "t1", amount_cents: 100_00 });
    const etiquetas = [
      { id: "e1", user_id: "u1", name: "viagem", normalized_name: "viagem", color_key: "stone", created_at: "", updated_at: "" },
      { id: "e2", user_id: "u1", name: "reembolso", normalized_name: "reembolso", color_key: "stone", created_at: "", updated_at: "" },
    ];
    const linhas = despesasPorEtiqueta(
      [t1],
      etiquetas,
      [
        { transaction_id: "t1", tag_id: "e1" },
        { transaction_id: "t1", tag_id: "e2" },
      ],
      ["2026-07-01"],
      CONTAS,
    );
    expect(linhas).toHaveLength(2);
    expect(linhas[0]!.totalCents).toBe(10000);
    expect(linhas[0]!.share).toBeCloseTo(0.5);
  });

  it("topBeneficiarios junta grafias diferentes do mesmo lugar", () => {
    const linhas = topBeneficiarios(
      [
        tx({ payee: "Mercado X", amount_cents: 30_00 }),
        tx({ payee: " mercado x ", amount_cents: 20_00 }),
        tx({ payee: null, amount_cents: 999_00 }),
      ],
      ["2026-07-01"],
      CONTAS,
    );
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.nome).toBe("Mercado X");
    expect(linhas[0]!.totalCents).toBe(5000);
    expect(linhas[0]!.quantidade).toBe(2);
  });
});

describe("isTransfer", () => {
  it("detecta pelas duas formas", () => {
    expect(isTransfer(tx({ transfer_group_id: "g" }))).toBe(true);
    expect(isTransfer(tx({ kind: "transfer" }))).toBe(true);
    expect(isTransfer(tx({}))).toBe(false);
  });
});

describe("expensesByCategory", () => {
  const categories: FinanceCategory[] = [
    {
      id: "c1",
      user_id: "u1",
      name: "Mercado",
      normalized_name: "mercado",
      kind: "expense",
      parent_id: null,
      color_key: "stone",
      created_at: "",
      updated_at: "",
    },
  ];

  it("agrupa e calcula participação", () => {
    const rows = expensesByCategory(
      [
        tx({ category_id: "c1", amount_cents: 75_00 }),
        tx({ category_id: null, amount_cents: 25_00 }),
      ],
      categories,
      ["2026-07-01"],
      CONTAS,
    );
    expect(rows[0]!.name).toBe("Mercado");
    expect(rows[0]!.share).toBeCloseTo(0.75);
    expect(rows[1]!.name).toBe("Sem categoria");
  });
});

describe("variation", () => {
  it("calcula a variação relativa", () => {
    expect(variation(150, 100)).toBeCloseTo(0.5);
    expect(variation(50, 100)).toBeCloseTo(-0.5);
  });
  it("devolve null sem base de comparação (evita divisão por zero)", () => {
    expect(variation(100, 0)).toBeNull();
  });
});

describe("navegação de meses", () => {
  it("atravessa a virada de ano corretamente", () => {
    expect(previousMonthIso("2026-01-01")).toBe("2025-12-01");
    expect(nextMonthIso("2026-12-01")).toBe("2027-01-01");
  });
});

describe("budgetProgress", () => {
  const categories: FinanceCategory[] = [
    {
      id: "c1",
      user_id: "u1",
      name: "Mercado",
      normalized_name: "mercado",
      kind: "expense",
      parent_id: null,
      color_key: "stone",
      created_at: "",
      updated_at: "",
    },
  ];
  const budgets: FinanceBudget[] = [
    {
      id: "b1",
      user_id: "u1",
      category_id: "c1",
      month: "2026-07-01",
      limit_cents: 100_00,
      created_at: "",
      updated_at: "",
    },
  ];

  it("marca estouro de orçamento", () => {
    const [p] = budgetProgress(
      budgets,
      [tx({ category_id: "c1", amount_cents: 120_00 })],
      categories,
      "2026-07-01",
      CONTAS,
    );
    expect(p!.spentCents).toBe(12000);
    expect(p!.over).toBe(true);
    expect(p!.ratio).toBeCloseTo(1.2);
  });
});

describe("dinheiro em centavos (sem ponto flutuante)", () => {
  it("interpreta o formato pt-BR", () => {
    expect(parseBRLToCents("1.234,56")).toBe(123456);
    expect(parseBRLToCents("1234,56")).toBe(123456);
    expect(parseBRLToCents("1234.56")).toBe(123456);
    expect(parseBRLToCents("R$ 10,00")).toBe(1000);
    expect(parseBRLToCents("")).toBeNull();
  });

  it("soma em centavos evita o erro clássico 0.1+0.2", () => {
    const a = parseBRLToCents("0,10")!;
    const b = parseBRLToCents("0,20")!;
    expect(a + b).toBe(30);
    expect(formatBRL(a + b)).toContain("0,30");
  });

  it("mascara valores quando pedido", () => {
    expect(formatBRL(12345, { hidden: true })).toBe("R$ ••••");
  });
});
