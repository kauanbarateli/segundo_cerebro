"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/states";
import { Icon } from "@/components/ui/Icons";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { BudgetForm } from "./FinanceForms";
import type {
  FinanceAccount,
  FinanceBudget,
  FinanceCategory,
  FinanceTransaction,
} from "@/lib/database.types";
import { monthLabel, cn } from "@/lib/utils";
import { budgetProgress } from "@/lib/finance";
import type { Dinheiro } from "./comum";
import { deleteBudget } from "@/app/(app)/financeiro/actions";

/* -------------------------------------------------------------- orçamentos */

export function Orcamentos({
  budgets,
  categories,
  accounts,
  transactions,
  month,
  money,
}: {
  budgets: FinanceBudget[];
  categories: FinanceCategory[];
  /** Necessário para a competência: em cartão o mês é o da fatura. */
  accounts: FinanceAccount[];
  transactions: FinanceTransaction[];
  month: string;
  money: Dinheiro;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [, start] = useTransition();
  const [open, setOpen] = useState(false);

  /*
    O orçamento passa a bater com o Painel: uma compra de cartão feita depois do
    fechamento consome o limite do mês da FATURA, não o do mês da compra. Antes
    disto, estourar o orçamento de março era possível gastando em fevereiro.
  */
  const progress = budgetProgress(budgets, transactions, categories, month, accounts);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h3 className="text-corpo-forte font-semibold text-ink">
          Orçamentos de {monthLabel(month)}
        </h3>
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          <Icon.Capture width={15} height={15} /> Definir
        </Button>
      </div>

      {progress.length === 0 ? (
        <EmptyState
          icon="Wallet"
          title="Nenhum orçamento definido"
          description="Defina um limite mensal por categoria."
        />
      ) : (
        <ul className="divide-y divide-line">
          {progress.map((p) => (
            <li key={p.budget.id} className="px-4 py-3.5">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                {/* `min-w-0` + `truncate`: sem os dois, "Alimentação fora de casa"
                    empurrava o par gasto/limite para fora do cartão no celular. */}
                <span className="min-w-0 truncate text-sm font-medium text-ink">{p.categoryName}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-legenda text-ink-muted">
                    {money(p.spentCents)} / {money(p.budget.limit_cents)}
                  </span>
                  <button
                    type="button"
                    aria-label="Remover orçamento"
                    onClick={() =>
                      start(async () => {
                        const r = await deleteBudget(p.budget.id);
                        if (r.ok) router.refresh();
                        else toast(r.error ?? "Erro", "error");
                      })
                    }
                    className="alvo-44 rounded-sm border border-line-strong p-1 text-ink-subtle hover:text-danger-ink"
                  >
                    <Icon.Trash width={12} height={12} />
                  </button>
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    p.over ? "bg-danger" : "bg-accent",
                  )}
                  style={{ width: `${Math.min(100, Math.max(2, p.ratio * 100))}%` }}
                />
              </div>
              {p.over && (
                <p className="mt-1 text-legenda text-danger-ink">
                  Estourou em {money(p.spentCents - p.budget.limit_cents)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <Modal title="Definir orçamento" onClose={() => setOpen(false)}>
          <BudgetForm
            categories={categories.filter((c) => c.kind === "expense")}
            month={month}
            onDone={() => {
              setOpen(false);
              router.refresh();
            }}
            onCancel={() => setOpen(false)}
          />
        </Modal>
      )}
    </Card>
  );
}
