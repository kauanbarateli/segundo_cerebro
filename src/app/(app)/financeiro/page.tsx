import { PageHeader } from "@/components/layout/PageHeader";
import { FinanceView } from "@/components/features/finance/FinanceView";
import { getFinanceAnalytics, getFinanceSnapshot } from "@/lib/data";
import { requireModule } from "@/lib/guards";
import { lerRecorte } from "@/lib/finance";
import { monthKey } from "@/lib/utils";

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; recorte?: string }>;
}) {
  const ctx = await requireModule("financeiro");
  const sp = await searchParams;

  // Aceita só o formato canônico YYYY-MM-01; qualquer outra coisa cai no mês atual.
  const month = /^\d{4}-\d{2}-01$/.test(sp.month ?? "") ? sp.month! : monthKey(new Date());
  /*
    O RECORTE VIAJA NA URL, e não é estado do componente.

    É o servidor que decide quais meses carregar: um alternador só no cliente
    trocaria o rótulo para "ano" sobre os três meses que o snapshot trouxe, e o
    gráfico mostraria um quarto do ano dizendo que é o ano. Com o recorte na URL,
    quem escolhe o período e quem busca o dado são a mesma decisão — e o endereço
    fica compartilhável.
  */
  const recorte = lerRecorte(sp.recorte);

  // `futureCardTransactions` é repassado junto com `transactions`: a tela do
  // cartão precisa das parcelas ainda por vencer para não oferecer limite que o
  // cartão já não dá. As duas listas são disjuntas (ver getFinanceSnapshot), e
  // continuam separadas até a FinanceView para que ninguém some "o mês" achando
  // que soma só o mês e leve junto três anos de parcelas futuras.
  //
  // A análise vem de OUTRA consulta, paginada e com poucas colunas: o histórico
  // de 12 meses e os recortes de trimestre/ano não cabem na janela do snapshot,
  // e alargá-la faria um `select("*")` de um ano atravessar a rede para produzir
  // doze somas. Ver `getFinanceAnalytics`.
  const [snapshot, analise] = await Promise.all([
    getFinanceSnapshot(month),
    getFinanceAnalytics(month, recorte),
  ]);

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
        recorte={recorte}
        analise={analise}
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
