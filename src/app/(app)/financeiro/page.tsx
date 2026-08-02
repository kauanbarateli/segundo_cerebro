import { PageHeader } from "@/components/layout/PageHeader";
import { FinanceView } from "@/components/features/finance/FinanceView";
import { getFinanceSnapshot } from "@/lib/data";
import { requireModule } from "@/lib/guards";
import { monthKey } from "@/lib/utils";

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const ctx = await requireModule("financeiro");
  const sp = await searchParams;

  // Aceita só o formato canônico YYYY-MM-01; qualquer outra coisa cai no mês atual.
  const month = /^\d{4}-\d{2}-01$/.test(sp.month ?? "") ? sp.month! : monthKey(new Date());
  // `futureCardTransactions` é repassado junto com `transactions`: a tela do
  // cartão precisa das parcelas ainda por vencer para não oferecer limite que o
  // cartão já não dá. As duas listas são disjuntas (ver getFinanceSnapshot), e
  // continuam separadas até a FinanceView para que ninguém some "o mês" achando
  // que soma só o mês e leve junto três anos de parcelas futuras.
  const snapshot = await getFinanceSnapshot(month);

  return (
    <>
      <PageHeader
        eyebrow="Saúde financeira"
        title="Para onde o dinheiro vai."
        subtitle="Contas, lançamentos e orçamentos em uma só visão."
        user={{ name: ctx.displayName, avatarUrl: ctx.avatarUrl }}
      />
      <FinanceView
        month={month}
        accounts={snapshot.accounts}
        balances={snapshot.balances}
        categories={snapshot.categories}
        tags={snapshot.tags}
        transactions={snapshot.transactions}
        futureCardTransactions={snapshot.futureCardTransactions}
        budgets={snapshot.budgets}
        transactionTags={snapshot.transactionTags}
        hideValues={ctx.preferences?.finance_hide_values ?? false}
      />
    </>
  );
}
