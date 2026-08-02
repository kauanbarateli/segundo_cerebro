import { describe, expect, it } from "vitest";
import {
  monthTotals,
  expensesByCategory,
  variation,
  previousMonthIso,
  nextMonthIso,
  budgetProgress,
  isTransfer,
} from "./finance";
import type { FinanceTransaction, FinanceCategory, FinanceBudget } from "./database.types";
import { parseBRLToCents, formatBRL } from "./utils";

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
    );
    expect(t.expenseCents).toBe(2000);
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
      "2026-07-01",
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
