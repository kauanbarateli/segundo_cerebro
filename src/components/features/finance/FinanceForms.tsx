"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { PillButton } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import type {
  FinanceAccount,
  FinanceAccountKind,
  FinanceCategory,
  FinanceTag,
  FinanceTransaction,
} from "@/lib/database.types";
import { parseBRLToCents, formatCentsPlain, formatBRL, monthLabel } from "@/lib/utils";
import { parcelas, type ResumoDeFatura } from "@/lib/credit";
import { nextMonthIso } from "@/lib/finance";
import {
  upsertAccount,
  upsertCategory,
  upsertTag,
  upsertTransaction,
  createTransfer,
  createInstallmentPurchase,
  payStatement,
  upsertBudget,
} from "@/app/(app)/financeiro/actions";

const inputCls =
  "h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2";

/*
  PARES DE CAMPOS — por que todo `grid-cols-2` deste arquivo tem `grid-cols-1`
  antes e o `sm:` na frente.

  Estes formulários vivem dentro do `Modal`, e a conta de largura no celular é
  implacável: 375px de tela − 32px do padding do véu − 40px do padding do painel
  = 303px úteis. Tirando o `gap-3`, sobram ~145px por coluna, e o `px-3` do
  campo come mais 24. Um `<input type="date">` renderiza o seletor nativo do
  sistema dentro disso: no iOS o texto "31/12/2025" já encosta nas bordas, e
  dentro da caixa do cartão (que ainda tem `p-3.5` próprio) fica pior.

  Empilhar no celular e voltar a duas colunas a partir de `sm` (640px) não muda
  nada no desktop, que é onde o pareamento existe para economizar altura.
*/

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-corpo font-medium text-ink">{label}</label>
      {children}
      {hint && <p className="mt-1 text-legenda text-ink-subtle">{hint}</p>}
    </div>
  );
}

function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-corpo text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}

function Actions({ pending, label, onCancel }: { pending: boolean; label: string; onCancel: () => void }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
        Cancelar
      </Button>
      <Button variant="primary" size="sm" type="submit" disabled={pending}>
        {pending ? "Salvando…" : label}
      </Button>
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

/** Número máximo de parcelas — o mesmo teto de `financeInstallmentSchema`. */
const MAX_PARCELAS = 36;

/* -------------------------------------------------------------- lançamento */

export function TransactionForm({
  accounts,
  categories,
  tags,
  transaction,
  initialTagIds,
  onDone,
  onCancel,
}: {
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  tags: FinanceTag[];
  transaction: FinanceTransaction | null;
  initialTagIds: string[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"income" | "expense">(
    transaction?.kind === "income" ? "income" : "expense",
  );
  const [amount, setAmount] = useState(
    transaction ? formatCentsPlain(transaction.amount_cents) : "",
  );
  const [selectedTags, setSelectedTags] = useState<string[]>(initialTagIds);
  // A conta virou ESTADO (antes era `defaultValue` num select não controlado)
  // porque a interface reage a ela: só cartão revela o campo de parcelas.
  const [accountId, setAccountId] = useState(transaction?.account_id ?? "");
  // Texto, não número: um input numérico vazio devolve "" e `Number("")` é 0 —
  // o zero silencioso viraria "0 parcelas" e o schema recusaria com uma mensagem
  // que não explica nada. Guardando o texto, "vazio" continua sendo vazio.
  const [installments, setInstallments] = useState("1");

  const visibleCategories = categories.filter((c) => c.kind === kind);

  const contaSelecionada = accounts.find((a) => a.id === accountId) ?? null;
  /*
    Parcelar só faz sentido em DESPESA de CARTÃO e só na CRIAÇÃO.

    Edição fica de fora porque `createInstallmentPurchase` cria N linhas novas:
    transformar um lançamento existente em parcelamento exigiria apagar o
    original e recriar, e um erro no meio deixaria a compra duplicada. Quem
    precisa disso exclui e lança de novo — explicitamente.
  */
  const podeParcelar =
    transaction === null && kind === "expense" && contaSelecionada?.kind === "credit_card";

  const numeroDeParcelas = Number(installments);
  const parcelasValidas =
    Number.isInteger(numeroDeParcelas) && numeroDeParcelas >= 1 && numeroDeParcelas <= MAX_PARCELAS;
  const parcelado = podeParcelar && parcelasValidas && numeroDeParcelas > 1;

  const centavos = parseBRLToCents(amount);

  /*
    Prévia do rateio ANTES de salvar. O centavo a mais na última parcela é
    exatamente o tipo de detalhe que gera desconfiança quando aparece só depois,
    no extrato: "por que a 12ª veio R$ 0,04 mais cara?". Mostrando aqui, é uma
    conta que a pessoa confere; escondendo, é um erro que ela vai caçar.

    `parcelas()` LANÇA em entrada inválida (total fracionário, N <= 0), então a
    chamada só acontece com os dois já validados — a prévia não pode derrubar o
    formulário.
  */
  const previa = useMemo(() => {
    if (!parcelado || centavos == null || !Number.isSafeInteger(centavos) || centavos <= 0) {
      return null;
    }
    // Parcela de zero centavo é recusada pelo CHECK do banco. Avisar aqui, com
    // a conta na frente, é melhor que deixar o erro cru da constraint voltar.
    if (centavos < numeroDeParcelas) return { erro: true as const };

    const valores = parcelas(centavos, numeroDeParcelas);
    const primeira = valores[0]!;
    const ultima = valores[valores.length - 1]!;
    return { erro: false as const, primeira, ultima, iguais: primeira === ultima };
  }, [parcelado, centavos, numeroDeParcelas]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);

    const cents = parseBRLToCents(amount);
    if (cents == null || cents <= 0) {
      setError("Informe um valor válido, ex.: 1.234,56");
      return;
    }

    /*
      Campo de parcelas presente mas com valor impossível (vazio, "0", 50).

      Sem esta recusa o caminho é SILENCIOSO e caro: `parcelado` seria false e o
      formulário criaria UM lançamento com o valor total — a pessoa pediu 50x de
      R$ 6.000 e levaria uma despesa única de R$ 6.000 no mês, sem nenhum aviso.
      A validação nativa do input (min/max) cobre o caso digitado, mas não cobre
      campo vazio nem texto que o navegador transforma em "".
    */
    if (podeParcelar && !parcelasValidas) {
      setError(`Informe o número de parcelas, de 1 a ${MAX_PARCELAS}.`);
      return;
    }

    if (parcelado) {
      if (cents < numeroDeParcelas) {
        setError("Parcelas demais para esse valor: cada parcela precisa ter ao menos um centavo.");
        return;
      }
      start(async () => {
        // O que vai para o servidor é o TOTAL da compra, nunca o valor da
        // parcela: 3 × R$ 33,33 não é R$ 100,00, e reconstruir o total a partir
        // da parcela faria a compra nascer devendo um centavo.
        const r = await createInstallmentPurchase({
          accountId,
          categoryId: String(fd.get("categoryId") ?? ""),
          description: String(fd.get("description") ?? ""),
          totalAmountCents: cents,
          installments: numeroDeParcelas,
          occurredOn: String(fd.get("occurredOn") ?? ""),
          tagIds: selectedTags,
        });
        if (r.ok) {
          toast(`Compra em ${numeroDeParcelas}x registrada`, "success");
          onDone();
        } else setError(r.error ?? "Erro ao salvar");
      });
      return;
    }

    start(async () => {
      const r = await upsertTransaction({
        id: transaction?.id,
        accountId,
        categoryId: String(fd.get("categoryId") ?? ""),
        kind,
        amountCents: cents,
        description: String(fd.get("description") ?? ""),
        payee: String(fd.get("payee") ?? ""),
        occurredOn: String(fd.get("occurredOn") ?? ""),
        notes: String(fd.get("notes") ?? ""),
        isPaid: fd.get("isPaid") === "on",
        tagIds: selectedTags,
      });
      if (r.ok) {
        toast("Lançamento salvo", "success");
        onDone();
      } else setError(r.error ?? "Erro ao salvar");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex gap-2">
        <PillButton active={kind === "expense"} onClick={() => setKind("expense")}>
          Despesa
        </PillButton>
        <PillButton active={kind === "income"} onClick={() => setKind("income")}>
          Receita
        </PillButton>
      </div>

      <Field label="Descrição">
        <input name="description" required defaultValue={transaction?.description ?? ""} className={inputCls} />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={parcelado ? "Valor TOTAL da compra (R$)" : "Valor (R$)"} hint="Ex.: 1.234,56">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            required
            placeholder="0,00"
            className={inputCls}
          />
        </Field>
        <Field label={parcelado ? "Data da compra" : "Data"}>
          <input
            name="occurredOn"
            type="date"
            required
            defaultValue={transaction?.occurred_on ?? today()}
            className={inputCls}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Conta">
          <select
            name="accountId"
            required
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className={inputCls}
          >
            <option value="">Selecione…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.kind === "credit_card" ? " (cartão)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Categoria">
          <select name="categoryId" defaultValue={transaction?.category_id ?? ""} className={inputCls}>
            <option value="">Sem categoria</option>
            {visibleCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {podeParcelar && (
        <Field
          label="Parcelas"
          hint="1 = compra à vista. O valor acima é sempre o TOTAL da compra."
        >
          <input
            type="number"
            min={1}
            max={MAX_PARCELAS}
            step={1}
            value={installments}
            onChange={(e) => setInstallments(e.target.value)}
            className={inputCls}
          />
        </Field>
      )}

      {previa && (
        <div
          className="rounded-md border border-line bg-surface-muted px-3 py-2.5 text-corpo"
          // `polite` e não `assertive`: a prévia muda a cada tecla no valor;
          // interromper o leitor de tela a cada dígito seria hostil.
          aria-live="polite"
        >
          {previa.erro ? (
            <span className="text-red-600 dark:text-red-400">
              {numeroDeParcelas} parcelas para {formatBRL(centavos ?? 0)} deixaria parcela de
              zero centavo. Reduza o número de parcelas.
            </span>
          ) : previa.iguais ? (
            <span className="text-ink">
              {numeroDeParcelas}x de {formatBRL(previa.primeira)}
            </span>
          ) : (
            <span className="text-ink">
              {numeroDeParcelas}x de {formatBRL(previa.primeira)}, última de{" "}
              {formatBRL(previa.ultima)}
              <span className="ml-1 text-ink-subtle">
                — a última absorve o arredondamento para a soma bater com o total.
              </span>
            </span>
          )}
        </div>
      )}

      {/*
        Campos que a compra parcelada NÃO grava. Escondê-los é mais honesto que
        mostrá-los e descartar o que a pessoa digitou: `financeInstallmentSchema`
        não tem payee nem notes, e `is_paid` é sempre true — é o que faz o limite
        disponível do cartão refletir a dívida inteira, e não só a parcela do mês.
      */}
      {!parcelado && (
        <Field label="Beneficiário / pagador">
          <input name="payee" defaultValue={transaction?.payee ?? ""} className={inputCls} />
        </Field>
      )}

      {tags.length > 0 && (
        <div>
          <p className="mb-1.5 text-corpo font-medium text-ink">Etiquetas</p>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <PillButton
                key={t.id}
                active={selectedTags.includes(t.id)}
                onClick={() =>
                  setSelectedTags((prev) =>
                    prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                  )
                }
              >
                #{t.name}
              </PillButton>
            ))}
          </div>
        </div>
      )}

      {!parcelado && (
        <Field label="Observações">
          <textarea name="notes" rows={2} defaultValue={transaction?.notes ?? ""} className={`${inputCls} h-auto py-2`} />
        </Field>
      )}

      {parcelado ? (
        <p className="text-legenda text-ink-subtle">
          Serão criados {numeroDeParcelas} lançamentos, um por mês, todos marcados como pagos —
          a dívida no cartão existe por inteiro desde a compra.
        </p>
      ) : (
        <label className="flex items-center gap-2 text-corpo text-ink-muted">
          <input
            type="checkbox"
            name="isPaid"
            defaultChecked={transaction?.is_paid ?? true}
            className="h-4 w-4 rounded border-line-strong"
          />
          Já pago / recebido
        </label>
      )}

      <ErrorText message={error} />
      <Actions
        pending={pending}
        label={parcelado ? `Registrar ${numeroDeParcelas}x` : "Salvar"}
        onCancel={onCancel}
      />
    </form>
  );
}

/* --------------------------------------------------------- pagar a fatura */

export function StatementPaymentForm({
  card,
  accounts,
  mesFaturaInicial,
  resumoDaFatura,
  onDone,
  onCancel,
}: {
  card: FinanceAccount;
  accounts: FinanceAccount[];
  /** Fatura sugerida — a que a tela do cartão está mostrando. */
  mesFaturaInicial: string;
  /** Lançado, já pago e em aberto na fatura de um mês. Tudo em centavos. */
  resumoDaFatura: (mesFatura: string) => ResumoDeFatura;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mesFatura, setMesFatura] = useState(mesFaturaInicial);

  /*
    A lista de meses começa no mês exibido e vai para a FRENTE, nunca para trás.

    Não é limitação de tela, é limite do que dá para somar sem mentir: o snapshot
    carrega o mês exibido, o anterior e TODAS as linhas futuras de cartão. A
    fatura de um mês anterior ao exibido dependeria de compras de dois meses
    atrás, que não estão carregadas — o total viria menor que o real e o valor
    sugerido faria a pessoa pagar menos do que deve, sem nenhum aviso. Para
    pagar uma fatura antiga, navegue até o mês dela no topo da página.
  */
  const mesesDisponiveis = useMemo(() => {
    const lista: string[] = [];
    let cursor = mesFaturaInicial;
    for (let i = 0; i < 6; i++) {
      lista.push(cursor);
      cursor = nextMonthIso(cursor);
    }
    return lista;
  }, [mesFaturaInicial]);

  const resumo = resumoDaFatura(mesFatura);
  /*
    O que se sugere pagar é o SALDO DEVEDOR (`openCents`), nunca o total lançado.

    Pagamento parcial e pagamento do mínimo são rotina — é o próprio motivo de o
    campo ser editável. Sugerir de novo o total bruto depois de um pagamento
    parcial de R$ 500 numa fatura de R$ 1.200 faria sair R$ 1.700 da conta
    corrente por uma dívida de R$ 1.200: o cartão ficaria com R$ 500 de crédito a
    favor e a conta drenada. `openCents` pode ser negativo (fatura paga a maior);
    o piso em zero é aplicado aqui, na borda da UI, porque "pagar menos que nada"
    não existe — mas o número real continua visível no rodapé do campo.

    Guardamos o mês junto do texto para saber se o que está no campo ainda
    pertence ao mês escolhido: trocar de fatura repõe a sugestão, em vez de
    deixar o valor da fatura anterior num formulário que agora fala de outra.
    Inicializador em função para `resumoDaFatura` — que varre os lançamentos —
    não rodar de novo a cada tecla digitada.
  */
  const [valorPorMes, setValorPorMes] = useState<{ mes: string; texto: string }>(() => ({
    mes: mesFaturaInicial,
    texto: formatCentsPlain(Math.max(0, resumoDaFatura(mesFaturaInicial).openCents)),
  }));
  const valor =
    valorPorMes.mes === mesFatura
      ? valorPorMes.texto
      : formatCentsPlain(Math.max(0, resumo.openCents));

  // Origem: nunca outro cartão (pagar cartão com cartão é troca de dívida, e o
  // modelo de duas pernas não sabe representar isso — a action também recusa),
  // e nunca o próprio cartão.
  const origens = accounts.filter((a) => a.id !== card.id && a.kind !== "credit_card");

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const cents = parseBRLToCents(valor);
    if (cents == null || cents <= 0) {
      setError("Informe um valor válido, ex.: 1.234,56");
      return;
    }
    start(async () => {
      const r = await payStatement({
        cardAccountId: card.id,
        fromAccountId: String(fd.get("fromAccountId") ?? ""),
        mesFatura,
        amountCents: cents,
        occurredOn: String(fd.get("occurredOn") ?? ""),
      });
      if (r.ok) {
        toast("Pagamento da fatura registrado", "success");
        onDone();
      } else setError(r.error ?? "Erro");
    });
  }

  if (origens.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-corpo text-ink-muted">
          Não há de onde tirar o dinheiro: cadastre uma conta corrente, poupança ou dinheiro
          para poder pagar a fatura. Cartão não paga cartão.
        </p>
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" type="button" onClick={onCancel}>
            Fechar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-corpo text-ink-subtle">
        Gera dois lançamentos ligados: a saída na conta escolhida e a entrada no cartão. Não
        conta como despesa nos totais do mês — a despesa já foi contada em cada compra.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Pagar com">
          <select name="fromAccountId" required className={inputCls}>
            <option value="">Selecione…</option>
            {origens.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Fatura"
          hint="Para pagar uma fatura anterior, navegue até o mês dela no topo da página."
        >
          <select
            value={mesFatura}
            onChange={(e) => setMesFatura(e.target.value)}
            className={`${inputCls} capitalize`}
          >
            {mesesDisponiveis.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Valor (R$)"
          // Com pagamento já registrado, o rodapé mostra os três números: o que
          // veio na fatura, o que já saiu e o que falta. Mostrar só o total faria
          // o campo pré-preenchido (o que falta) parecer errado.
          hint={
            resumo.paidCents !== 0
              ? `Fatura de ${monthLabel(mesFatura)}: ${formatBRL(resumo.totalCents)} · já pago ${formatBRL(resumo.paidCents)} · em aberto ${formatBRL(resumo.openCents)}`
              : `Fatura de ${monthLabel(mesFatura)}: ${formatBRL(resumo.totalCents)}`
          }
        >
          <input
            value={valor}
            onChange={(e) => setValorPorMes({ mes: mesFatura, texto: e.target.value })}
            inputMode="decimal"
            required
            placeholder="0,00"
            className={inputCls}
          />
        </Field>
        <Field label="Data do pagamento">
          <input name="occurredOn" type="date" required defaultValue={today()} className={inputCls} />
        </Field>
      </div>

      <ErrorText message={error} />
      <Actions pending={pending} label="Pagar fatura" onCancel={onCancel} />
    </form>
  );
}

/* ----------------------------------------------------------- transferência */

export function TransferForm({
  accounts,
  onDone,
  onCancel,
}: {
  accounts: FinanceAccount[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const cents = parseBRLToCents(amount);
    if (cents == null || cents <= 0) {
      setError("Informe um valor válido.");
      return;
    }
    start(async () => {
      const r = await createTransfer({
        fromAccountId: String(fd.get("fromAccountId") ?? ""),
        toAccountId: String(fd.get("toAccountId") ?? ""),
        amountCents: cents,
        description: String(fd.get("description") ?? "Transferência"),
        occurredOn: String(fd.get("occurredOn") ?? ""),
      });
      if (r.ok) {
        toast("Transferência registrada", "success");
        onDone();
      } else setError(r.error ?? "Erro");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-corpo text-ink-subtle">
        Gera dois lançamentos ligados (saída e entrada). Não conta como receita
        nem despesa nos totais.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="De">
          <select name="fromAccountId" required className={inputCls}>
            <option value="">Selecione…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Para">
          <select name="toAccountId" required className={inputCls}>
            <option value="">Selecione…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Valor (R$)">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            required
            placeholder="0,00"
            className={inputCls}
          />
        </Field>
        <Field label="Data">
          <input name="occurredOn" type="date" required defaultValue={today()} className={inputCls} />
        </Field>
      </div>
      <Field label="Descrição">
        <input name="description" required defaultValue="Transferência" className={inputCls} />
      </Field>
      <ErrorText message={error} />
      <Actions pending={pending} label="Transferir" onCancel={onCancel} />
    </form>
  );
}

/* ------------------------------------------------------------------ conta */

export function AccountForm({
  account,
  onDone,
  onCancel,
}: {
  account: FinanceAccount | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState(
    account ? formatCentsPlain(account.opening_balance_cents) : "0,00",
  );
  // O tipo virou estado porque a interface reage a ele: cartão revela três
  // campos que nenhuma outra conta tem.
  const [kind, setKind] = useState<FinanceAccountKind>(account?.kind ?? "checking");
  const [limite, setLimite] = useState(
    account?.credit_limit_cents != null ? formatCentsPlain(account.credit_limit_cents) : "",
  );
  const [fechamento, setFechamento] = useState(
    account?.statement_closing_day != null ? String(account.statement_closing_day) : "",
  );
  const [vencimento, setVencimento] = useState(
    account?.payment_due_day != null ? String(account.payment_due_day) : "",
  );

  const ehCartao = kind === "credit_card";

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const cents = parseBRLToCents(balance) ?? 0;

    /*
      Os três campos do cartão viram `null` fora de cartão, e `null` NÃO é o
      mesmo que omitir: omitido significa "não mexi neste campo", null significa
      "apague". Mandando null, trocar o tipo de cartão para conta corrente limpa
      o limite de verdade, em vez de deixar um limite fantasma esperando o dia em
      que alguém volte o tipo para cartão e o herde sem perceber.
    */
    let creditLimitCents: number | null = null;
    let statementClosingDay: number | null = null;
    let paymentDueDay: number | null = null;

    if (ehCartao) {
      // Validação local só para dar a mensagem no campo certo e evitar a ida ao
      // servidor. A barreira que vale é o schema + o CHECK do banco.
      creditLimitCents = parseBRLToCents(limite);
      if (creditLimitCents == null || creditLimitCents <= 0) {
        setError("Informe o limite do cartão, ex.: 5.000,00");
        return;
      }
      statementClosingDay = Number(fechamento);
      if (!Number.isInteger(statementClosingDay) || statementClosingDay < 1 || statementClosingDay > 31) {
        setError("Informe o dia em que a fatura fecha (1 a 31).");
        return;
      }
      paymentDueDay = Number(vencimento);
      if (!Number.isInteger(paymentDueDay) || paymentDueDay < 1 || paymentDueDay > 31) {
        setError("Informe o dia em que a fatura vence (1 a 31).");
        return;
      }
    }

    start(async () => {
      const r = await upsertAccount({
        id: account?.id,
        name: String(fd.get("name") ?? ""),
        kind,
        institution: String(fd.get("institution") ?? ""),
        openingBalanceCents: cents,
        colorKey: "stone",
        creditLimitCents,
        statementClosingDay,
        paymentDueDay,
      });
      if (r.ok) {
        toast("Conta salva", "success");
        onDone();
      } else setError(r.error ?? "Erro");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Nome">
        <input name="name" required defaultValue={account?.name ?? ""} className={inputCls} />
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Tipo">
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as FinanceAccountKind)}
            className={inputCls}
          >
            <option value="checking">Conta corrente</option>
            <option value="savings">Poupança</option>
            <option value="credit_card">Cartão de crédito</option>
            <option value="cash">Dinheiro</option>
            <option value="investment">Investimento</option>
            <option value="other">Outro</option>
          </select>
        </Field>
        <Field label="Instituição">
          <input name="institution" defaultValue={account?.institution ?? ""} className={inputCls} />
        </Field>
      </div>

      {ehCartao && (
        <div className="space-y-4 rounded-md border border-line bg-surface-muted p-3.5">
          <p className="text-legenda text-ink-subtle">
            Cartão não é conta: a compra não sai do bolso na data da compra, ela entra na fatura.
            Os três campos abaixo são o que define o ciclo — sem eles não dá para saber a que
            fatura uma compra pertence.
          </p>
          <Field label="Limite (R$)" hint="Ex.: 5.000,00">
            <input
              value={limite}
              onChange={(e) => setLimite(e.target.value)}
              inputMode="decimal"
              required
              placeholder="0,00"
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Dia do fechamento"
              hint="Compra feita nesse dia já entra na fatura seguinte."
            >
              <input
                type="number"
                min={1}
                max={31}
                step={1}
                value={fechamento}
                onChange={(e) => setFechamento(e.target.value)}
                required
                className={inputCls}
              />
            </Field>
            <Field label="Dia do vencimento" hint="Dia em que a fatura precisa ser paga.">
              <input
                type="number"
                min={1}
                max={31}
                step={1}
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
                required
                className={inputCls}
              />
            </Field>
          </div>
        </div>
      )}

      <Field
        label="Saldo inicial (R$)"
        hint={
          ehCartao
            ? "Fatura já em aberto antes do primeiro lançamento aqui. Use valor NEGATIVO: dívida derruba o saldo do cartão."
            : "Saldo antes do primeiro lançamento registrado aqui."
        }
      >
        <input
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          inputMode="decimal"
          className={inputCls}
        />
      </Field>
      <ErrorText message={error} />
      <Actions pending={pending} label="Salvar" onCancel={onCancel} />
    </form>
  );
}

/* -------------------------------------------------------------- categoria */

export function CategoryForm({
  category,
  onDone,
  onCancel,
}: {
  category: FinanceCategory | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"income" | "expense">(category?.kind ?? "expense");

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await upsertCategory({
        id: category?.id,
        name: String(fd.get("name") ?? ""),
        kind,
        colorKey: "stone",
      });
      if (r.ok) {
        toast("Categoria salva", "success");
        onDone();
      } else setError(r.error ?? "Erro");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex gap-2">
        <PillButton active={kind === "expense"} onClick={() => setKind("expense")}>
          Despesa
        </PillButton>
        <PillButton active={kind === "income"} onClick={() => setKind("income")}>
          Receita
        </PillButton>
      </div>
      <Field label="Nome">
        <input name="name" required defaultValue={category?.name ?? ""} className={inputCls} />
      </Field>
      <ErrorText message={error} />
      <Actions pending={pending} label="Salvar" onCancel={onCancel} />
    </form>
  );
}

/* ------------------------------------------------------------------- tag */

export function TagForm({
  tag,
  onDone,
  onCancel,
}: {
  tag: FinanceTag | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await upsertTag({
        id: tag?.id,
        name: String(fd.get("name") ?? ""),
        colorKey: "stone",
      });
      if (r.ok) {
        toast("Etiqueta salva", "success");
        onDone();
      } else setError(r.error ?? "Erro");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Nome" hint="Ex.: fatura, reembolso, viagem.">
        <input name="name" required defaultValue={tag?.name ?? ""} className={inputCls} />
      </Field>
      <ErrorText message={error} />
      <Actions pending={pending} label="Salvar" onCancel={onCancel} />
    </form>
  );
}

/* -------------------------------------------------------------- orçamento */

export function BudgetForm({
  categories,
  month,
  onDone,
  onCancel,
}: {
  categories: FinanceCategory[];
  month: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState("");

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const cents = parseBRLToCents(limit);
    if (cents == null || cents <= 0) {
      setError("Informe um limite válido.");
      return;
    }
    start(async () => {
      const r = await upsertBudget({
        categoryId: String(fd.get("categoryId") ?? ""),
        month,
        limitCents: cents,
      });
      if (r.ok) {
        toast("Orçamento definido", "success");
        onDone();
      } else setError(r.error ?? "Erro");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Categoria de despesa">
        <select name="categoryId" required className={inputCls}>
          <option value="">Selecione…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Limite mensal (R$)">
        <input
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          inputMode="decimal"
          required
          placeholder="0,00"
          className={inputCls}
        />
      </Field>
      <ErrorText message={error} />
      <Actions pending={pending} label="Definir" onCancel={onCancel} />
    </form>
  );
}
