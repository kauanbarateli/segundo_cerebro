"use client";

import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";
import type { Recorte, FinanceAnalytics } from "@/lib/finance";
import type {
  FinanceAccount,
  FinanceAccountBalance,
  FinanceCategory,
  FinanceTag,
  FinanceTransaction,
  FinanceBudget,
} from "@/lib/database.types";

/**
 * O QUE AS QUATRO VISÕES DO FINANCEIRO COMPARTILHAM.
 *
 * ============================================================================
 * ⚠️ ESTE ARQUIVO EXISTE PARA QUEBRAR UM CICLO, E NÃO SÓ PARA ORGANIZAR
 * ============================================================================
 * `FinanceView` renderiza `Painel`, `Lancamentos`, `Contas`… e as quatro
 * precisam do tipo `FinanceViewProps`. Se ele morasse em `FinanceView.tsx`,
 * cada visão importaria de lá e `FinanceView` importaria de volta — um ciclo
 * de módulos, que a regra `sem-ciclo` do `.dependency-cruiser.cjs` recusa (e
 * com razão: ciclo em componente React é como um `undefined` aparece só na
 * build de produção, quando a ordem de avaliação muda).
 *
 * A saída padrão é a mesma de sempre: o que é compartilhado desce um nível,
 * para um módulo que não importa nenhum dos que o importam.
 *
 * ============================================================================
 * POR QUE O ARQUIVO FOI DIVIDIDO
 * ============================================================================
 * `FinanceView.tsx` chegou a 87 KB e 2.300 linhas com as quatro visões, os
 * cartões de estatística, o painel de cartão de crédito e os diálogos. Nesse
 * tamanho, mudar o Painel obriga a rolar por Contas, e duas mudanças em visões
 * diferentes conflitam no mesmo arquivo sem terem nada a ver uma com a outra.
 */

/* --------------------------------------------------------------- formato */

/** "2026-08-02" -> "02/08/2026". Sem `Date`: converter aqui deslocaria o dia por fuso. */
export function dataBR(iso: string): string {
  return iso.split("-").reverse().join("/");
}

/* ----------------------------------------------------------------- abas */

export type Tab = "dashboard" | "transactions" | "accounts" | "categories" | "budgets";

export const TABS: { key: Tab; label: string }[] = [
  { key: "dashboard", label: "Painel" },
  { key: "transactions", label: "Lançamentos" },
  { key: "accounts", label: "Contas" },
  { key: "categories", label: "Categorias e etiquetas" },
  { key: "budgets", label: "Orçamentos" },
];

/* ---------------------------------------------------------------- props */

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
  /**
   * TODOS os lançamentos ainda não quitados, de QUALQUER data — a lista que
   * responde "quanto ainda vai sair". Ver `getFinanceSnapshot`: ela não sai de
   * `transactions` porque uma recorrência de 36 meses vive quase toda fora da
   * janela de três meses.
   */
  pendentes: FinanceTransaction[];
  budgets: FinanceBudget[];
  transactionTags: { transaction_id: string; tag_id: string }[];
  hideValues: boolean;
}

/** Formatação de dinheiro que já carrega a preferência "ocultar valores". */
export type Dinheiro = (cents: number) => string;

/* ------------------------------------------------------------- cartões */

export function StatCard({
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

export function CompareRow({
  label,
  current,
  previous,
  money,
}: {
  label: string;
  current: number;
  previous: number;
  money: Dinheiro;
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
