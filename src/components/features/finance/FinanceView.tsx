"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PillButton } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icons";
import { formatBRL, monthLabel } from "@/lib/utils";
import { previousMonthIso, nextMonthIso, type Recorte } from "@/lib/finance";
import { TABS, type Tab, type FinanceViewProps } from "./comum";
import { Painel } from "./Painel";
import { Lancamentos } from "./Lancamentos";
import { Contas } from "./Contas";
import { CategoriasEEtiquetas } from "./CategoriasEEtiquetas";
import { Orcamentos } from "./Orcamentos";

/**
 * A CASCA do módulo Financeiro: navegação de período, abas e a preferência de
 * ocultar valores. Nenhuma soma acontece aqui.
 *
 * As cinco visões moram em arquivos próprios (`Painel`, `Lancamentos`,
 * `Contas`, `CategoriasEEtiquetas`, `Orcamentos`). Este arquivo tinha 87 KB e
 * 2.300 linhas com todas elas dentro — nesse tamanho, mudar o Painel obrigava a
 * rolar por Contas, e duas mudanças sem nenhuma relação conflitavam no mesmo
 * arquivo.
 *
 * O que é compartilhado entre as visões (o tipo das props, as abas, `dataBR`,
 * os cartões de estatística) está em `comum.tsx`, e não aqui: se estivesse
 * aqui, cada visão importaria deste arquivo e este importaria de volta — um
 * ciclo, que o contrato de camadas recusa.
 */
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
        <Painel {...props} money={money} hidden={hidden} onRecorte={(r) => irPara(month, r)} />
      )}
      {tab === "transactions" && <Lancamentos {...props} money={money} />}
      {tab === "accounts" && (
        <Contas
          month={month}
          accounts={accounts}
          balances={balances}
          transactions={transactions}
          futureCardTransactions={futureCardTransactions}
          pendentes={props.pendentes}
          money={money}
        />
      )}
      {tab === "categories" && (
        <CategoriasEEtiquetas
          categories={categories}
          tags={tags}
          transactions={transactions}
          transactionTags={props.transactionTags}
        />
      )}
      {tab === "budgets" && (
        <Orcamentos
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
