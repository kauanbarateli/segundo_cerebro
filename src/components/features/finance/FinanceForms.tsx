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
import { parseBRLToCents, formatCentsPlain, formatBRL, monthLabel, plural, cn } from "@/lib/utils";
import {
  CHAVES_DE_COR,
  NOME_DA_COR,
  ehChaveDeCor,
  tomDaCor,
  type ChaveDeCor,
} from "@/lib/finance-colors";
import { calcularEncargos, faturaDoEncargo, parcelas, type ResumoDeFatura } from "@/lib/credit";
import { nextMonthIso } from "@/lib/finance";
import {
  upsertAccount,
  upsertCategory,
  upsertTag,
  upsertTransaction,
  createTransfer,
  createInstallmentPurchase,
  createRecurringSeries,
  payStatement,
  payTransaction,
  upsertBudget,
} from "@/app/(app)/financeiro/actions";

const inputCls =
  "h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink";

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
    <p role="alert" className="text-corpo text-danger-ink">
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

/**
 * Escolha de cor — oito discos, nada de seletor de matiz livre.
 *
 * A paleta é FECHADA porque ela é medida: cada tom tem contraste conferido nos
 * dois temas (ver globals.css). Um seletor livre deixaria a pessoa escolher um
 * amarelo-claro que some no tema claro, e o defeito só apareceria para ela.
 *
 * ⚠️ O nome da cor vai no `aria-label`, e a cor selecionada é dita por
 * `aria-checked` — não pela moldura. Um seletor em que só a borda indica a
 * escolha é inutilizável sem enxergar cor, que é justamente o público para quem
 * a escolha de cor menos importa e a leitura mais.
 */
function SeletorDeCor({
  valor,
  onChange,
}: {
  valor: ChaveDeCor;
  onChange: (cor: ChaveDeCor) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Cor" className="flex flex-wrap gap-1">
      {CHAVES_DE_COR.map((cor) => {
        const tom = tomDaCor(cor);
        const ativo = valor === cor;
        return (
          <button
            key={cor}
            type="button"
            role="radio"
            aria-checked={ativo}
            aria-label={NOME_DA_COR[cor]}
            onClick={() => onChange(cor)}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-full border-2",
              ativo ? tom.borda : "border-transparent hover:border-line-strong",
            )}
          >
            <span aria-hidden className={cn("h-5 w-5 rounded-full", tom.fundo)} />
          </button>
        );
      })}
    </div>
  );
}

/** A cor gravada, ou `stone` quando o banco tem algo fora da paleta. */
function corInicial(chave: string | null | undefined): ChaveDeCor {
  return ehChaveDeCor(chave) ? chave : "stone";
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
  const [installments, setInstallments] = useState("2");
  const [repeticao, setRepeticao] = useState<"unica" | "parcelado" | "recorrente">("unica");

  const visibleCategories = categories.filter((c) => c.kind === kind);

  const contaSelecionada = accounts.find((a) => a.id === accountId) ?? null;
  /*
    ⚠️ "JÁ PAGO / RECEBIDO" NÃO SE APLICA A CARTÃO DE CRÉDITO.

    São DUAS perguntas que a caixa única fundia numa só:

      a dívida existe?      -> em cartão, SEMPRE, desde o instante da compra
      a FATURA foi paga?    -> outra pergunta, respondida por `statement_month`
                               mais o lançamento de pagamento (ehPagamentoDeFatura)

    Desmarcar a caixa numa compra de cartão é o gesto natural ("a fatura nem
    fechou, não paguei isso ainda") e era exatamente o que apagava a dívida do
    sistema: a view `finance_account_balances` junta as transações com
    `and t.is_paid = true` (0005:267, mantido na 0010:431), então a linha não
    entrava em `balance_cents`, `debt_cents` continuava zero e `available_cents`
    não se movia. O limite do cartão nunca era consumido.

    O caminho PARCELADO já tinha percebido isso e forçava `is_paid: true` com a
    explicação certa na tela (ver o texto do rodapé, mais abaixo). A correção é
    estender o que já existe, não inventar regra nova — quando dois caminhos do
    mesmo formulário divergem, normalmente um deles já está certo.

    Em conta corrente a caixa CONTINUA fazendo sentido: despesa agendada e ainda
    não debitada é um estado real. A regra vale só para `credit_card`.
  */
  const ehCartao = contaSelecionada?.kind === "credit_card";
  /** Já saiu parte do dinheiro, mas não tudo — ver o bloco no rodapé do form. */
  const parcialmentePago =
    transaction !== null &&
    transaction.paid_cents > 0 &&
    transaction.paid_cents < transaction.amount_cents;
  /*
    Parcelar só faz sentido em DESPESA de CARTÃO e só na CRIAÇÃO.

    Edição fica de fora porque `createInstallmentPurchase` cria N linhas novas:
    transformar um lançamento existente em parcelamento exigiria apagar o
    original e recriar, e um erro no meio deixaria a compra duplicada. Quem
    precisa disso exclui e lança de novo — explicitamente.
  */
  /*
    ⚠️ TRÊS FORMAS DE REPETIR, E DUAS DELAS SÃO OPOSTAS NO BALANÇO.

      única        um lançamento
      parcelado    um TOTAL dividido em N — é DÍVIDA inteira desde a compra
      recorrente   o MESMO valor N vezes — NÃO é dívida, é compromisso

    "12× de R$ 2.000 no sofá" é dívida de R$ 24.000 desde o dia da compra; "12×
    aluguel de R$ 2.000" não é dívida nenhuma — saindo do imóvel no terceiro mês,
    os outros nove não acontecem. A linha que separa não é a duração: é se a
    contrapartida já foi entregue.

    Por isso as duas são escolhas EXPLÍCITAS na tela, e não um mesmo campo com
    significado dependente de outro. O rótulo do valor muda junto ("Valor TOTAL"
    contra "Valor de cada"), porque é aí que a confusão vira dinheiro errado.

    PARCELAMENTO deixou de ser exclusivo do cartão: carnê e crediário são
    parcelamento tanto quanto, e a dívida se comporta igual. O que muda fora do
    cartão é `is_paid` — ver `createInstallmentPurchase`.
  */
  const podeRepetir = transaction === null && kind === "expense" && contaSelecionada !== null;
  // Recorrência não vai em cartão: lá o gatilho da 0023 força `is_paid = true`, e
  // as ocorrências futuras consumiriam limite que o cartão ainda não
  // comprometeu. A action recusa; aqui a opção nem aparece.
  const podeRecorrer = podeRepetir && !ehCartao;
  const repeticaoEfetiva = repeticao === "recorrente" && !podeRecorrer ? "unica" : repeticao;

  const numeroDeParcelas = Number(installments);
  const parcelasValidas =
    Number.isInteger(numeroDeParcelas) && numeroDeParcelas >= 1 && numeroDeParcelas <= MAX_PARCELAS;
  const parcelado =
    podeRepetir && repeticaoEfetiva === "parcelado" && parcelasValidas && numeroDeParcelas > 1;
  const recorrente =
    podeRecorrer && repeticaoEfetiva === "recorrente" && parcelasValidas && numeroDeParcelas > 1;
  const emSerie = parcelado || recorrente;

  /*
    Editando uma OCORRÊNCIA de série: o problema clássico de agenda. "Só esta" é
    o padrão porque é o único sem efeito colateral; "todas" reescreve mês já
    fechado e conferido, e por isso diz quantos são antes de deixar salvar.
  */
  const daSerie = transaction?.installment_group_id != null;
  const anteriores = (transaction?.installment_no ?? 1) - 1;
  const [escopo, setEscopo] = useState<"esta" | "futuras" | "todas">("esta");

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
    if (podeRepetir && repeticaoEfetiva !== "unica" && !parcelasValidas) {
      setError(`Informe o número de vezes, de 2 a ${MAX_PARCELAS}.`);
      return;
    }

    if (recorrente) {
      start(async () => {
        // Aqui `cents` é o valor de CADA ocorrência — não um total a dividir. É
        // a diferença que o rótulo do campo declara e que `serie_tipo` grava.
        const r = await createRecurringSeries({
          accountId,
          categoryId: String(fd.get("categoryId") ?? ""),
          description: String(fd.get("description") ?? ""),
          amountCents: cents,
          ocorrencias: numeroDeParcelas,
          occurredOn: String(fd.get("occurredOn") ?? ""),
          tagIds: selectedTags,
        });
        if (r.ok) {
          toast(`Recorrência de ${numeroDeParcelas} meses criada`, "success");
          onDone();
        } else setError(r.error ?? "Erro ao salvar");
      });
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
        // Em cartão a caixa não é renderizada, e `fd.get("isPaid")` viria null —
        // ou seja, `false`, que é justamente o valor que apaga a dívida. O
        // `true` explícito é o mesmo que o caminho parcelado já grava. A action
        // reforça isso do lado do servidor: formulário é conveniência, a regra
        // não pode depender do que o cliente manda.
        isPaid: ehCartao ? true : fd.get("isPaid") === "on",
        tagIds: selectedTags,
        // Só tem efeito quando a linha pertence a uma série; a action ignora
        // fora disso, porque sem `installment_group_id` não há irmãs a alcançar.
        escopo,
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
        {/*
          ⚠️ O RÓTULO DO VALOR MUDA COM A REPETIÇÃO, e é aí que a confusão vira
          dinheiro errado: em parcelamento o campo é o TOTAL a dividir; em
          recorrência é o valor de CADA mês. Um rótulo genérico ("Valor") faria
          "12× R$ 2.000" significar R$ 24.000 para um e R$ 166,67 para o outro,
          com a mesma aparência na tela.
        */}
        <Field
          label={
            parcelado
              ? "Valor TOTAL da compra (R$)"
              : recorrente
                ? "Valor de CADA mês (R$)"
                : "Valor (R$)"
          }
          hint="Ex.: 1.234,56"
        >
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            required
            placeholder="0,00"
            className={inputCls}
          />
        </Field>
        <Field label={parcelado ? "Data da compra" : recorrente ? "Primeira ocorrência" : "Data"}>
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

      {podeRepetir && (
        <div className="space-y-3 rounded-md border border-line bg-surface-muted p-3.5">
          <div>
            <p className="mb-1.5 text-corpo font-medium text-ink">Repetição</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Repetição">
              <PillButton
                active={repeticaoEfetiva === "unica"}
                onClick={() => setRepeticao("unica")}
              >
                Única
              </PillButton>
              <PillButton
                active={repeticaoEfetiva === "parcelado"}
                onClick={() => setRepeticao("parcelado")}
              >
                Parcelado
              </PillButton>
              {/*
                Recorrência não aparece em cartão, e o motivo fica escrito logo
                abaixo. Oferecer e recusar depois seria pior que não oferecer.
              */}
              {podeRecorrer && (
                <PillButton
                  active={repeticaoEfetiva === "recorrente"}
                  onClick={() => setRepeticao("recorrente")}
                >
                  Recorrente
                </PillButton>
              )}
            </div>
          </div>

          {ehCartao && (
            <p className="text-legenda text-ink-subtle">
              Recorrência não vai em cartão: cada ocorrência futura consumiria limite que o cartão
              ainda não comprometeu. Assinatura no cartão? Lance na conta de onde a fatura é paga.
            </p>
          )}

          {repeticaoEfetiva !== "unica" && (
            <Field
              label={parcelado ? "Parcelas" : "Meses"}
              hint={
                parcelado
                  ? "O valor acima é o TOTAL da compra, dividido entre elas."
                  : "O valor acima se repete inteiro em cada mês."
              }
            >
              <input
                type="number"
                min={2}
                max={MAX_PARCELAS}
                step={1}
                value={installments}
                onChange={(e) => setInstallments(e.target.value)}
                className={inputCls}
              />
            </Field>
          )}

          {/*
            ⚠️ A FRASE QUE SEPARA AS DUAS, dita em dinheiro e não em jargão. É o
            único ponto da tela em que "isto é dívida" e "isto não é" aparecem
            lado a lado — e é a diferença que o Painel vai refletir depois.
          */}
          {recorrente && parcelasValidas && centavos != null && centavos > 0 && (
            <p aria-live="polite" className="text-corpo text-ink">
              {numeroDeParcelas}× de {formatBRL(centavos)} ={" "}
              <span className="font-medium">{formatBRL(centavos * numeroDeParcelas)}</span>{" "}
              comprometidos.
              <span className="text-ink-subtle">
                {" "}
                Isso NÃO é dívida — entra em &quot;Compromissos futuros&quot;, e some se você
                encerrar a recorrência.
              </span>
            </p>
          )}
        </div>
      )}

      {previa && (
        <div
          className="rounded-md border border-line bg-surface-muted px-3 py-2.5 text-corpo"
          // `polite` e não `assertive`: a prévia muda a cada tecla no valor;
          // interromper o leitor de tela a cada dígito seria hostil.
          aria-live="polite"
        >
          {previa.erro ? (
            <span className="text-danger-ink">
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
        ⚠️ EDITANDO UMA OCORRÊNCIA DE SÉRIE — o problema clássico de agenda.

        "Só esta" é o padrão porque é o único sem efeito colateral. "Todas"
        alcança mês JÁ FECHADO e conferido contra o extrato, e por isso a opção
        diz quantos são antes de ser escolhida — o número é o aviso.

        Só VALOR e CATEGORIA se propagam (e a descrição, em recorrência). Data e
        estado de pagamento nunca: são o que distingue uma ocorrência da outra.
      */}
      {daSerie && (
        <div className="space-y-2 rounded-md border border-line bg-surface-muted p-3.5">
          <p className="text-corpo font-medium text-ink">Esta alteração vale para</p>
          <div role="radiogroup" aria-label="Alcance da alteração" className="space-y-1.5">
            {(
              [
                ["esta", "Só esta ocorrência"],
                ["futuras", "Esta e as futuras"],
                [
                  "todas",
                  anteriores > 0
                    ? `Todas — inclusive ${plural(anteriores, "mês já fechado", "meses já fechados")}`
                    : "Todas as ocorrências",
                ],
              ] as const
            ).map(([valor, rotulo]) => (
              <label key={valor} className="flex items-center gap-2 text-corpo text-ink-muted">
                <input
                  type="radio"
                  name="escopo"
                  checked={escopo === valor}
                  onChange={() => setEscopo(valor)}
                  className="h-4 w-4 border-line-strong"
                />
                <span className={valor === "todas" && anteriores > 0 ? "text-warning-ink" : ""}>
                  {rotulo}
                </span>
              </label>
            ))}
          </div>
          <p className="text-legenda text-ink-subtle">
            {transaction?.serie_tipo === "recorrencia"
              ? "Propaga valor, categoria e descrição. A data de cada ocorrência não muda."
              : "Propaga valor e categoria. A descrição fica só nesta — em parcelamento ela carrega o número da parcela."}
          </p>
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

      {emSerie ? (
        <p className="text-legenda text-ink-subtle">
          {parcelado
            ? ehCartao
              ? `Serão criados ${numeroDeParcelas} lançamentos, um por mês, todos marcados como pagos — a dívida no cartão existe por inteiro desde a compra.`
              : `Serão criados ${numeroDeParcelas} lançamentos, um por mês, nenhum marcado como pago: o dinheiro ainda não saiu da conta. A dívida aparece por inteiro assim mesmo — a contrapartida já foi entregue.`
            : `Serão criados ${numeroDeParcelas} lançamentos, um por mês, nenhum pago. Use "Pagar" em cada um conforme o dinheiro sair.`}
        </p>
      ) : ehCartao ? (
        /*
          A caixa dá lugar à FRASE. Escondê-la sem dizer nada deixaria a pessoa
          procurando o campo que sumiu; a linha explica a regra usando o mesmo
          argumento que o caminho parcelado já usava logo acima.
        */
        <p className="text-legenda text-ink-subtle">
          A dívida no cartão existe desde a compra — este lançamento já consome o limite. O
          pagamento é registrado na fatura, em Contas.
        </p>
      ) : parcialmentePago ? (
        /*
          ⚠️ A CAIXA SAI QUANDO EXISTE PAGAMENTO PARCIAL, e isso protege o dado.

          "Já pago / recebido" só sabe dizer tudo ou nada. Mostrá-la aqui
          ofereceria duas escolhas destrutivas — marcar quitaria o que ainda se
          deve, desmarcar apagaria o que já saiu da conta — e as duas pareceriam
          inofensivas. A action também preserva o valor por conta própria; esta
          linha é a metade que explica por quê.
        */
        <p className="text-legenda text-ink-subtle">
          Pago {formatBRL(transaction!.paid_cents)} de {formatBRL(transaction!.amount_cents)}. Para
          registrar mais um pagamento, use <span className="font-medium text-ink">Pagar</span> na
          lista de lançamentos — editar aqui não mexe no que já foi pago.
        </p>
      ) : (
        <label className="flex items-center gap-2 text-corpo text-ink-muted">
          <input
            type="checkbox"
            name="isPaid"
            defaultChecked={transaction?.is_paid ?? true}
            className="h-4 w-4 rounded-xs border-line-strong"
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

  /*
    ========================================================================
    ROTATIVO — o que a tela precisa dizer, e o que ela NÃO deve fazer
    ========================================================================
    Pagar parcialmente já funcionava no NÚMERO (basta pôr um valor menor e a
    fatura fica com `openCents > 0`). O que faltava era tudo o que transforma
    isso numa decisão informada: o que acontece com o resto, quanto custa, e
    quando a conta chega.

    ⚠️ A TAXA COMEÇA VAZIA E CONTINUA VAZIA. Não há sugestão, nem "taxa média do
    mercado", nem memória da última usada. O rotativo varia por emissor e por
    contrato; um número nosso apareceria com a mesma cara de um número dele, e a
    previsão errada seria indistinguível da certa.
  */
  const [pagoEm, setPagoEm] = useState(today());
  const [taxa, setTaxa] = useState("");
  const [iof, setIof] = useState("");

  const centavosDoPagamento = parseBRLToCents(valor) ?? 0;
  // Aceita "12,5" e "12.5": o teclado do celular oferece um separador e o do
  // desktop, outro. Recusar um dos dois seria recusar metade dos usuários.
  const taxaNumero = taxa.trim() === "" ? 0 : Number(taxa.trim().replace(",", "."));
  const taxaValida = Number.isFinite(taxaNumero) && taxaNumero >= 0 && taxaNumero <= 100;
  const iofCents = iof.trim() === "" ? 0 : (parseBRLToCents(iof) ?? 0);

  /** O que sobra da fatura DEPOIS deste pagamento. */
  const restanteCents = Math.max(0, resumo.openCents - centavosDoPagamento);

  const encargos = calcularEncargos({
    saldoRemanescenteCents: restanteCents,
    // `calcularEncargos` LANÇA para taxa negativa ou não-numérica. A prévia não
    // pode derrubar o formulário enquanto a pessoa digita "1," — por isso o
    // valor inválido vira zero aqui e a recusa fica no envio, com mensagem.
    taxaMensalPercent: taxaValida ? taxaNumero : 0,
    iofCents: iofCents < 0 ? 0 : iofCents,
  });

  const diaFechamento = card.statement_closing_day;
  const mesDoEncargo =
    diaFechamento != null && diaFechamento >= 1 && diaFechamento <= 31
      ? faturaDoEncargo(mesFatura, pagoEm, diaFechamento)
      : null;

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
    if (!taxaValida) {
      setError("Taxa de juros inválida: informe um número entre 0 e 100 (% ao mês).");
      return;
    }
    if (iof.trim() !== "" && (iofCents == null || iofCents < 0)) {
      setError("IOF inválido, ex.: 12,34");
      return;
    }
    start(async () => {
      const r = await payStatement({
        cardAccountId: card.id,
        fromAccountId: String(fd.get("fromAccountId") ?? ""),
        mesFatura,
        amountCents: cents,
        occurredOn: pagoEm,
        taxaMensalPercent: taxaNumero,
        iofCents,
      });
      if (r.ok) {
        toast(
          encargos.totalCents > 0
            ? "Pagamento registrado, com os encargos na próxima fatura"
            : "Pagamento da fatura registrado",
          "success",
        );
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
          <input
            type="date"
            required
            value={pagoEm}
            onChange={(e) => setPagoEm(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      {/*
        ⚠️ OS CAMPOS DE ENCARGO SÓ APARECEM QUANDO SOBRA SALDO.

        Quitando a fatura inteira não há rotativo, e um campo "taxa de juros"
        numa tela de pagamento integral é um convite a preencher algo que não se
        aplica — e a gerar uma despesa de juros que não existe.
      */}
      {restanteCents > 0 && (
        <div className="space-y-4 rounded-md border border-line bg-surface-muted p-3.5">
          <p className="text-legenda text-ink-subtle">
            Este pagamento não quita a fatura: restam{" "}
            <span className="font-medium text-ink">{formatBRL(restanteCents)}</span>. O saldo
            continua nesta fatura, em aberto —{" "}
            <span className="font-medium text-ink">não vira lançamento novo</span>, porque essa
            despesa já foi contada em cada compra. O que é custo novo são os juros.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Juros do rotativo (% ao mês)"
              hint="O que o seu cartão cobra. Deixe vazio se não houver."
            >
              <input
                value={taxa}
                onChange={(e) => setTaxa(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                className={inputCls}
              />
            </Field>
            <Field label="IOF e outros encargos (R$)" hint="Opcional.">
              <input
                value={iof}
                onChange={(e) => setIof(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                className={inputCls}
              />
            </Field>
          </div>

          {/*
            `polite` e não `assertive`: a prévia muda a cada tecla na taxa, e
            interromper o leitor de tela a cada dígito seria hostil. É a mesma
            escolha da prévia de parcelamento.
          */}
          <p aria-live="polite" className="text-corpo">
            {!taxaValida ? (
              <span className="text-danger-ink">
                Taxa inválida: informe um número entre 0 e 100. Se a sua é 12,5% ao mês, digite
                12,5 — não 1250.
              </span>
            ) : encargos.totalCents === 0 ? (
              <span className="text-ink-subtle">
                Sem taxa informada, nada de juros é lançado. O saldo apenas continua em aberto.
              </span>
            ) : (
              <span className="text-ink">
                {encargos.jurosCents > 0 && (
                  <>
                    {taxaNumero.toLocaleString("pt-BR")}% sobre {formatBRL(restanteCents)} ={" "}
                    <span className="font-medium">{formatBRL(encargos.jurosCents)}</span> de juros
                    {encargos.iofCents > 0 && <> mais {formatBRL(encargos.iofCents)} de IOF</>}.{" "}
                  </>
                )}
                {encargos.jurosCents === 0 && encargos.iofCents > 0 && (
                  <>{formatBRL(encargos.iofCents)} de IOF. </>
                )}
                {mesDoEncargo ? (
                  <>
                    Um lançamento de{" "}
                    <span className="font-medium">{formatBRL(encargos.totalCents)}</span> entra na
                    fatura de <span className="capitalize">{monthLabel(mesDoEncargo)}</span>.
                  </>
                ) : (
                  <span className="text-warning-ink">
                    Sem dia de fechamento cadastrado não dá para saber em que fatura os juros
                    caem — edite o cartão antes de registrar.
                  </span>
                )}
              </span>
            )}
          </p>
        </div>
      )}

      <ErrorText message={error} />
      <Actions pending={pending} label="Pagar fatura" onCancel={onCancel} />
    </form>
  );
}

/* ------------------------------------------------- pagar um lançamento */

/**
 * PAGAR UM LANÇAMENTO — total ou em parte.
 *
 * ⚠️ NÃO HÁ CAMPO "PAGAR COM", e a ausência é a decisão. Um lançamento avulso já
 * está NA conta de onde o dinheiro sai; pagá-lo é registrar que ele saiu dali. A
 * fatura precisa de conta de origem porque vive no cartão e o dinheiro tem que
 * vir de fora — aqui, um seletor seria um no-op ou criaria uma transferência que
 * contaria a saída duas vezes.
 *
 * ⚠️ E O RESTANTE NÃO VIRA LANÇAMENTO NOVO. Ele já foi contado quando a despesa
 * foi lançada; o que muda é `paid_cents` na MESMA linha. Só os encargos são
 * despesa nova. É a mesma regra do rotativo de fatura.
 */
export function TransactionPaymentForm({
  transaction,
  onDone,
  onCancel,
}: {
  transaction: FinanceTransaction;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const restanteCents = Math.max(0, transaction.amount_cents - transaction.paid_cents);
  const ehDespesa = transaction.kind === "expense";

  const [valor, setValor] = useState(formatCentsPlain(restanteCents));
  const [pagoEm, setPagoEm] = useState(today());
  const [taxa, setTaxa] = useState("");
  const [iof, setIof] = useState("");

  const centavos = parseBRLToCents(valor) ?? 0;
  const taxaNumero = taxa.trim() === "" ? 0 : Number(taxa.trim().replace(",", "."));
  const taxaValida = Number.isFinite(taxaNumero) && taxaNumero >= 0 && taxaNumero <= 100;
  const iofCents = iof.trim() === "" ? 0 : (parseBRLToCents(iof) ?? 0);

  /** O que sobra DEPOIS deste pagamento. */
  const sobraCents = Math.max(0, restanteCents - centavos);

  const encargos = calcularEncargos({
    saldoRemanescenteCents: sobraCents,
    // Valor inválido vira zero na prévia e é recusado no envio, com mensagem: a
    // prévia não pode derrubar o formulário enquanto a pessoa digita "1,".
    taxaMensalPercent: taxaValida ? taxaNumero : 0,
    iofCents: iofCents < 0 ? 0 : iofCents,
  });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (centavos <= 0) {
      setError("Informe um valor válido, ex.: 1.234,56");
      return;
    }
    if (centavos > restanteCents) {
      setError(`Falta pagar apenas ${formatBRL(restanteCents)}.`);
      return;
    }
    if (!taxaValida) {
      setError("Taxa de juros inválida: informe um número entre 0 e 100 (% ao mês).");
      return;
    }
    start(async () => {
      const r = await payTransaction({
        transactionId: transaction.id,
        amountCents: centavos,
        occurredOn: pagoEm,
        taxaMensalPercent: taxaNumero,
        iofCents,
      });
      if (r.ok) {
        toast(
          centavos === restanteCents ? "Lançamento quitado" : "Pagamento parcial registrado",
          "success",
        );
        onDone();
      } else setError(r.error ?? "Erro");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-corpo text-ink-subtle">
        <span className="font-medium text-ink">{transaction.description}</span> ·{" "}
        {formatBRL(transaction.amount_cents)}
        {transaction.paid_cents > 0 && (
          <>
            {" "}
            · já {ehDespesa ? "pago" : "recebido"} {formatBRL(transaction.paid_cents)}
          </>
        )}
        {" · falta "}
        <span className="font-medium text-ink">{formatBRL(restanteCents)}</span>
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Valor (R$)" hint="Pode ser parcial — o resto continua em aberto.">
          <input
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            inputMode="decimal"
            required
            placeholder="0,00"
            className={inputCls}
          />
        </Field>
        <Field label={ehDespesa ? "Data do pagamento" : "Data do recebimento"}>
          <input
            type="date"
            required
            value={pagoEm}
            onChange={(e) => setPagoEm(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      {/*
        Os campos de encargo só existem quando SOBRA saldo e a linha é despesa.
        Quitando por inteiro não há juros a cobrar, e um campo de taxa numa tela
        de pagamento integral convida a preencher algo que não se aplica.
      */}
      {ehDespesa && sobraCents > 0 && (
        <div className="space-y-4 rounded-md border border-line bg-surface-muted p-3.5">
          <p className="text-legenda text-ink-subtle">
            Restam <span className="font-medium text-ink">{formatBRL(sobraCents)}</span>. O saldo
            continua NESTE lançamento, em aberto —{" "}
            <span className="font-medium text-ink">não vira lançamento novo</span>, porque essa
            despesa já foi contada quando você a registrou.
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Juros (% ao mês)" hint="Deixe vazio se não houver.">
              <input
                value={taxa}
                onChange={(e) => setTaxa(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                className={inputCls}
              />
            </Field>
            <Field label="IOF e outros encargos (R$)" hint="Opcional.">
              <input
                value={iof}
                onChange={(e) => setIof(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                className={inputCls}
              />
            </Field>
          </div>

          <p aria-live="polite" className="text-corpo">
            {!taxaValida ? (
              <span className="text-danger-ink">
                Taxa inválida: informe um número entre 0 e 100. Se a sua é 12,5% ao mês, digite
                12,5 — não 1250.
              </span>
            ) : encargos.totalCents === 0 ? (
              <span className="text-ink-subtle">
                Sem taxa informada, nada de juros é lançado. O saldo apenas continua em aberto.
              </span>
            ) : (
              <span className="text-ink">
                Um lançamento de{" "}
                <span className="font-medium">{formatBRL(encargos.totalCents)}</span> de encargos
                será criado na mesma conta, ainda não pago.
              </span>
            )}
          </p>
        </div>
      )}

      <ErrorText message={error} />
      <Actions
        pending={pending}
        label={centavos === restanteCents ? "Quitar" : "Registrar pagamento"}
        onCancel={onCancel}
      />
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
  const [cor, setCor] = useState<ChaveDeCor>(corInicial(account?.color_key));

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
        colorKey: cor,
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

      <Field label="Cor" hint="Para achar a conta na lista sem ler o nome inteiro.">
        <SeletorDeCor valor={cor} onChange={setCor} />
      </Field>

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
  const [cor, setCor] = useState<ChaveDeCor>(corInicial(category?.color_key));

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await upsertCategory({
        id: category?.id,
        name: String(fd.get("name") ?? ""),
        kind,
        colorKey: cor,
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
      {/* A cor da categoria é o que pinta a fatia da rosca no Painel. Sem
          escolha, todas nascem `stone` e o gráfico distribui uma cor por posição
          — que muda quando a ordem por valor muda. Ver `corDaPosicao`. */}
      <Field label="Cor" hint="Usada no gráfico de despesas por categoria.">
        <SeletorDeCor valor={cor} onChange={setCor} />
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
  const [cor, setCor] = useState<ChaveDeCor>(corInicial(tag?.color_key));

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await upsertTag({
        id: tag?.id,
        name: String(fd.get("name") ?? ""),
        colorKey: cor,
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
      <Field label="Cor" hint="Usada na lista de etiquetas do Painel.">
        <SeletorDeCor valor={cor} onChange={setCor} />
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
