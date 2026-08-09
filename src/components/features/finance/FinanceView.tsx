"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, PillButton } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/states";
import { Icon } from "@/components/ui/Icons";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import {
  TransactionForm,
  AccountForm,
  CategoryForm,
  TagForm,
  BudgetForm,
  TransferForm,
  StatementPaymentForm,
} from "./FinanceForms";
import type {
  FinanceAccount,
  FinanceAccountBalance,
  FinanceCategory,
  FinanceTag,
  FinanceTransaction,
  FinanceBudget,
} from "@/lib/database.types";
import { formatBRL, monthLabel, plural, concorda, cn } from "@/lib/utils";
import {
  variation,
  previousMonthIso,
  nextMonthIso,
  budgetProgress,
  isTransfer,
  mesDeCompetencia,
  cartoesDe,
  rotuloDoPeriodo,
  RECORTES,
  ROTULO_DO_RECORTE,
  type Recorte,
} from "@/lib/finance";
import {
  ROTULO_DO_STATUS_DA_FATURA,
  ehPagamentoDeFatura,
  faturaDoCartao,
  faturasQueVencemEm,
  fechamentoDaFatura,
  somaMeses,
  statusDaFatura,
  totalAPagarEm,
  vencimentoDaFatura,
  patrimonioEDivida,
  type ResumoDeFatura,
  type StatusDaFatura,
} from "@/lib/credit";
import { corDaPosicao, tomDaCor } from "@/lib/finance-colors";
import { Rosca, limitarFatias, type FatiaDaRosca } from "./Rosca";
import type { FinanceAnalytics } from "@/lib/finance";
import { diaCivilDe } from "@/lib/tempo";
import type { PontoDeCategoria } from "@/components/ui/Badge";
import {
  archiveAccount,
  deleteTransaction,
  deleteCategory,
  deleteTag,
  deleteBudget,
} from "@/app/(app)/financeiro/actions";

/**
 * A cor do ponto de cada status de fatura. Ver o comentário no uso — ela
 * ACOMPANHA o rótulo de texto, nunca o substitui (DS §9).
 *
 * `undefined` em "fechada" é deliberado: é o estado normal de uma fatura
 * esperando o vencimento, e não pede atenção nenhuma. Cor tem significado; se
 * todo estado tem cor, nenhum tem.
 */
const PONTO_DO_STATUS_DA_FATURA: Record<StatusDaFatura, PontoDeCategoria | undefined> = {
  aberta: "info",
  fechada: undefined,
  parcial: "warning",
  paga: "success",
  vencida: "danger",
};

/** "2026-08-02" -> "02/08/2026". Sem `Date`: converter aqui deslocaria o dia por fuso. */
function dataBR(iso: string): string {
  return iso.split("-").reverse().join("/");
}

type Tab = "dashboard" | "transactions" | "accounts" | "categories" | "budgets";

const TABS: { key: Tab; label: string }[] = [
  { key: "dashboard", label: "Painel" },
  { key: "transactions", label: "Lançamentos" },
  { key: "accounts", label: "Contas" },
  { key: "categories", label: "Categorias e etiquetas" },
  { key: "budgets", label: "Orçamentos" },
];

export interface FinanceViewProps {
  month: string;
  /** Mês, trimestre ou ano. Vem da URL — ver `lerRecorte` e o comentário lá. */
  recorte: Recorte;
  /** As somas do Painel, já prontas do servidor. Ver `getFinanceAnalytics`. */
  analise: FinanceAnalytics;
  accounts: FinanceAccount[];
  balances: FinanceAccountBalance[];
  categories: FinanceCategory[];
  tags: FinanceTag[];
  transactions: FinanceTransaction[];
  /**
   * Lançamentos de cartão POSTERIORES à janela de `transactions` — as parcelas
   * ainda por vencer. Lista disjunta da de cima: `[...transactions,
   * ...futureCardTransactions]` vai direto para `faturaDoCartao()` sem contar
   * nada duas vezes. Só a aba Contas usa; o dashboard e a lista continuam
   * somando exclusivamente `transactions`, que é o mês.
   */
  futureCardTransactions: FinanceTransaction[];
  budgets: FinanceBudget[];
  transactionTags: { transaction_id: string; tag_id: string }[];
  hideValues: boolean;
}

export function FinanceView(props: FinanceViewProps) {
  const {
    month,
    recorte,
    accounts,
    balances,
    categories,
    tags,
    transactions,
    futureCardTransactions,
    budgets,
  } = props;
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [hidden, setHidden] = useState(props.hideValues);

  const money = (cents: number) => formatBRL(cents, { hidden });

  /*
    UM só ponto de navegação para os dois parâmetros. Trocar o mês precisa
    PRESERVAR o recorte (e vice-versa): dois `router.push` independentes
    apagariam um ao escrever o outro, e o alternador voltaria para "Mês" a cada
    clique na seta.
  */
  function irPara(iso: string, novoRecorte: Recorte) {
    router.push(`/financeiro?month=${iso}&recorte=${novoRecorte}`);
  }

  return (
    <div className="space-y-5">
      {/* Barra de período */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Mês anterior"
            onClick={() => irPara(previousMonthIso(month), recorte)}
          >
            ‹
          </Button>
          <span className="min-w-[9rem] text-center text-sm font-medium capitalize text-ink">
            {monthLabel(month)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Próximo mês"
            onClick={() => irPara(nextMonthIso(month), recorte)}
          >
            ›
          </Button>
        </div>

        <button
          type="button"
          onClick={() => setHidden((v) => !v)}
          className="alvo-44 inline-flex items-center gap-1.5 rounded-md border border-line-strong px-3 py-1.5 text-corpo text-ink-muted hover:text-ink"
          aria-pressed={hidden}
        >
          {hidden ? <Icon.Eye width={14} height={14} /> : <Icon.EyeOff width={14} height={14} />}
          {hidden ? "Mostrar valores" : "Ocultar valores"}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <PillButton key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
            {t.label}
          </PillButton>
        ))}
      </div>

      {tab === "dashboard" && (
        <Dashboard
          {...props}
          money={money}
          hidden={hidden}
          onRecorte={(r) => irPara(month, r)}
        />
      )}
      {tab === "transactions" && <Transactions {...props} money={money} />}
      {tab === "accounts" && (
        <Accounts
          month={month}
          accounts={accounts}
          balances={balances}
          transactions={transactions}
          futureCardTransactions={futureCardTransactions}
          money={money}
        />
      )}
      {tab === "categories" && <CategoriesAndTags categories={categories} tags={tags} />}
      {tab === "budgets" && (
        <Budgets
          budgets={budgets}
          categories={categories}
          accounts={accounts}
          transactions={transactions}
          month={month}
          money={money}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- dashboard */

/** "2026-08-01" -> "ago". Componentes numéricos, nunca `new Date(iso)`. */
const MES_CURTO = new Intl.DateTimeFormat("pt-BR", { month: "short" });
function mesCurto(mesIso: string): string {
  const [ano, mes] = mesIso.split("-").map(Number);
  return MES_CURTO.format(new Date(ano!, (mes ?? 1) - 1, 1)).replace(".", "");
}

/** "2026-08-07" -> "07/08". */
function diaMes(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function Dashboard({
  month,
  recorte,
  analise,
  transactions,
  futureCardTransactions,
  balances,
  accounts,
  money,
  hidden,
  onRecorte,
}: FinanceViewProps & {
  money: (c: number) => string;
  hidden: boolean;
  onRecorte: (r: Recorte) => void;
}) {
  const { atual, anterior, meses, porCategoria, porEtiqueta, beneficiarios, semanas, historico, orfaos } =
    analise;

  /*
    Patrimônio e dívida, NUNCA um "saldo total" somando os dois.

    O que existia aqui era `balances.reduce((s, b) => s + b.balance_cents, 0)`.
    Com cartão isso conta a mesma despesa duas vezes: uma na compra (que derruba
    o saldo do cartão) e outra no pagamento da fatura (que derruba a conta
    corrente). E o número resultante não significa nada — é dinheiro somado com
    dívida.

    `accounts` vem sem as arquivadas (getFinanceSnapshot filtra archived_at), e é
    ela que define o universo: saldo de conta fora da lista é ignorado.
  */
  const { patrimonioCents, dividaCents } = patrimonioEDivida(balances, accounts);
  // O terceiro número existe, mas SEMPRE depois dos dois primeiros e com o sinal
  // na cara: sozinho ele esconde o endividamento, que é o que precisa aparecer.
  const liquidoCents = patrimonioCents - dividaCents;

  const todasTx = useMemo(
    () => [...transactions, ...futureCardTransactions],
    [transactions, futureCardTransactions],
  );

  /*
    ⚠️ "A PAGAR" É SEMPRE SOBRE O MÊS, mesmo quando o recorte é trimestre ou ano.

    Não é descuido: a pergunta que este cartão responde é de FLUXO DE CAIXA —
    "quanto sai do meu bolso agora" —, e ela só faz sentido num horizonte curto.
    Somar o "a pagar" de um ano inteiro produziria um número grande que ninguém
    usa para decidir nada, ao lado de uma dívida total que já responde isso
    melhor. O rótulo diz o mês, para a diferença ficar visível.
  */
  const aVencer = useMemo(
    () => faturasQueVencemEm(todasTx, accounts.filter((a) => a.kind === "credit_card"), month),
    [todasTx, accounts, month],
  );
  const aPagarCents = totalAPagarEm(aVencer);

  /*
    Até quando a dívida se estende. `dividaCents` inclui parcela que vence daqui
    a dez meses — é o número certo para "quanto devo", e um número assustador sem
    o horizonte ao lado. O maior `statement_month` das linhas de cartão é
    exatamente esse horizonte.
  */
  const horizonte = useMemo(() => {
    const cartoes = cartoesDe(accounts);
    let maior: string | null = null;
    for (const tx of todasTx) {
      if (!cartoes.has(tx.account_id)) continue;
      if (ehPagamentoDeFatura(tx)) continue;
      const mes = mesDeCompetencia(tx, cartoes);
      if (mes !== null && (maior === null || mes > maior)) maior = mes;
    }
    return maior;
  }, [todasTx, accounts]);

  const incomeVar = variation(atual.incomeCents, anterior.incomeCents);
  const expenseVar = variation(atual.expenseCents, anterior.expenseCents);

  // Com valores ocultos o sinal também some: saber que o líquido está negativo
  // já é informação sobre o dinheiro, e é justamente o que "ocultar" promete não
  // mostrar por cima do ombro de ninguém.
  const liquidoLabel = hidden
    ? money(liquidoCents)
    : `${liquidoCents >= 0 ? "+" : "−"}${formatBRL(Math.abs(liquidoCents))}`;

  const periodo = rotuloDoPeriodo(meses, recorte);
  const rotuloDoPeriodoNaTela = recorte === "mes" ? monthLabel(month) : periodo;

  const fatias: FatiaDaRosca[] = limitarFatias(
    porCategoria.map((c) => ({
      id: c.categoryId ?? "sem-categoria",
      rotulo: c.name,
      valorCents: c.totalCents,
      share: c.share,
      colorKey: c.colorKey,
    })),
    7,
  );

  return (
    <div className="space-y-5">
      {/*
        O alternador de recorte. `PillButton` é o mesmo controle das abas, e não
        um seletor novo: a barra já ensina que pílula preta é "o que está ativo".
      */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-legenda capitalize text-ink-subtle">{rotuloDoPeriodoNaTela}</p>
        <div className="flex gap-1.5" role="group" aria-label="Recorte de tempo">
          {RECORTES.map((r) => (
            <PillButton key={r} active={recorte === r} onClick={() => onRecorte(r)}>
              {ROTULO_DO_RECORTE[r]}
            </PillButton>
          ))}
        </div>
      </div>

      {/*
        ⚠️ "A PAGAR" NUNCA APARECE SEM "DÍVIDA TOTAL" AO LADO.

        É o mesmo raciocínio que já governa o cartão "Líquido" aqui embaixo:
        sozinho, o número curto é otimista. "R$ 1.200 este mês" soa administrável
        mesmo quando existem R$ 14.000 de parcelas atrás dele. Os dois juntos
        respondem as duas perguntas que de fato se fazem — "o que vence agora?" e
        "quanto eu devo ao todo?" — e nenhuma das duas responde a outra.
      */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Patrimônio"
          value={money(patrimonioCents)}
          hint="Contas, poupança, dinheiro e investimentos."
        />
        <StatCard
          label={`A pagar em ${monthLabel(month).replace(/ de \d{4}$/, "")}`}
          value={money(aPagarCents)}
          tone={aPagarCents > 0 ? "negative" : undefined}
          hint={
            aVencer.length === 0
              ? "Nenhuma fatura vence neste mês."
              : `${plural(aVencer.length, "fatura", "faturas")} · vence ${aVencer.map((f) => dataBR(f.vence)).join(", ")}`
          }
        />
        <StatCard
          label="Dívida total"
          value={money(dividaCents)}
          tone={dividaCents > 0 ? "negative" : undefined}
          hint={
            horizonte
              ? `Tudo o que se deve em cartão, incluindo parcelas até ${monthLabel(horizonte)}.`
              : "Tudo o que se deve em cartão, incluindo parcelas ainda por vencer."
          }
        />
        <StatCard
          label="Líquido"
          value={liquidoLabel}
          tone={liquidoCents >= 0 ? "positive" : "negative"}
          hint="Patrimônio menos dívida total."
          destaque
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Receitas"
          value={money(atual.incomeCents)}
          delta={incomeVar}
          positiveIsGood
        />
        <StatCard
          label="Despesas"
          value={money(atual.expenseCents)}
          delta={expenseVar}
          positiveIsGood={false}
        />
        <StatCard
          label="Resultado"
          value={money(atual.balanceCents)}
          tone={atual.balanceCents >= 0 ? "positive" : "negative"}
        />
      </div>

      {/*
        ⚠️ O AVISO QUE IMPEDE OS NÚMEROS DE DISCORDAREM EM SILÊNCIO.

        Lançamento de cartão sem `statement_month` pesa em `debt_cents` (a view
        só olha `is_paid`) e não pertence a fatura nenhuma — logo, não entra em
        mês nenhum das somas acima. Sem esta linha, "Despesas" viria menor que a
        realidade e a única pista seria a dívida não bater. Contá-los é a
        explicação.
      */}
      {orfaos.quantidade > 0 && (
        <Card className="border-warning/40 p-4">
          <p className="flex items-start gap-2 text-corpo text-warning-ink">
            <Icon.Alert width={15} height={15} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              {plural(orfaos.quantidade, "lançamento", "lançamentos")} de cartão sem fatura
              atribuída ({money(orfaos.totalCents)}).{" "}
              {concorda(orfaos.quantidade, "Ele conta", "Eles contam")} na dívida e{" "}
              {concorda(orfaos.quantidade, "não entra", "não entram")} em nenhum mês acima —
              cadastre o dia de fechamento do cartão em Contas para resolver.
            </span>
          </p>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="p-6">
          <h3 className="text-corpo-forte font-semibold text-ink">Despesas por categoria</h3>
          <p className="mt-0.5 mb-4 text-legenda capitalize text-ink-subtle">
            {rotuloDoPeriodoNaTela} · {plural(atual.transactionCount, "lançamento", "lançamentos")}
          </p>

          {fatias.length === 0 ? (
            <EmptyState icon="Wallet" title="Sem despesas neste período" />
          ) : (
            <Rosca
              fatias={fatias}
              valorCentral={money(atual.expenseCents)}
              rotuloCentral="Despesas"
              descricao={`Despesas por categoria: ${fatias
                .map((f) => `${f.rotulo} ${(f.share * 100).toFixed(0)}%`)
                .join(", ")}`}
              money={money}
            />
          )}
        </Card>

        <HistoricoCard historico={historico} money={money} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {recorte === "mes" ? (
          <SemanasCard semanas={semanas} money={money} />
        ) : (
          /*
            Semana não é recorte de trimestre nem de ano: seriam 13 ou 52 barras
            de 3px, ilegíveis e sem nenhuma pergunta por trás. O histórico ao lado
            já responde "como isso variou no tempo" nessa escala.
          */
          <Card className="p-6">
            <h3 className="text-corpo-forte font-semibold text-ink">Comparação</h3>
            <p className="mt-0.5 mb-4 text-legenda text-ink-subtle">
              {periodo} vs. período anterior
            </p>
            <CompareRow
              label="Receitas"
              current={atual.incomeCents}
              previous={anterior.incomeCents}
              money={money}
            />
            <CompareRow
              label="Despesas"
              current={atual.expenseCents}
              previous={anterior.expenseCents}
              money={money}
            />
            <CompareRow
              label="Resultado"
              current={atual.balanceCents}
              previous={anterior.balanceCents}
              money={money}
            />
          </Card>
        )}

        <Card className="p-6">
          <h3 className="text-corpo-forte font-semibold text-ink">Etiquetas e estabelecimentos</h3>
          <p className="mt-0.5 mb-4 text-legenda text-ink-subtle">
            Os cortes que a categoria não dá.
          </p>

          <div className="space-y-5">
            <div>
              <p className="mb-2 text-corpo font-medium text-ink">Etiquetas</p>
              {porEtiqueta.length === 0 ? (
                <p className="text-legenda text-ink-subtle">
                  Nenhum lançamento etiquetado neste período.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {porEtiqueta.slice(0, 5).map((t, i) => (
                    <li key={t.tagId} className="flex items-center gap-2 text-corpo">
                      <span
                        aria-hidden
                        className={cn(
                          "h-2.5 w-2.5 shrink-0 rounded-full",
                          corDaPosicao(t.colorKey, i).fundo,
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-ink">#{t.name}</span>
                      <span className="shrink-0 tabular-nums text-ink-muted">
                        {money(t.totalCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {porEtiqueta.length > 0 && (
                /*
                  A ressalva que evita a pergunta "por que isto não fecha com as
                  despesas?": um lançamento pode ter várias etiquetas ou nenhuma.
                */
                <p className="mt-1.5 text-legenda text-ink-subtle">
                  Um lançamento pode ter mais de uma etiqueta — a soma daqui não fecha com o total
                  de despesas.
                </p>
              )}
            </div>

            <div>
              <p className="mb-2 text-corpo font-medium text-ink">Estabelecimentos</p>
              {beneficiarios.length === 0 ? (
                <p className="text-legenda text-ink-subtle">
                  Nenhum lançamento com beneficiário preenchido.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {beneficiarios.map((b) => (
                    <li key={b.nome} className="flex items-center gap-2 text-corpo">
                      <span className="min-w-0 flex-1 truncate text-ink">{b.nome}</span>
                      <span className="shrink-0 text-legenda text-ink-subtle">
                        {plural(b.quantidade, "vez", "vezes")}
                      </span>
                      <span className="shrink-0 tabular-nums text-ink-muted">
                        {money(b.totalCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/**
 * Doze meses de receita × despesa, com a linha do líquido por cima.
 *
 * ============================================================================
 * A LINHA É SVG SOBRE BARRAS DE `div` — e por que os dois sistemas coexistem
 * ============================================================================
 * Barra é retângulo: `div` com altura percentual resolve, e é o que o resto do
 * projeto já faz. Linha não é: ela precisa ligar pontos, e ligar pontos com
 * `div` exigiria calcular ângulo e comprimento de cada segmento em JavaScript.
 *
 * O `viewBox="0 0 100 100"` com `preserveAspectRatio="none"` faz o SVG esticar
 * exatamente sobre a área das barras, então os dois sistemas de coordenadas
 * coincidem sem nenhuma medição no cliente — nada de `getBoundingClientRect`,
 * nada de `useEffect` para reposicionar no redimensionamento.
 *
 * ============================================================================
 * O GRÁFICO É `aria-hidden`; O DADO ESTÁ NA LISTA
 * ============================================================================
 * Cada mês tem um `sr-only` com entrada, saída e resultado em texto. Um `<svg>`
 * com `aria-label` resumido diria "doze meses de receita e despesa" e esconderia
 * os doze valores — que é justamente o conteúdo.
 */
function HistoricoCard({
  historico,
  money,
}: {
  historico: { mes: string; incomeCents: number; expenseCents: number; balanceCents: number }[];
  money: (c: number) => string;
}) {
  const teto = Math.max(
    1,
    ...historico.map((m) => Math.max(m.incomeCents, m.expenseCents)),
  );
  const saldos = historico.map((m) => m.balanceCents);
  const maiorSaldo = Math.max(1, ...saldos);
  const menorSaldo = Math.min(0, ...saldos);
  const amplitude = Math.max(1, maiorSaldo - menorSaldo);

  const pontos = historico
    .map((m, i) => {
      const x = ((i + 0.5) / historico.length) * 100;
      const y = 100 - ((m.balanceCents - menorSaldo) / amplitude) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const vazio = historico.every((m) => m.incomeCents === 0 && m.expenseCents === 0);

  return (
    <Card className="p-6">
      <h3 className="text-corpo-forte font-semibold text-ink">Últimos 12 meses</h3>
      <p className="mt-0.5 mb-4 text-legenda text-ink-subtle">
        Entradas × saídas, com a linha do resultado.
      </p>

      {vazio ? (
        <EmptyState icon="Wallet" title="Sem histórico ainda" />
      ) : (
        <>
          <div className="relative h-40">
            <ul className="flex h-full items-end gap-1" aria-hidden>
              {historico.map((m) => (
                <li key={m.mes} className="flex h-full flex-1 items-end justify-center gap-0.5">
                  <span
                    className="w-1/2 rounded-t-xs bg-success"
                    style={{ height: `${(m.incomeCents / teto) * 100}%` }}
                  />
                  <span
                    className="w-1/2 rounded-t-xs bg-danger"
                    style={{ height: `${(m.expenseCents / teto) * 100}%` }}
                  />
                </li>
              ))}
            </ul>
            <svg
              aria-hidden
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 h-full w-full"
            >
              <polyline
                points={pontos}
                fill="none"
                className="stroke-ink"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <ul className="mt-1.5 flex gap-1">
            {historico.map((m) => (
              <li key={m.mes} className="flex-1 text-center text-micro text-ink-subtle">
                {mesCurto(m.mes)}
                <span className="sr-only">
                  {" "}
                  de {m.mes.slice(0, 4)}: entrou {money(m.incomeCents)}, saiu{" "}
                  {money(m.expenseCents)}, resultado {money(m.balanceCents)}.
                </span>
              </li>
            ))}
          </ul>

          {/* Legenda das duas cores. Elas são `success`/`danger`, que já
              significam "sobrou"/"faltou" no sistema inteiro — mas cor não anda
              sozinha, então os nomes vêm junto. */}
          <div className="mt-3 flex flex-wrap gap-4 text-legenda text-ink-muted">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-full bg-success" /> Entradas
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-2 w-2 rounded-full bg-danger" /> Saídas
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 rounded-full bg-ink" /> Resultado
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

/** As faixas de sete dias do mês. Ver `porSemana` — a âncora é o dado, não o dia 1. */
function SemanasCard({
  semanas,
  money,
}: {
  semanas: { inicio: string; fim: string; incomeCents: number; expenseCents: number }[];
  money: (c: number) => string;
}) {
  const teto = Math.max(1, ...semanas.map((s) => s.expenseCents));

  return (
    <Card className="p-6">
      <h3 className="text-corpo-forte font-semibold text-ink">Semana a semana</h3>
      <p className="mt-0.5 mb-4 text-legenda text-ink-subtle">
        Despesas por data da compra, em faixas de sete dias.
      </p>

      {semanas.length === 0 ? (
        <EmptyState icon="Wallet" title="Sem lançamentos neste mês" />
      ) : (
        <ul className="space-y-2.5">
          {semanas.map((s) => (
            <li key={s.inicio}>
              <div className="mb-1 flex items-center justify-between text-corpo">
                <span className="tabular-nums text-ink">
                  {diaMes(s.inicio)} – {diaMes(s.fim)}
                </span>
                <span className="tabular-nums text-ink-muted">{money(s.expenseCents)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{
                    width: `${s.expenseCents === 0 ? 0 : Math.max(2, (s.expenseCents / teto) * 100)}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function StatCard({
  label,
  value,
  delta,
  positiveIsGood = true,
  tone,
  hint,
  destaque = false,
}: {
  label: string;
  value: string;
  delta?: number | null;
  positiveIsGood?: boolean;
  tone?: "positive" | "negative";
  /** Uma linha dizendo o que o número inclui. Sem ela "Dívidas" é ambíguo. */
  hint?: string;
  /**
   * Sobe o cartão para o nível 3 de elevação (ver ui/Card.tsx).
   *
   * Seis cartões iguais lado a lado não são uma hierarquia, são uma planilha: o
   * olho varre da esquerda para a direita sem saber onde parar. "Líquido" é a
   * RESPOSTA (patrimônio menos dívidas); os dois ao lado são as parcelas da
   * conta. Dar a ele borda mais forte e sombra elevada devolve a ordem de
   * leitura sem trocar uma cor, um tamanho ou uma medida.
   *
   * Um por linha, no máximo. Se dois cartões forem destaque, nenhum é.
   */
  destaque?: boolean;
}) {
  const good = delta == null ? null : positiveIsGood ? delta >= 0 : delta < 0;
  return (
    <Card className="p-5" elevacao={destaque ? "destaque" : "cartao"}>
      <p className="text-legenda text-ink-subtle">{label}</p>
      {/*
        AS DUAS SEMÂNTICAS, COM O SINAL SEMPRE JUNTO.

        `success` e `danger` entram aqui porque este é o caso em que a cor
        carrega informação de verdade (a fatia de 10% da regra do DS §3): num
        painel financeiro, "sobrou" e "faltou" é a pergunta.

        Mas a cor NUNCA vem sozinha — DS §9, e é o eixo vermelho/verde que a
        discromatopsia mais comum não separa. Quem passa `tone` também passa um
        valor que já traz o sinal na frente: veja `liquidoLabel` no Dashboard,
        que monta "+R$ 1.234,00" ou "−R$ 1.234,00" antes de chegar aqui. Sem o
        sinal no texto, esta cor precisa sair.
      */}
      <p
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          tone === "negative"
            ? "text-danger-ink"
            : tone === "positive"
              ? "text-success-ink"
              : "text-ink",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-legenda text-ink-subtle">{hint}</p>}
      {delta != null && (
        <p
          /* O triângulo é o sinal não-cromático desta linha: ele diz a direção
             antes de qualquer cor, e continua dizendo em escala de cinza. */
          className={cn(
            "mt-1 text-legenda",
            good ? "text-success-ink" : "text-danger-ink",
          )}
        >
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta * 100).toFixed(1)}% vs. mês anterior
        </p>
      )}
    </Card>
  );
}

function CompareRow({
  label,
  current,
  previous,
  money,
}: {
  label: string;
  current: number;
  previous: number;
  money: (c: number) => string;
}) {
  const max = Math.max(Math.abs(current), Math.abs(previous), 1);
  return (
    <div className="mb-4 last:mb-0">
      <p className="mb-1.5 text-corpo font-medium text-ink">{label}</p>
      <div className="space-y-1.5">
        <Bar value={Math.abs(current)} max={max} caption={money(current)} strong />
        <Bar value={Math.abs(previous)} max={max} caption={money(previous)} />
      </div>
    </div>
  );
}

function Bar({
  value,
  max,
  caption,
  strong,
}: {
  value: number;
  max: number;
  caption: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
        <div
          className={cn("h-full rounded-full", strong ? "bg-accent" : "bg-line-strong")}
          style={{ width: `${Math.max(2, (value / max) * 100)}%` }}
        />
      </div>
      <span className="w-24 text-right text-legenda text-ink-muted">{caption}</span>
    </div>
  );
}

/* ------------------------------------------------------------- lançamentos */

/**
 * Descrição sem o sufixo "(3/12)" que a server action acrescenta a cada parcela.
 *
 * O sufixo existe no BANCO de propósito: quem abre o extrato do cartão, exporta
 * o CSV ou olha a linha fora desta tela precisa saber que aquilo é uma parcela.
 * Aqui na lista ele vira ruído, porque a etiqueta "3 de 12" já diz isso — e
 * "Geladeira (3/12) [3 de 12]" é o tipo de repetição que faz a interface parecer
 * descuidada.
 *
 * O corte é EXATO e casado com as colunas: só remove quando os números do sufixo
 * são os mesmos de `installment_no`/`installment_total`. Assim uma descrição que
 * termine em "(3/12)" escrita pelo usuário numa compra à vista fica intacta —
 * um regex genérico comeria texto legítimo.
 */
function descricaoSemParcela(tx: FinanceTransaction): string {
  if (tx.installment_no == null || tx.installment_total == null) return tx.description;
  const sufixo = ` (${tx.installment_no}/${tx.installment_total})`;
  return tx.description.endsWith(sufixo)
    ? tx.description.slice(0, -sufixo.length)
    : tx.description;
}

function Transactions({
  month,
  transactions,
  accounts,
  categories,
  tags,
  transactionTags,
  money,
}: FinanceViewProps & { money: (c: number) => string }) {
  const { toast } = useToast();
  const router = useRouter();
  const [, start] = useTransition();
  const [formOpen, setFormOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [editing, setEditing] = useState<FinanceTransaction | null>(null);
  const [target, setTarget] = useState<FinanceTransaction | null>(null);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);
  const tagsOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of transactionTags) {
      const list = map.get(link.transaction_id) ?? [];
      list.push(link.tag_id);
      map.set(link.transaction_id, list);
    }
    return map;
  }, [transactionTags]);

  /*
    ⚠️ A LISTA SEGUE A MESMA COMPETÊNCIA DO PAINEL, e não `occurred_on`.

    A alternativa — listar por data da compra — parece mais natural e produz o
    pior defeito possível numa tela de dinheiro: o Painel diria "Despesas de
    abril: R$ 2.300" e esta lista, no mesmo mês, mostraria outro conjunto de
    linhas somando outra coisa. Aí o usuário confere na mão para descobrir qual
    dos dois está certo, e a resposta é "os dois, para perguntas diferentes" —
    que é a pior resposta que uma interface pode dar.

    O preço é que uma compra de 25/03 aparece na lista de ABRIL. Por isso a linha
    mostra a data real e, quando ela cai em outro mês, um selo dizendo de qual
    fatura aquilo é. A surpresa fica explicada onde ela acontece.
  */
  const cartoes = useMemo(() => cartoesDe(accounts), [accounts]);
  const alvo = `${month.slice(0, 7)}-01`;
  const monthTx = transactions.filter((t) => mesDeCompetencia(t, cartoes) === alvo);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h3 className="text-corpo-forte font-semibold text-ink">Lançamentos de {monthLabel(month)}</h3>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setTransferOpen(true)}>
            Transferência
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Icon.Capture width={15} height={15} /> Novo lançamento
          </Button>
        </div>
      </div>

      {monthTx.length === 0 ? (
        <EmptyState
          icon="Wallet"
          title="Nenhum lançamento neste mês"
          description="Registre uma receita ou despesa para começar."
        />
      ) : (
        <ul className="divide-y divide-line">
          {monthTx.map((tx) => {
            const transfer = isTransfer(tx);
            return (
              /*
                Duas linhas no celular, uma no desktop.

                A conta na tela de 375px não fechava: a `<main>` tem px-5 e o
                item px-4, sobram 303px. O ícone (32) + o valor (~95, com o
                sinal e `tabular-nums`) + "Editar" e a lixeira (~79) + três
                `gap-3` comem 242 — a descrição ficava com 61px, ou seja,
                truncava em cinco caracteres. Todo lançamento virava "Merca…".

                Valor e ações passam a viajar juntos num contêiner `w-full`,
                que não cabe ao lado do texto e por isso cai para a segunda
                linha; a partir de `sm` ele volta a ser `w-auto` e o `li` volta
                a `flex-nowrap` — o desktop fica idêntico ao que era.
              */
              <li
                key={tx.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap"
              >
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-corpo",
                    transfer
                      ? "border-line text-ink-subtle"
                      : tx.kind === "income"
                        ? "border-line-strong text-ink"
                        : "border-line text-ink-muted",
                  )}
                  aria-hidden
                >
                  {transfer ? "⇄" : tx.kind === "income" ? "+" : "−"}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {descricaoSemParcela(tx)}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-legenda text-ink-subtle">
                    <span>{dataBR(tx.occurred_on)}</span>
                    <span>·</span>
                    <span>{accountById.get(tx.account_id) ?? "—"}</span>
                    {/*
                      O selo só aparece quando a data da compra cai em OUTRO mês
                      que não o da lista — ou seja, exatamente quando a presença
                      da linha aqui surpreenderia. Repeti-lo em toda linha de
                      cartão seria ruído: na maioria delas os dois meses batem.
                    */}
                    {tx.occurred_on.slice(0, 7) !== month.slice(0, 7) && (
                      <Badge tone="outline">Fatura de {monthLabel(month)}</Badge>
                    )}
                    {tx.installment_no != null && tx.installment_total != null && (
                      <Badge tone="outline">
                        {tx.installment_no} de {tx.installment_total}
                      </Badge>
                    )}
                    {tx.category_id && <Badge tone="outline">{categoryById.get(tx.category_id)}</Badge>}
                    {transfer && <Badge>Transferência</Badge>}
                    {!tx.is_paid && <Badge>Pendente</Badge>}
                    {(tagsOf.get(tx.id) ?? []).map((id) => (
                      <Badge key={id} tone="outline">
                        #{tagById.get(id)?.name ?? "?"}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
                  <span
                    className={cn(
                      "shrink-0 text-sm font-semibold tabular-nums",
                      /* Entrada em `success`, saída em `danger` — e os dois
                         com reforço: o disco à esquerda da linha traz "+", "−"
                         ou "⇄", e a saída ainda ganha o "−" colado ao valor,
                         logo abaixo. Três sinais, um deles cromático. */
                      transfer
                        ? "text-ink-muted"
                        : tx.kind === "income"
                          ? "text-success-ink"
                          : "text-danger-ink",
                    )}
                  >
                    {tx.kind === "expense" && !transfer ? "−" : ""}
                    {money(tx.amount_cents)}
                  </span>

                  <div className="flex shrink-0 gap-3">
                    {!transfer && (
                      <button
                        type="button"
                        aria-label="Editar lançamento"
                        onClick={() => {
                          setEditing(tx);
                          setFormOpen(true);
                        }}
                        className="alvo-44 rounded-sm border border-line-strong px-2 py-1 text-meta text-ink-muted hover:text-ink"
                      >
                        Editar
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="Excluir lançamento"
                      onClick={() => setTarget(tx)}
                      className="alvo-44 rounded-sm border border-line-strong p-1.5 text-ink-subtle hover:text-danger-ink"
                    >
                      <Icon.Trash width={13} height={13} />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {formOpen && (
        <Modal
          title={editing ? "Editar lançamento" : "Novo lançamento"}
          onClose={() => setFormOpen(false)}
        >
          <TransactionForm
            accounts={accounts}
            categories={categories}
            tags={tags}
            transaction={editing}
            initialTagIds={editing ? (tagsOf.get(editing.id) ?? []) : []}
            onDone={() => {
              setFormOpen(false);
              router.refresh();
            }}
            onCancel={() => setFormOpen(false)}
          />
        </Modal>
      )}

      {transferOpen && (
        <Modal title="Nova transferência" onClose={() => setTransferOpen(false)}>
          <TransferForm
            accounts={accounts}
            onDone={() => {
              setTransferOpen(false);
              router.refresh();
            }}
            onCancel={() => setTransferOpen(false)}
          />
        </Modal>
      )}

      <ConfirmationDialog
        open={target !== null}
        title="Excluir lançamento"
        /*
          O texto precisa dizer o que a action realmente faz. `deleteTransaction`
          apaga o GRUPO inteiro — as duas pernas de uma transferência, as N
          parcelas de uma compra parcelada — e "esta ação não pode ser desfeita"
          esconderia que onze outras linhas vão junto. Uma confirmação que
          descreve errado o efeito é pior que nenhuma.
        */
        description={
          target && isTransfer(target)
            ? "As duas pernas da transferência serão removidas."
            : target?.installment_total != null && target.installment_total > 1
              ? `Esta compra tem ${target.installment_total} parcelas e TODAS serão excluídas, inclusive as que ainda vão vencer. Esta ação não pode ser desfeita.`
              : "Esta ação não pode ser desfeita."
        }
        confirmLabel="Excluir"
        destructive
        onCancel={() => setTarget(null)}
        onConfirm={() => {
          const t = target;
          setTarget(null);
          if (!t) return;
          start(async () => {
            const r = await deleteTransaction(t.id);
            if (r.ok) {
              toast("Lançamento excluído", "success");
              router.refresh();
            } else toast(r.error ?? "Erro", "error");
          });
        }}
      />
    </Card>
  );
}

/* ------------------------------------------------------------------ contas */

const KIND_LABEL: Record<string, string> = {
  checking: "Conta corrente",
  savings: "Poupança",
  credit_card: "Cartão de crédito",
  cash: "Dinheiro",
  investment: "Investimento",
  other: "Outro",
};

/**
 * Faixas de uso do limite. 70% e 90% são os cortes pedidos; o que importa aqui é
 * que a faixa NUNCA aparece só como cor.
 *
 * Cor sozinha não é informação acessível: entre 5% e 10% dos homens têm alguma
 * discromatopsia, e verde-âmbar-vermelho é justamente o eixo que eles não
 * separam. Cada faixa carrega um rótulo em texto (`aria-valuetext` e um
 * parágrafo visível), e a cor fica sendo o reforço, não o dado.
 */
type FaixaDeUso = "normal" | "atencao" | "critico";

/**
 * Dia de fechamento/vencimento utilizável.
 *
 * `faturaDe`, `fechamentoDaFatura` e `vencimentoDaFatura` LANÇAM RangeError fora
 * de 1-31 — o que é certo numa função pura, e fatal num componente cliente: a
 * exceção derruba a aba Contas inteira, não só o cartão com o dado ruim.
 *
 * A 0010 deixa `finance_accounts_credit_card_fields_check` como NOT VALID quando
 * encontra cartões legados incompletos, então existe uma janela real em que a
 * linha vem com o dia nulo. Esta guarda transforma essa janela em "cartão sem
 * fechamento cadastrado", que a tela já sabe mostrar, com o convite a editar.
 */
function diaUtilizavel(dia: number | null): dia is number {
  return dia !== null && Number.isInteger(dia) && dia >= 1 && dia <= 31;
}

function faixaDeUso(percentual: number): FaixaDeUso {
  if (percentual >= 90) return "critico";
  if (percentual >= 70) return "atencao";
  return "normal";
}

const BARRA_POR_FAIXA: Record<FaixaDeUso, string> = {
  normal: "bg-accent",
  atencao: "bg-warning",
  critico: "bg-danger",
};

const TEXTO_POR_FAIXA: Record<FaixaDeUso, string> = {
  normal: "text-ink-muted",
  atencao: "text-warning-ink",
  critico: "text-danger-ink",
};

function Accounts({
  month,
  accounts,
  balances,
  transactions,
  futureCardTransactions,
  money,
}: {
  month: string;
  accounts: FinanceAccount[];
  balances: FinanceAccountBalance[];
  transactions: FinanceTransaction[];
  futureCardTransactions: FinanceTransaction[];
  money: (c: number) => string;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [, start] = useTransition();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FinanceAccount | null>(null);
  const [target, setTarget] = useState<FinanceAccount | null>(null);
  const [paying, setPaying] = useState<FinanceAccount | null>(null);

  const balanceById = useMemo(
    () => new Map(balances.map((b) => [b.account_id, b])),
    [balances],
  );

  /*
    As duas listas juntas — e só aqui. `transactions` cobre o mês exibido e o
    anterior; `futureCardTransactions` cobre tudo que vem depois e é de cartão.
    Elas são disjuntas por construção, então concatenar não conta nada duas vezes.

    Sem a segunda, a fatura de um mês FUTURO (as parcelas de uma compra em 12x)
    apareceria vazia, e o cartão pareceria mais folgado do que está.
  */
  const todasTx = useMemo(
    () => [...transactions, ...futureCardTransactions],
    [transactions, futureCardTransactions],
  );

  const cartoes = accounts.filter((a) => a.kind === "credit_card");
  /*
    ⚠️ TRÊS BLOCOS, TRÊS SUBTOTAIS — E NUNCA UM TOTAL GERAL.

    Com seis ou oito contas a tela virava uma pilha de retângulos iguais: só o
    nome distinguia um do outro. Agrupar por natureza devolve a leitura ("quanto
    tenho líquido?", "quanto está aplicado?", "quanto devo?") sem inventar
    nenhuma informação nova.

    O subtotal é POR BLOCO de propósito. Somar dinheiro com dívida num número só
    é o mesmo erro que o cartão "Líquido" do Painel já documenta: esconde o
    endividamento. E somar investimento com conta corrente responderia "quanto
    tenho" para dois tipos de dinheiro que não estão igualmente disponíveis.

    `other` fica em "Contas e dinheiro": é o balde do que não se encaixou, e o
    saldo dele é dinheiro (a view o trata assim). Um quarto bloco chamado "Outros"
    com uma conta dentro seria pior que a imprecisão.
  */
  const liquidas = accounts.filter(
    (a) => a.kind === "checking" || a.kind === "savings" || a.kind === "cash" || a.kind === "other",
  );
  const investimentos = accounts.filter((a) => a.kind === "investment");

  function saldoDe(conta: FinanceAccount): number {
    return balanceById.get(conta.id)?.balance_cents ?? conta.opening_balance_cents;
  }
  const somar = (lista: FinanceAccount[]) => lista.reduce((s, a) => s + saldoDe(a), 0);

  const limiteTotal = cartoes.reduce((s, c) => s + (c.credit_limit_cents ?? 0), 0);
  const usadoTotal = cartoes.reduce(
    (s, c) => s + (balanceById.get(c.id)?.debt_cents ?? 0),
    0,
  );

  /**
   * Resumo da fatura de um mês para um cartão: lançado, já pago e em aberto.
   *
   * Vai para o formulário de pagamento, que pré-preenche o valor com o EM
   * ABERTO, não com o total — depois de um pagamento parcial de R$ 500 numa
   * fatura de R$ 1.200, sugerir R$ 1.200 tiraria R$ 1.700 da conta corrente por
   * uma dívida de R$ 1.200.
   */
  function resumoDaFatura(cartao: FinanceAccount, mesFatura: string): ResumoDeFatura {
    if (!diaUtilizavel(cartao.statement_closing_day)) {
      return { totalCents: 0, paidCents: 0, openCents: 0 };
    }
    const { totalCents, paidCents, openCents } = faturaDoCartao(
      todasTx,
      { id: cartao.id, statement_closing_day: cartao.statement_closing_day },
      mesFatura,
    );
    return { totalCents, paidCents, openCents };
  }

  const editar = (a: FinanceAccount) => {
    setEditing(a);
    setFormOpen(true);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-corpo-forte font-semibold text-ink">Contas</h3>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Icon.Capture width={15} height={15} /> Nova conta
        </Button>
      </div>

      {accounts.length === 0 && (
        <Card>
          <EmptyState icon="Wallet" title="Nenhuma conta" description="Crie sua primeira conta." />
        </Card>
      )}

      {cartoes.length > 0 && (
        <section className="space-y-3">
          <BlocoDeContas
            titulo="Cartões de crédito"
            valor={money(usadoTotal)}
            legenda={
              limiteTotal > 0
                ? `usado de ${money(limiteTotal)} de limite`
                : "limite não cadastrado"
            }
            /* Dívida nunca vem com cara de patrimônio: o rótulo diz "usado" e o
               tom é o de saída, como no cartão "Dívida total" do Painel. */
            tom="negativo"
          />
          <div className="grid gap-4 xl:grid-cols-2">
            {cartoes.map((cartao) => (
              <CreditCardPanel
                key={cartao.id}
                card={cartao}
                balance={balanceById.get(cartao.id)}
                month={month}
                transacoes={todasTx}
                money={money}
                onEdit={() => editar(cartao)}
                onArchive={() => setTarget(cartao)}
                onPay={() => setPaying(cartao)}
              />
            ))}
          </div>
        </section>
      )}

      {liquidas.length > 0 && (
        <section className="space-y-3">
          <BlocoDeContas
            titulo="Contas e dinheiro"
            valor={money(somar(liquidas))}
            legenda="disponível"
          />
          <ListaDeContas contas={liquidas} saldoDe={saldoDe} money={money} onEditar={editar} onArquivar={setTarget} />
        </section>
      )}

      {investimentos.length > 0 && (
        <section className="space-y-3">
          <BlocoDeContas
            titulo="Investimentos"
            valor={money(somar(investimentos))}
            legenda="aplicado"
          />
          <ListaDeContas
            contas={investimentos}
            saldoDe={saldoDe}
            money={money}
            onEditar={editar}
            onArquivar={setTarget}
          />
        </section>
      )}

      {accounts.length > 0 && liquidas.length === 0 && investimentos.length === 0 && (
        /*
          Só cartões cadastrados. Não é um estado vazio de verdade (os cartões
          estão logo acima), e mostrar "Nenhuma conta" aqui faria parecer que os
          dados sumiram. Também não é caso raro: dá para não ter conta corrente
          cadastrada e, aí, não há de onde pagar a fatura.
        */
        <Card className="p-4">
          <p className="text-corpo text-ink-subtle">
            Você só tem cartões cadastrados. Crie a conta de onde o dinheiro sai para poder
            registrar o pagamento das faturas.
          </p>
        </Card>
      )}

      {formOpen && (
        <Modal
          title={editing ? "Editar conta" : "Nova conta"}
          onClose={() => setFormOpen(false)}
        >
          <AccountForm
            account={editing}
            onDone={() => {
              setFormOpen(false);
              router.refresh();
            }}
            onCancel={() => setFormOpen(false)}
          />
        </Modal>
      )}

      {paying && (
        <Modal title={`Pagar fatura · ${paying.name}`} onClose={() => setPaying(null)}>
          <StatementPaymentForm
            card={paying}
            accounts={accounts}
            mesFaturaInicial={month}
            resumoDaFatura={(mes) => resumoDaFatura(paying, mes)}
            onDone={() => {
              setPaying(null);
              router.refresh();
            }}
            onCancel={() => setPaying(null)}
          />
        </Modal>
      )}

      <ConfirmationDialog
        open={target !== null}
        title="Arquivar conta"
        description="A conta sai da lista mas o histórico de lançamentos é preservado."
        confirmLabel="Arquivar"
        onCancel={() => setTarget(null)}
        onConfirm={() => {
          const a = target;
          setTarget(null);
          if (!a) return;
          start(async () => {
            const r = await archiveAccount(a.id);
            if (r.ok) {
              toast("Conta arquivada", "success");
              router.refresh();
            } else toast(r.error ?? "Erro", "error");
          });
        }}
      />
    </div>
  );
}

/** Cabeçalho de um bloco de contas: o nome à esquerda, o subtotal à direita. */
function BlocoDeContas({
  titulo,
  valor,
  legenda,
  tom,
}: {
  titulo: string;
  valor: string;
  legenda: string;
  tom?: "negativo";
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h4 className="text-corpo font-semibold text-ink">{titulo}</h4>
      <p className="text-legenda text-ink-subtle">
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            tom === "negativo" ? "text-danger-ink" : "text-ink",
          )}
        >
          {valor}
        </span>{" "}
        {legenda}
      </p>
    </div>
  );
}

/**
 * A COR DA CONTA — o único desvio consciente do Design System nesta fase.
 *
 * ============================================================================
 * ONDE ELE ESTÁ, E POR QUE SÓ AQUI
 * ============================================================================
 * Nos gráficos do Painel a cor É DADO: ela identifica a categoria, e o DS §3 já
 * reserva os 10% para exatamente isso. Aqui não — a cor da conta é IDENTIDADE
 * VISUAL, um atalho para o olho achar "o Nubank" numa pilha de oito retângulos
 * sem ler título nenhum. O DS não prevê esse uso, e este comentário existe para
 * que ele fique registrado como decisão, não como descuido.
 *
 * ⚠️ E POR ISSO ELE É CONTIDO: um disco de 32px atrás da inicial, nunca o cartão
 * inteiro pintado. Oito cards preenchidos viram um mostruário em que nenhum se
 * destaca — o oposto do problema que a cor veio resolver. O nome continua sendo
 * o dado; o disco é o atalho.
 *
 * A inicial dentro do disco não é enfeite: ela é o que sobra para quem não
 * distingue as cores, e é a razão de o disco poder existir sem quebrar a regra
 * de que cor nunca informa sozinha.
 */
function DiscoDaConta({ conta }: { conta: FinanceAccount }) {
  const tom = tomDaCor(conta.color_key);
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-legenda font-semibold text-ink",
        tom.fundoSuave,
        tom.borda,
      )}
    >
      {conta.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function ListaDeContas({
  contas,
  saldoDe,
  money,
  onEditar,
  onArquivar,
}: {
  contas: FinanceAccount[];
  saldoDe: (c: FinanceAccount) => number;
  money: (c: number) => string;
  onEditar: (c: FinanceAccount) => void;
  onArquivar: (c: FinanceAccount) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-line">
        {contas.map((a) => (
          /* Mesma quebra em duas linhas da lista de lançamentos, e pelo
             mesmo motivo: saldo e ações somam ~180px dos 303 disponíveis. */
          <li
            key={a.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5 sm:flex-nowrap"
          >
            <DiscoDaConta conta={a} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{a.name}</p>
              <p className="truncate text-legenda text-ink-subtle">
                {KIND_LABEL[a.kind] ?? a.kind}
                {a.institution ? ` · ${a.institution}` : ""}
              </p>
            </div>
            <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
              <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                {money(saldoDe(a))}
              </span>
              <div className="flex shrink-0 gap-3">
                <button
                  type="button"
                  onClick={() => onEditar(a)}
                  className="alvo-44 rounded-sm border border-line-strong px-2 py-1 text-meta text-ink-muted hover:text-ink"
                >
                  Editar
                </button>
                <button
                  type="button"
                  aria-label={`Arquivar ${a.name}`}
                  onClick={() => onArquivar(a)}
                  className="alvo-44 rounded-sm border border-line-strong p-1.5 text-ink-subtle hover:text-ink"
                >
                  <Icon.Trash width={13} height={13} />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * O cartão de crédito na tela — deliberadamente diferente de uma linha de conta.
 *
 * Uma conta tem um número (saldo). Um cartão tem quatro que só fazem sentido
 * juntos: limite, quanto já foi comprometido, quanto sobra e o que cai na
 * próxima fatura. Espremer isso numa linha de lista foi o que produziu o erro
 * conceitual que esta fase corrige — o saldo negativo do cartão aparecendo ao
 * lado do saldo da conta corrente, como se fossem a mesma grandeza.
 */
function CreditCardPanel({
  card,
  balance,
  month,
  transacoes,
  money,
  onEdit,
  onArchive,
  onPay,
}: {
  card: FinanceAccount;
  balance: FinanceAccountBalance | undefined;
  month: string;
  transacoes: FinanceTransaction[];
  money: (c: number) => string;
  onEdit: () => void;
  onArchive: () => void;
  onPay: () => void;
}) {
  // `null` também quando o dia gravado é inválido: ver `diaUtilizavel`. A partir
  // daqui "sem fechamento" e "com fechamento impossível" são o mesmo caso, e
  // nenhuma função pura de credit.ts é chamada com entrada que a faria lançar.
  const diaFechamento = diaUtilizavel(card.statement_closing_day)
    ? card.statement_closing_day
    : null;
  const diaVencimento = diaUtilizavel(card.payment_due_day) ? card.payment_due_day : null;
  const limiteCents = card.credit_limit_cents;

  /*
    `debt_cents` e `available_cents` vêm da view, que já é a autoridade sobre o
    assunto (0010) — recalcular aqui criaria uma segunda definição de dívida,
    que é exatamente como dois números do mesmo dashboard passam a discordar.
    A dívida inclui as parcelas futuras porque elas são gravadas com is_paid
    true: a dívida existe por inteiro desde a compra.
  */
  const usadoCents = balance?.debt_cents ?? 0;
  const disponivelCents = balance?.available_cents ?? null;

  /*
    O mês da fatura é LOCAL deste cartão — ver o bloco da fatura lá embaixo.
    Ele começa no mês global e é REALINHADO quando o mês global muda: sem o
    efeito, trocar o mês na barra do topo deixaria os cartões parados no mês em
    que cada um tivesse sido navegado, e a tela passaria a mostrar meses
    diferentes lado a lado sem dizer isso em lugar nenhum.
  */
  const [mesDaFatura, setMesDaFatura] = useState(month);
  useEffect(() => setMesDaFatura(month), [month]);

  const [itensAbertos, setItensAbertos] = useState(false);

  const fatura = useMemo(() => {
    if (diaFechamento == null) return null;
    return faturaDoCartao(
      transacoes,
      { id: card.id, statement_closing_day: diaFechamento },
      mesDaFatura,
    );
  }, [transacoes, card.id, diaFechamento, mesDaFatura]);

  const fechaEm = diaFechamento == null ? null : fechamentoDaFatura(mesDaFatura, diaFechamento);
  // O terceiro argumento é o que cobre o cartão "fecha 28, vence 5": sem ele o
  // vencimento sairia ANTES do próprio fechamento.
  const venceEm =
    diaFechamento == null || diaVencimento == null
      ? null
      : vencimentoDaFatura(mesDaFatura, diaVencimento, diaFechamento);

  /*
    O status é DERIVADO a cada render, nunca lido de coluna. Ver o cabeçalho de
    `statusDaFatura` para o porquê — em resumo: a fatura vence sozinha, e uma
    coluna persistida precisaria de relógio e passaria a discordar dos valores
    exibidos ao lado dela.

    `hojeISO()` e não `new Date()` cru: a comparação é com "AAAA-MM-DD" no fuso
    do app, e o navegador de quem está viajando não pode mudar o status de uma
    fatura.
  */
  const status = useMemo(() => {
    if (!fatura || diaFechamento == null || diaVencimento == null) return null;
    return statusDaFatura({
      hoje: diaCivilDe(new Date().toISOString()),
      mesFatura: mesDaFatura,
      diaFechamento,
      diaVencimento,
      resumo: fatura,
    });
  }, [fatura, diaFechamento, diaVencimento, mesDaFatura]);

  /*
    Lançamentos deste cartão que não pertencem a fatura nenhuma.

    Acontece com cartão cadastrado SEM dia de fechamento: `financeiro/actions.ts`
    grava `statement_month` nulo, a linha entra em `debt_cents` e desaparece da
    fatura. Documentado lá, e invisível na tela até agora.
  */
  const foraDeFatura = useMemo(
    () =>
      transacoes.filter(
        (t) =>
          t.account_id === card.id &&
          t.kind !== "transfer" &&
          t.statement_month === null &&
          !ehPagamentoDeFatura(t),
      ).length,
    [transacoes, card.id],
  );

  const temLimite = limiteCents != null && limiteCents > 0;
  const percentual = temLimite ? (usadoCents / limiteCents) * 100 : null;
  const estourado = percentual != null && percentual > 100;
  const faixa: FaixaDeUso = percentual == null ? "normal" : faixaDeUso(percentual);

  // A barra NUNCA passa da caixa: no estouro ela enche e o "quanto passou" é
  // dito em texto. Deixar a div transbordar quebraria o layout e, pior,
  // sugeriria uma escala que não existe.
  const proporcao = percentual == null ? 0 : Math.min(100, Math.max(0, percentual));
  // Piso visual de 2%, como nas outras barras da tela: 0,4% de um limite alto é
  // um traço invisível, e "invisível" lê-se como "zero" — dívida existindo e a
  // barra parecendo vazia. O piso é SÓ visual; o aria-valuenow abaixo continua
  // sendo o número de verdade, senão o leitor de tela anunciaria 2% de nada.
  const largura = proporcao > 0 ? Math.max(2, proporcao) : 0;
  // Percentual não é dinheiro e por isso não é mascarado por hideValues — é ele
  // que carrega a informação da barra para quem não distingue as cores.
  const percentualTexto = percentual == null ? "—" : `${Math.round(percentual)}%`;

  let rotuloDoLimite: string;
  if (percentual == null) rotuloDoLimite = "Limite não informado";
  else if (usadoCents < 0) {
    // Cartão pago a maior: dívida negativa é crédito a favor. A view não põe
    // piso em zero de propósito, e esconder isso aqui seria mentir ao contrário.
    rotuloDoLimite = `Crédito a favor de ${money(-usadoCents)} · 0% do limite usado`;
  } else if (estourado) {
    rotuloDoLimite = `Limite estourado em ${money(usadoCents - limiteCents!)} · ${percentualTexto} do limite`;
  } else {
    rotuloDoLimite = `${percentualTexto} do limite usado`;
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{card.name}</p>
          <p className="mt-0.5 text-legenda text-ink-subtle">
            {KIND_LABEL.credit_card}
            {card.institution ? ` · ${card.institution}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-3">
          <button
            type="button"
            onClick={onEdit}
            className="alvo-44 rounded-sm border border-line-strong px-2 py-1 text-meta text-ink-muted hover:text-ink"
          >
            Editar
          </button>
          <button
            type="button"
            aria-label={`Arquivar ${card.name}`}
            onClick={onArchive}
            className="alvo-44 rounded-sm border border-line-strong p-1.5 text-ink-subtle hover:text-ink"
          >
            <Icon.Trash width={13} height={13} />
          </button>
        </div>
      </div>

      {/*
        Três colunas só a partir de `sm`. No celular o cartão ocupa a largura
        toda (295px dentro do `p-5`), e três colunas dariam 90px cada — menos que
        os ~100px que "R$ 12.345,67" ocupa em 14px semibold. Pior: o espaço do
        `formatBRL` é NÃO-SEPARÁVEL (vem do Intl), então o valor não quebra em
        duas linhas, ele vaza por cima da coluna vizinha.

        Abaixo de `sm` cada par vira uma linha "rótulo … valor", que é o mesmo
        desenho do bloco da fatura logo abaixo neste cartão — os três números
        continuam empilhados e comparáveis, sem inventar um layout novo.
      */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
        <div className="flex items-baseline justify-between gap-2 sm:block">
          <p className="text-legenda text-ink-subtle">Limite</p>
          <p className="text-sm font-semibold tabular-nums text-ink sm:mt-0.5">
            {temLimite ? money(limiteCents!) : "—"}
          </p>
        </div>
        <div className="flex items-baseline justify-between gap-2 sm:block">
          <p className="text-legenda text-ink-subtle">Usado</p>
          <p className="text-sm font-semibold tabular-nums text-ink sm:mt-0.5">{money(usadoCents)}</p>
        </div>
        <div className="flex items-baseline justify-between gap-2 sm:block">
          <p className="text-legenda text-ink-subtle">Disponível</p>
          <p
            className={cn(
              "text-sm font-semibold tabular-nums sm:mt-0.5",
              disponivelCents != null && disponivelCents < 0
                ? "text-danger-ink"
                : "text-ink",
            )}
          >
            {disponivelCents == null ? "—" : money(disponivelCents)}
          </p>
        </div>
      </div>

      {percentual == null ? (
        <p className="text-legenda text-ink-subtle">
          Limite não cadastrado — edite o cartão para acompanhar quanto já foi comprometido.
        </p>
      ) : (
        <div>
          <div
            role="progressbar"
            aria-label={`Limite usado do cartão ${card.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            // Preso a 0-100 porque é o intervalo declarado; o valor REAL, que
            // pode passar de 100%, vai em `aria-valuetext`, que é o que o leitor
            // de tela anuncia quando existe.
            aria-valuenow={Math.round(proporcao)}
            aria-valuetext={rotuloDoLimite}
            className={cn(
              "h-2.5 w-full overflow-hidden rounded-full bg-surface-muted",
              // Segundo sinal do estouro, independente de cor: a caixa ganha
              // contorno. Quem não distingue vermelho ainda vê que algo mudou.
              estourado && "ring-1 ring-danger",
            )}
          >
            <div
              className={cn("h-full rounded-full", BARRA_POR_FAIXA[faixa])}
              style={{ width: `${largura}%` }}
            />
          </div>
          <p className={cn("mt-1.5 flex items-center gap-1.5 text-legenda", TEXTO_POR_FAIXA[faixa])}>
            {estourado && <Icon.Alert width={13} height={13} className="shrink-0" aria-hidden />}
            {rotuloDoLimite}
          </p>
        </div>
      )}

      <div className="rounded-md border border-line bg-surface-muted p-3.5">
        {/*
          ⚠️ A NAVEGAÇÃO DE MÊS DA FATURA É **LOCAL**, e não a global da tela.

          Conferir a fatura de dezembro não deveria trocar o mês do extrato, do
          orçamento e de todos os outros cartões junto. A pergunta "o que caiu
          na fatura passada deste cartão?" é sobre ESTE cartão, e arrastar a tela
          inteira para respondê-la obriga a desfazer tudo depois.

          Por isso `mesDaFatura` mora aqui dentro, começa no mês global e volta
          para ele quando o mês global muda (ver o `useEffect`).
        */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-corpo font-medium capitalize text-ink">
            Fatura de {monthLabel(mesDaFatura)}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Fatura anterior"
              onClick={() => setMesDaFatura((m) => somaMeses(m, -1))}
              className="alvo-44 flex h-8 w-8 items-center justify-center rounded-sm text-ink-muted hover:bg-surface hover:text-ink"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Próxima fatura"
              onClick={() => setMesDaFatura((m) => somaMeses(m, 1))}
              className="alvo-44 flex h-8 w-8 items-center justify-center rounded-sm text-ink-muted hover:bg-surface hover:text-ink"
            >
              ›
            </button>
          </div>
        </div>

        <div className="mt-1 flex items-baseline justify-between gap-2">
          {/*
            ⚠️ PONTO COLORIDO **MAIS** RÓTULO DE TEXTO — nunca só a cor.

            É a regra do DS §9, e ela não é preferência estética: quem não
            distingue vermelho de verde precisa saber que a fatura está vencida.
            O `ponto` do Badge existe exatamente para isto, e é o mesmo
            mecanismo que as categorias já usam.

            "fechada" fica sem ponto de propósito: é o estado NORMAL de uma
            fatura esperando o vencimento, e pintá-lo gastaria cor num caso que
            não pede atenção nenhuma. Cor tem significado; se tudo tem cor,
            nada tem.
          */}
          {fatura && status ? (
            <Badge tone="outline" ponto={PONTO_DO_STATUS_DA_FATURA[status]}>
              {ROTULO_DO_STATUS_DA_FATURA[status]}
            </Badge>
          ) : (
            <span />
          )}
          <p className="text-sm font-semibold tabular-nums text-ink">
            {fatura ? money(fatura.totalCents) : "—"}
          </p>
        </div>

        {fatura ? (
          <>
            <p className="mt-1 text-legenda text-ink-subtle">
              Fecha em {dataBR(fechaEm!)} · Vence em {venceEm ? dataBR(venceEm) : "—"} ·{" "}
              {plural(fatura.itens.length, "lançamento", "lançamentos")}
            </p>
            {/*
              Só aparece quando existe pagamento atribuído a ESTA fatura. Sem
              esta linha, quem pagou R$ 500 de uma fatura de R$ 1.200 continua
              vendo "R$ 1.200,00" e não tem como saber se o pagamento entrou —
              e o campo de valor do formulário sugeriria pagar tudo de novo.
            */}
            {fatura.paidCents !== 0 && (
              <p className="mt-1 text-legenda text-ink-muted">
                Já pago {money(fatura.paidCents)} · Em aberto{" "}
                <span className="font-medium text-ink">{money(fatura.openCents)}</span>
              </p>
            )}

            {/*
              ⚠️ A LISTA É RECOLHÍVEL E COMEÇA FECHADA.

              O cartão de conta já é denso, e a fatura de um mês normal tem
              dezenas de linhas — abertas por padrão, elas empurrariam todo o
              resto da tela para fora. O botão diz QUANTOS são, pelo mesmo
              motivo do "+3 compromissos" da Início: dá para decidir se vale
              abrir antes de abrir.
            */}
            {fatura.itens.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setItensAbertos((v) => !v)}
                  aria-expanded={itensAbertos}
                  className="mt-2 flex min-h-11 w-full items-center justify-center rounded-md border border-line px-3 text-legenda font-medium text-ink-muted hover:bg-surface hover:text-ink"
                >
                  {itensAbertos
                    ? "Ocultar lançamentos"
                    : `Ver ${plural(fatura.itens.length, "lançamento", "lançamentos")}`}
                </button>

                {itensAbertos && (
                  <ul className="mt-2 divide-y divide-line border-t border-line">
                    {fatura.itens.map((t) => (
                      <li key={t.id} className="flex items-center gap-2 py-2">
                        <span className="w-12 shrink-0 text-legenda tabular-nums text-ink-subtle">
                          {t.occurred_on.slice(8, 10)}/{t.occurred_on.slice(5, 7)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-legenda text-ink">
                          {t.description}
                        </span>
                        {/*
                          Estorno aparece com sinal, e não some: ele SUBTRAI do
                          total (ver `faturaDoCartao`), e uma linha exibida como
                          se fosse despesa faria a soma visível não bater com o
                          total do topo.
                        */}
                        <span
                          className={cn(
                            "shrink-0 text-legenda tabular-nums",
                            t.kind === "income" ? "text-success-ink" : "text-ink-muted",
                          )}
                        >
                          {t.kind === "income" ? "−" : ""}
                          {money(t.amount_cents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {/*
              ⚠️ OS PAGAMENTOS FICAM FORA DA LISTA ACIMA, e é por isso que a
              soma fecha. `faturaDoCartao` já os EXCLUI do `totalCents`
              (`ehPagamentoDeFatura`) — misturá-los na lista faria a soma das
              linhas visíveis divergir do número do topo, e o usuário passaria a
              conferir na mão para descobrir qual dos dois está certo.
            */}
            {fatura.paidCents !== 0 && (
              <p className="mt-2 border-t border-line pt-2 text-legenda text-ink-subtle">
                Pagamentos desta fatura ({money(fatura.paidCents)}) não entram na lista acima —
                eles abatem o total, não fazem parte dele.
              </p>
            )}
          </>
        ) : (
          <p className="mt-1 text-legenda text-danger-ink">
            Sem dia de fechamento cadastrado: não dá para saber a que fatura cada compra
            pertence. Edite o cartão.
          </p>
        )}

        {/*
          ⚠️ O CASO QUE FICAVA INVISÍVEL — e que a lista acima torna gritante.

          Um lançamento no cartão sem `statement_month` pesa em `debt_cents` (a
          barra de limite sobe) e não aparece em fatura nenhuma. Antes isso
          passava despercebido; com a lista visível, o usuário veria a barra
          dizer R$ 800 e a soma dos lançamentos dizer R$ 500, sem explicação.
          Contá-los explicitamente é a explicação.
        */}
        {foraDeFatura > 0 && (
          <p className="mt-2 text-legenda text-warning-ink">
            {plural(foraDeFatura, "lançamento", "lançamentos")} deste cartão sem fatura
            atribuída. {concorda(foraDeFatura, "Ele conta", "Eles contam")} no limite usado e não{" "}
            {concorda(foraDeFatura, "aparece", "aparecem")} em nenhuma fatura.
          </p>
        )}

        <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={onPay}>
          Pagar fatura
        </Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------- categorias e tags */

function CategoriesAndTags({
  categories,
  tags,
}: {
  categories: FinanceCategory[];
  tags: FinanceTag[];
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [, start] = useTransition();
  const [catOpen, setCatOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<FinanceCategory | null>(null);
  const [editingTag, setEditingTag] = useState<FinanceTag | null>(null);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-corpo-forte font-semibold text-ink">Categorias</h3>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setEditingCat(null);
              setCatOpen(true);
            }}
          >
            Nova
          </Button>
        </div>
        {categories.length === 0 ? (
          <EmptyState icon="Wallet" title="Nenhuma categoria" />
        ) : (
          <ul className="divide-y divide-line">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                {/* A cor escolhida aparece AQUI, e não só no gráfico: sem isto,
                    escolher uma cor é uma ação sem retorno visível na tela onde
                    ela foi escolhida. */}
                <span
                  aria-hidden
                  className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tomDaCor(c.color_key).fundo)}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.name}</span>
                <Badge tone="outline">{c.kind === "income" ? "Receita" : "Despesa"}</Badge>
                <button
                  type="button"
                  onClick={() => {
                    setEditingCat(c);
                    setCatOpen(true);
                  }}
                  className="alvo-44 rounded-sm border border-line-strong px-2 py-1 text-meta text-ink-muted hover:text-ink"
                >
                  Editar
                </button>
                <button
                  type="button"
                  aria-label={`Excluir ${c.name}`}
                  onClick={() =>
                    start(async () => {
                      const r = await deleteCategory(c.id);
                      if (r.ok) router.refresh();
                      else toast(r.error ?? "Erro", "error");
                    })
                  }
                  className="alvo-44 rounded-sm border border-line-strong p-1.5 text-ink-subtle hover:text-danger-ink"
                >
                  <Icon.Trash width={13} height={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-corpo-forte font-semibold text-ink">Etiquetas</h3>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setEditingTag(null);
              setTagOpen(true);
            }}
          >
            Nova
          </Button>
        </div>
        {tags.length === 0 ? (
          <EmptyState icon="Wallet" title="Nenhuma etiqueta" description="Ex.: fatura, reembolso, viagem." />
        ) : (
          <ul className="divide-y divide-line">
            {tags.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  aria-hidden
                  className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tomDaCor(t.color_key).fundo)}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">#{t.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setEditingTag(t);
                    setTagOpen(true);
                  }}
                  className="alvo-44 rounded-sm border border-line-strong px-2 py-1 text-meta text-ink-muted hover:text-ink"
                >
                  Editar
                </button>
                <button
                  type="button"
                  aria-label={`Excluir ${t.name}`}
                  onClick={() =>
                    start(async () => {
                      const r = await deleteTag(t.id);
                      if (r.ok) router.refresh();
                      else toast(r.error ?? "Erro", "error");
                    })
                  }
                  className="alvo-44 rounded-sm border border-line-strong p-1.5 text-ink-subtle hover:text-danger-ink"
                >
                  <Icon.Trash width={13} height={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {catOpen && (
        <Modal
          title={editingCat ? "Editar categoria" : "Nova categoria"}
          onClose={() => setCatOpen(false)}
        >
          <CategoryForm
            category={editingCat}
            onDone={() => {
              setCatOpen(false);
              router.refresh();
            }}
            onCancel={() => setCatOpen(false)}
          />
        </Modal>
      )}

      {tagOpen && (
        <Modal
          title={editingTag ? "Editar etiqueta" : "Nova etiqueta"}
          onClose={() => setTagOpen(false)}
        >
          <TagForm
            tag={editingTag}
            onDone={() => {
              setTagOpen(false);
              router.refresh();
            }}
            onCancel={() => setTagOpen(false)}
          />
        </Modal>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- orçamentos */

function Budgets({
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
  money: (c: number) => string;
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
