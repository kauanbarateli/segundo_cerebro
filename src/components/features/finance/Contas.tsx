"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/states";
import { Icon } from "@/components/ui/Icons";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { AccountForm, StatementPaymentForm } from "./FinanceForms";
import type {
  FinanceAccount,
  FinanceAccountBalance,
  FinanceTransaction,
} from "@/lib/database.types";
import { monthLabel, plural, concorda, cn } from "@/lib/utils";
import {
  ROTULO_DO_STATUS_DA_FATURA,
  ehPagamentoDeFatura,
  faturaDoCartao,
  fechamentoDaFatura,
  somaMeses,
  statusDaFatura,
  vencimentoDaFatura,
  type ResumoDeFatura,
  type StatusDaFatura,
} from "@/lib/credit";
import { diaCivilDe } from "@/lib/tempo";
import { tomDaCor } from "@/lib/finance-colors";
import type { PontoDeCategoria } from "@/components/ui/Badge";
import { previstoPorConta } from "@/lib/finance";
import { dataBR, type Dinheiro } from "./comum";
import { archiveAccount } from "@/app/(app)/financeiro/actions";

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

export function Contas({
  month,
  accounts,
  balances,
  transactions,
  futureCardTransactions,
  pendentes,
  money,
}: {
  month: string;
  accounts: FinanceAccount[];
  balances: FinanceAccountBalance[];
  transactions: FinanceTransaction[];
  futureCardTransactions: FinanceTransaction[];
  pendentes: FinanceTransaction[];
  money: Dinheiro;
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

  /*
    ⚠️ SALDO ATUAL E SALDO PREVISTO, LADO A LADO — E A VIEW FICA INTOCADA.

    A view `finance_account_balances` é a autoridade sobre o REALIZADO, e é
    contra ela que o extrato do banco é conferido. Fazê-la incluir o que ainda
    não foi pago faria o saldo do aplicativo divergir do extrato todo dia, e a
    pessoa não teria como saber qual dos dois está errado.

    O previsto é um segundo número, calculado ao lado e sempre rotulado:
    "depois de pagar o que está pendente". Ele só aparece quando existe pendência
    — mostrar "previsto = atual" em toda conta seria ruído.
  */
  const pendentePorConta = useMemo(() => previstoPorConta(pendentes), [pendentes]);
  const previstoDe = (conta: FinanceAccount) =>
    saldoDe(conta) + (pendentePorConta.get(conta.id) ?? 0);
  const somarPrevisto = (lista: FinanceAccount[]) =>
    lista.reduce((s, a) => s + previstoDe(a), 0);

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
            previsto={
              somarPrevisto(liquidas) !== somar(liquidas)
                ? money(somarPrevisto(liquidas))
                : undefined
            }
          />
          <ListaDeContas
            contas={liquidas}
            saldoDe={saldoDe}
            previstoDe={previstoDe}
            money={money}
            onEditar={editar}
            onArquivar={setTarget}
          />
        </section>
      )}

      {investimentos.length > 0 && (
        <section className="space-y-3">
          <BlocoDeContas
            titulo="Investimentos"
            valor={money(somar(investimentos))}
            legenda="aplicado"
            previsto={
              somarPrevisto(investimentos) !== somar(investimentos)
                ? money(somarPrevisto(investimentos))
                : undefined
            }
          />
          <ListaDeContas
            contas={investimentos}
            saldoDe={saldoDe}
            previstoDe={previstoDe}
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
  previsto,
}: {
  titulo: string;
  valor: string;
  legenda: string;
  tom?: "negativo";
  /**
   * O saldo depois de pagar o que está pendente. `undefined` quando não há
   * pendência — repetir o mesmo número duas vezes seria ruído, e ensinaria a
   * ignorar a linha justamente antes do dia em que ela passa a importar.
   */
  previsto?: string;
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
        {previsto && (
          <>
            {" · "}
            <span className="tabular-nums">{previsto}</span> depois do que está em aberto
          </>
        )}
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
  previstoDe,
  money,
  onEditar,
  onArquivar,
}: {
  contas: FinanceAccount[];
  /** O saldo REALIZADO, da view. É este que bate com o extrato do banco. */
  saldoDe: (c: FinanceAccount) => number;
  /** O saldo depois de quitar o que está em aberto. Nunca substitui o de cima. */
  previstoDe: (c: FinanceAccount) => number;
  money: Dinheiro;
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
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold tabular-nums text-ink">
                  {money(saldoDe(a))}
                </span>
                {/*
                  Só aparece quando há pendência, e sempre ROTULADO. Um segundo
                  número sem rótulo ao lado do saldo seria lido como "o saldo
                  certo" — e aí a pessoa passaria a conferir o extrato contra o
                  número errado.
                */}
                {previstoDe(a) !== saldoDe(a) && (
                  <span className="block text-legenda tabular-nums text-ink-subtle">
                    {money(previstoDe(a))} previsto
                  </span>
                )}
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
  money: Dinheiro;
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
