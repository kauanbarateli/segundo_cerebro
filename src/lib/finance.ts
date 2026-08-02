import type {
  FinanceTransaction,
  FinanceCategory,
  FinanceBudget,
} from "@/lib/database.types";

/**
 * Cálculos financeiros puros — sem I/O, testáveis.
 *
 * Regra central: transferências NÃO contam como receita nem despesa. Cada
 * transferência gera duas linhas (uma expense + uma income); somá-las contaria
 * o mesmo dinheiro duas vezes e distorceria todo o dashboard.
 */

export function isTransfer(tx: FinanceTransaction): boolean {
  return tx.transfer_group_id !== null || tx.kind === "transfer";
}

export function inMonth(tx: FinanceTransaction, monthIso: string): boolean {
  return tx.occurred_on.slice(0, 7) === monthIso.slice(0, 7);
}

export interface MonthTotals {
  incomeCents: number;
  expenseCents: number;
  balanceCents: number;
  transactionCount: number;
}

export function monthTotals(txs: FinanceTransaction[], monthIso: string): MonthTotals {
  let incomeCents = 0;
  let expenseCents = 0;
  let transactionCount = 0;

  for (const tx of txs) {
    if (!inMonth(tx, monthIso)) continue;
    if (isTransfer(tx)) continue;
    transactionCount++;
    if (tx.kind === "income") incomeCents += tx.amount_cents;
    else if (tx.kind === "expense") expenseCents += tx.amount_cents;
  }

  return {
    incomeCents,
    expenseCents,
    balanceCents: incomeCents - expenseCents,
    transactionCount,
  };
}

export interface CategoryTotal {
  categoryId: string | null;
  name: string;
  totalCents: number;
  share: number;
}

export function expensesByCategory(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  monthIso: string,
): CategoryTotal[] {
  const byId = new Map(categories.map((c) => [c.id, c.name]));
  const totals = new Map<string | null, number>();

  for (const tx of txs) {
    if (!inMonth(tx, monthIso)) continue;
    if (isTransfer(tx)) continue;
    if (tx.kind !== "expense") continue;
    const key = tx.category_id;
    totals.set(key, (totals.get(key) ?? 0) + tx.amount_cents);
  }

  const grand = [...totals.values()].reduce((a, b) => a + b, 0);

  return [...totals.entries()]
    .map(([categoryId, totalCents]) => ({
      categoryId,
      name: categoryId ? (byId.get(categoryId) ?? "Categoria removida") : "Sem categoria",
      totalCents,
      share: grand === 0 ? 0 : totalCents / grand,
    }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

/** Variação percentual entre dois meses. null quando não há base de comparação. */
export function variation(currentCents: number, previousCents: number): number | null {
  if (previousCents === 0) return null;
  return (currentCents - previousCents) / previousCents;
}

export function previousMonthIso(monthIso: string): string {
  const [y, m] = monthIso.split("-").map(Number);
  const d = new Date(Date.UTC(y!, (m ?? 1) - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function nextMonthIso(monthIso: string): string {
  const [y, m] = monthIso.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m ?? 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export interface BudgetProgress {
  budget: FinanceBudget;
  categoryName: string;
  spentCents: number;
  ratio: number;
  over: boolean;
}

export function budgetProgress(
  budgets: FinanceBudget[],
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  monthIso: string,
): BudgetProgress[] {
  const byId = new Map(categories.map((c) => [c.id, c.name]));

  return budgets.map((budget) => {
    const spentCents = txs
      .filter(
        (tx) =>
          inMonth(tx, monthIso) &&
          !isTransfer(tx) &&
          tx.kind === "expense" &&
          tx.category_id === budget.category_id,
      )
      .reduce((sum, tx) => sum + tx.amount_cents, 0);

    const ratio = budget.limit_cents === 0 ? 0 : spentCents / budget.limit_cents;
    return {
      budget,
      categoryName: byId.get(budget.category_id) ?? "—",
      spentCents,
      ratio,
      over: spentCents > budget.limit_cents,
    };
  });
}
