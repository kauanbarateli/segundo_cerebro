"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, PillButton } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/states";
import { Icon } from "@/components/ui/Icons";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { TransactionForm, TransactionPaymentForm, TransferForm } from "./FinanceForms";
import type { FinanceTransaction } from "@/lib/database.types";
import { monthLabel, plural, cn } from "@/lib/utils";
import { isTransfer, mesDeCompetencia, cartoesDe } from "@/lib/finance";
import { dataBR, type Dinheiro, type FinanceViewProps } from "./comum";
import { cancelarFuturasDaSerie, deleteTransaction } from "@/app/(app)/financeiro/actions";

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

export function Lancamentos({
  month,
  transactions,
  accounts,
  categories,
  tags,
  transactionTags,
  money,
}: FinanceViewProps & { money: Dinheiro }) {
  const { toast } = useToast();
  const router = useRouter();
  const [, start] = useTransition();
  const [formOpen, setFormOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [editing, setEditing] = useState<FinanceTransaction | null>(null);
  const [target, setTarget] = useState<FinanceTransaction | null>(null);
  const [pagando, setPagando] = useState<FinanceTransaction | null>(null);
  const [encerrando, setEncerrando] = useState<FinanceTransaction | null>(null);

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
  const doMes = useMemo(
    () => transactions.filter((t) => mesDeCompetencia(t, cartoes) === alvo),
    [transactions, cartoes, alvo],
  );

  /*
    OS FILTROS SÃO CHIPS, E NÃO UM PAINEL DE `select`.

    `PillButton` é o mesmo controle das abas e do recorte do Painel: a tela já
    ensinou que pílula preta significa "isto está ativo". Um bloco de seletores
    seria um vocabulário novo para a mesma operação, e ocuparia altura que a
    lista usa melhor.

    "Status" só existe fora de cartão: lá o gatilho da 0023 mantém tudo quitado,
    e um filtro que nunca muda o resultado ensina a ignorar a barra inteira.
  */
  const [filtroConta, setFiltroConta] = useState<string | null>(null);
  const [filtroCategoria, setFiltroCategoria] = useState<string | null>(null);
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "aberto" | "pago">("todos");

  const filtrados = useMemo(
    () =>
      doMes.filter((tx) => {
        if (filtroConta && tx.account_id !== filtroConta) return false;
        if (filtroCategoria && tx.category_id !== filtroCategoria) return false;
        if (filtroStatus === "aberto" && tx.paid_cents >= tx.amount_cents) return false;
        if (filtroStatus === "pago" && tx.paid_cents < tx.amount_cents) return false;
        return true;
      }),
    [doMes, filtroConta, filtroCategoria, filtroStatus],
  );

  /*
    AGRUPAMENTO POR DIA, com subtotal.

    Trinta linhas planas não têm ritmo: o olho não sabe onde um dia termina e o
    outro começa, e "quanto gastei na segunda?" vira uma conta de cabeça. O
    cabeçalho de dia responde isso de graça, e a data sai das linhas — ela vira
    redundante debaixo do próprio cabeçalho.

    A ordem é decrescente (o mais recente primeiro), a mesma em que o snapshot
    entrega. O agrupamento é por `occurred_on`, e não pela competência: dentro de
    um mês já filtrado por competência, o que se procura é o DIA da compra.
  */
  const porDia = useMemo(() => {
    const mapa = new Map<string, FinanceTransaction[]>();
    for (const tx of filtrados) {
      const lista = mapa.get(tx.occurred_on) ?? [];
      lista.push(tx);
      mapa.set(tx.occurred_on, lista);
    }
    return [...mapa.entries()].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  }, [filtrados]);

  /** Totais do que está VISÍVEL, e o rótulo diz isso — senão o número mente sob filtro. */
  const totais = useMemo(() => {
    let entradas = 0;
    let saidas = 0;
    for (const tx of filtrados) {
      if (isTransfer(tx)) continue;
      if (tx.kind === "income") entradas += tx.amount_cents;
      else if (tx.kind === "expense") saidas += tx.amount_cents;
    }
    return { entradas, saidas };
  }, [filtrados]);

  const contasComLancamento = useMemo(
    () => accounts.filter((a) => doMes.some((t) => t.account_id === a.id)),
    [accounts, doMes],
  );
  const categoriasComLancamento = useMemo(
    () => categories.filter((c) => doMes.some((t) => t.category_id === c.id)),
    [categories, doMes],
  );
  const temNaoCartao = useMemo(
    () => doMes.some((t) => !cartoes.has(t.account_id) && !isTransfer(t)),
    [doMes, cartoes],
  );

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

      {doMes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5">
          <PillButton active={filtroConta === null} onClick={() => setFiltroConta(null)}>
            Todas as contas
          </PillButton>
          {contasComLancamento.map((a) => (
            <PillButton
              key={a.id}
              active={filtroConta === a.id}
              onClick={() => setFiltroConta(filtroConta === a.id ? null : a.id)}
            >
              {a.name}
            </PillButton>
          ))}

          {categoriasComLancamento.length > 0 && (
            <span aria-hidden className="mx-1 self-center text-ink-subtle">
              ·
            </span>
          )}
          {categoriasComLancamento.map((c) => (
            <PillButton
              key={c.id}
              active={filtroCategoria === c.id}
              onClick={() => setFiltroCategoria(filtroCategoria === c.id ? null : c.id)}
            >
              {c.name}
            </PillButton>
          ))}

          {temNaoCartao && (
            <>
              <span aria-hidden className="mx-1 self-center text-ink-subtle">
                ·
              </span>
              <PillButton
                active={filtroStatus === "aberto"}
                onClick={() => setFiltroStatus(filtroStatus === "aberto" ? "todos" : "aberto")}
              >
                Em aberto
              </PillButton>
              <PillButton
                active={filtroStatus === "pago"}
                onClick={() => setFiltroStatus(filtroStatus === "pago" ? "todos" : "pago")}
              >
                Pagos
              </PillButton>
            </>
          )}
        </div>
      )}

      {filtrados.length === 0 ? (
        <EmptyState
          icon="Wallet"
          title={doMes.length === 0 ? "Nenhum lançamento neste mês" : "Nada com esses filtros"}
          description={
            doMes.length === 0
              ? "Registre uma receita ou despesa para começar."
              : "Limpe um dos filtros acima para ver mais."
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {porDia.map(([dia, linhas]) => (
            <li key={dia}>
              <div className="flex items-baseline justify-between gap-2 bg-surface-muted px-4 py-1.5">
                <span className="text-legenda font-medium tabular-nums text-ink-muted">
                  {dataBR(dia)}
                </span>
                <span className="text-legenda tabular-nums text-ink-subtle">
                  {money(
                    linhas
                      .filter((t) => !isTransfer(t))
                      .reduce(
                        (s, t) => s + (t.kind === "income" ? t.amount_cents : -t.amount_cents),
                        0,
                      ),
                  )}
                </span>
              </div>
              <ul className="divide-y divide-line">
                {linhas.map((tx) => {
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
                    {/*
                      A DATA SAIU DAQUI: o cabeçalho do dia, logo acima, já a
                      diz. Repeti-la em toda linha era ruído debaixo do próprio
                      rótulo, e comia a largura que a descrição precisa no
                      celular.
                    */}
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
                        {/* "3 de 12" com o TIPO junto: é a única coisa na tela
                            que distingue doze aluguéis de doze parcelas, e a
                            diferença decide se aquilo é dívida. */}
                        {tx.installment_no} de {tx.installment_total}
                        {tx.serie_tipo === "recorrencia" ? " · recorrente" : ""}
                      </Badge>
                    )}
                    {tx.category_id && <Badge tone="outline">{categoryById.get(tx.category_id)}</Badge>}
                    {transfer && <Badge>Transferência</Badge>}
                    {/*
                      Três estados, não dois: quitado (sem selo), parcialmente
                      pago (com o quanto) e nada pago. Mostrar só "Pendente" para
                      os dois últimos esconderia justamente o pagamento que a
                      pessoa acabou de registrar.
                    */}
                    {!transfer && tx.paid_cents > 0 && tx.paid_cents < tx.amount_cents && (
                      <Badge>Pago {money(tx.paid_cents)} de {money(tx.amount_cents)}</Badge>
                    )}
                    {!transfer && tx.paid_cents === 0 && !tx.is_paid && <Badge>Em aberto</Badge>}
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
                    {/*
                      ⚠️ "PAGAR" SÓ APARECE ONDE ELE FAZ ALGUMA COISA.

                      Em cartão quem se paga é a FATURA, não a compra — e o
                      gatilho da 0023 mantém toda linha de cartão quitada, então
                      não haveria o que pagar. Transferência já aconteceu por
                      definição. Linha quitada não tem saldo.

                      A action recusa os três casos com mensagem própria; esconder
                      o botão é o que evita oferecer a operação para depois negá-la.
                    */}
                    {!transfer &&
                      !cartoes.has(tx.account_id) &&
                      tx.paid_cents < tx.amount_cents && (
                        <button
                          type="button"
                          onClick={() => setPagando(tx)}
                          className="alvo-44 rounded-sm border border-line-strong px-2 py-1 text-meta font-medium text-ink hover:bg-surface-muted"
                        >
                          {tx.kind === "income" ? "Receber" : "Pagar"}
                        </button>
                      )}
                    {/*
                      ⚠️ "ENCERRAR" SÓ EM RECORRÊNCIA, NUNCA EM PARCELAMENTO.

                      Você sai do imóvel no terceiro mês e os nove aluguéis
                      seguintes deixam de existir — é o caso que dá sentido à
                      operação. Apagar parcelas futuras de uma compra parcelada
                      apagaria dívida que CONTINUA existindo: o sofá já está na
                      sala. A action recusa; o botão nem aparece.
                    */}
                    {tx.serie_tipo === "recorrencia" && (
                      <button
                        type="button"
                        onClick={() => setEncerrando(tx)}
                        className="alvo-44 rounded-sm border border-line-strong px-2 py-1 text-meta text-ink-muted hover:text-ink"
                      >
                        Encerrar
                      </button>
                    )}
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
            </li>
          ))}
        </ul>
      )}

      {/*
        O rodapé soma o que está VISÍVEL, e o rótulo diz isso. Sem a ressalva, um
        filtro ativo faria o total parecer o total do mês — o mesmo tipo de
        número que parece plausível e está errado.
      */}
      {filtrados.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-legenda">
          <span className="text-ink-subtle">
            {plural(filtrados.length, "lançamento", "lançamentos")}
            {filtrados.length !== doMes.length && " (com filtro)"}
          </span>
          <span className="tabular-nums text-ink-muted">
            <span className="text-success-ink">{money(totais.entradas)}</span> entraram ·{" "}
            <span className="text-danger-ink">{money(totais.saidas)}</span> saíram
          </span>
        </div>
      )}

      <ConfirmationDialog
        open={encerrando !== null}
        title="Encerrar recorrência"
        description={
          encerrando
            ? `As ocorrências de "${descricaoSemParcela(encerrando)}" a partir desta — a ${encerrando.installment_no} de ${encerrando.installment_total} — serão apagadas. As já pagas ficam, porque aconteceram de verdade.`
            : ""
        }
        confirmLabel="Encerrar"
        onCancel={() => setEncerrando(null)}
        onConfirm={() => {
          const alvoDaSerie = encerrando;
          setEncerrando(null);
          if (!alvoDaSerie) return;
          start(async () => {
            const r = await cancelarFuturasDaSerie(alvoDaSerie.id);
            if (r.ok) {
              toast("Recorrência encerrada", "success");
              router.refresh();
            } else toast(r.error ?? "Erro", "error");
          });
        }}
      />

      {pagando && (
        <Modal
          title={pagando.kind === "income" ? "Registrar recebimento" : "Pagar lançamento"}
          onClose={() => setPagando(null)}
        >
          <TransactionPaymentForm
            transaction={pagando}
            onDone={() => {
              setPagando(null);
              router.refresh();
            }}
            onCancel={() => setPagando(null)}
          />
        </Modal>
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
