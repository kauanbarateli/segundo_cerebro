import type {
  FinanceAccount,
  FinanceAccountBalance,
  FinanceTransaction,
  FinanceCategory,
  FinanceTag,
  FinanceBudget,
} from "@/lib/database.types";
import { patrimonioEDivida, somaMeses } from "@/lib/credit";

/**
 * Cálculos financeiros puros — sem I/O, testáveis.
 *
 * =============================================================================
 * DUAS REGRAS CENTRAIS
 * =============================================================================
 *
 * 1. TRANSFERÊNCIA NÃO É RECEITA NEM DESPESA. Cada transferência gera duas
 *    linhas (uma expense + uma income); somá-las contaria o mesmo dinheiro duas
 *    vezes e distorceria todo o dashboard.
 *
 * 2. ⚠️ O MÊS DE UM LANÇAMENTO DE CARTÃO É O DA FATURA, NÃO O DA COMPRA.
 *    Ver `mesDeCompetencia` logo abaixo — é a correção mais consequente deste
 *    arquivo, e a que muda números que já estavam na tela.
 */

/* ------------------------------------------------------------- competência */

/** O mínimo que este módulo precisa saber sobre uma conta. */
export type ContaParaCompetencia = Pick<FinanceAccount, "id" | "kind">;

/**
 * Os ids das contas que são cartão de crédito.
 *
 * Existe como função própria (e devolve `Set`) porque toda soma daqui precisa
 * dessa resposta uma vez POR LANÇAMENTO. Um `accounts.find(...)` dentro do laço
 * transformaria cada total num O(n·m) silencioso.
 */
export function cartoesDe(contas: ContaParaCompetencia[]): ReadonlySet<string> {
  return new Set(contas.filter((c) => c.kind === "credit_card").map((c) => c.id));
}

/** "2026-03-25" ou "2026-03-01" -> "2026-03-01". Sem `Date`: só a string. */
function mesCanonicoDe(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/**
 * A que MÊS um lançamento pertence, para efeito de soma. `null` quando não há
 * resposta honesta.
 *
 * =============================================================================
 * ⚠️ O DEFEITO QUE ESTA FUNÇÃO CORRIGE
 * =============================================================================
 * Todas as somas do Painel filtravam por `occurred_on` — a data em que a compra
 * aconteceu. Para cartão isso está errado, e o erro é grande: uma compra em
 * 25/03 num cartão que fecha dia 22 entra na FATURA DE ABRIL, que é quando o
 * dinheiro sai, mas era contada como despesa de MARÇO. O mês em que você viu o
 * número e o mês em que você pagou a conta eram diferentes.
 *
 * A coluna certa já existia: `statement_month` é gravada na criação desde a
 * 0010, com a mesma `faturaDe()` que a interface usa. O Painel simplesmente não
 * a consultava.
 *
 * Fora de cartão nada muda: `occurred_on` continua sendo a competência, porque
 * ali a compra e o débito são o mesmo evento.
 *
 * =============================================================================
 * `null` — O CASO QUE NÃO PODE SUMIR EM SILÊNCIO
 * =============================================================================
 * Um lançamento de cartão sem `statement_month` (cartão cadastrado sem dia de
 * fechamento, ou linha anterior à 0010) não pertence a fatura nenhuma. Devolver
 * `occurred_on` aqui seria voltar ao defeito para essas linhas; devolver `null`
 * as tira das somas — e por isso `foraDeCompetencia()` existe: quem exibe um
 * total precisa CONTAR essas linhas ao lado dele. Omitir sem avisar é o pior dos
 * três caminhos, porque produz um número menor que o real sem nenhum sinal.
 */
export function mesDeCompetencia(
  tx: Pick<FinanceTransaction, "account_id" | "occurred_on" | "statement_month">,
  cartoes: ReadonlySet<string>,
): string | null {
  if (!cartoes.has(tx.account_id)) return mesCanonicoDe(tx.occurred_on);
  return tx.statement_month === null ? null : mesCanonicoDe(tx.statement_month);
}

export interface ForaDeCompetencia {
  quantidade: number;
  /** Soma com sinal (expense soma, income subtrai) — o que não entrou em mês nenhum. */
  totalCents: number;
}

/**
 * Lançamentos de cartão que não caem em fatura nenhuma.
 *
 * Eles PESAM em `debt_cents` (a view só olha `is_paid`) e não aparecem em
 * nenhuma soma mensal. Sem este número ao lado dos totais, a dívida e a despesa
 * do mês divergem sem explicação — e a explicação é esta.
 */
export function foraDeCompetencia(
  txs: FinanceTransaction[],
  cartoes: ReadonlySet<string>,
): ForaDeCompetencia {
  let quantidade = 0;
  let totalCents = 0;
  for (const tx of txs) {
    if (!cartoes.has(tx.account_id)) continue;
    if (tx.statement_month !== null) continue;
    if (isTransfer(tx)) continue;
    quantidade++;
    totalCents += tx.kind === "expense" ? tx.amount_cents : -tx.amount_cents;
  }
  return { quantidade, totalCents };
}

export function isTransfer(tx: Pick<FinanceTransaction, "transfer_group_id" | "kind">): boolean {
  return tx.transfer_group_id !== null || tx.kind === "transfer";
}

/**
 * O lançamento cai em algum dos meses do período?
 *
 * ⚠️ `cartoes` é OBRIGATÓRIO, e não opcional com um padrão vazio. Um parâmetro
 * opcional aqui reintroduziria o defeito no primeiro ponto de uso novo que
 * esquecesse de passá-lo — e ele não falharia: só somaria no mês errado. A
 * decisão é a mesma de `paraCampoLocal(iso, formato)` em `tempo.ts`: o que era
 * um erro invisível vira um argumento no código.
 */
function noPeriodo(
  tx: FinanceTransaction,
  meses: ReadonlySet<string>,
  cartoes: ReadonlySet<string>,
): boolean {
  const mes = mesDeCompetencia(tx, cartoes);
  return mes !== null && meses.has(mes);
}

/** Normaliza a lista de meses para o formato canônico e sem repetição. */
function conjuntoDeMeses(meses: string[]): ReadonlySet<string> {
  return new Set(meses.map(mesCanonicoDe));
}

/* -------------------------------------------------------------- recortes */

export type Recorte = "mes" | "trimestre" | "ano";

export const ROTULO_DO_RECORTE: Record<Recorte, string> = {
  mes: "Mês",
  trimestre: "Trimestre",
  ano: "Ano",
};

export const RECORTES: Recorte[] = ["mes", "trimestre", "ano"];

/**
 * Lê o recorte da URL. Qualquer coisa fora da lista vira "mes".
 *
 * O recorte VIAJA NA URL, junto do mês, e não é estado local do componente: é o
 * servidor que decide quais meses carregar (ver `getFinanceAnalytics`), e um
 * alternador só no cliente pediria um ano de dados que não foram buscados — o
 * gráfico mostraria três meses rotulados como "ano", sem nada indicando.
 */
export function lerRecorte(valor: string | null | undefined): Recorte {
  return RECORTES.includes(valor as Recorte) ? (valor as Recorte) : "mes";
}

/**
 * Os meses que um recorte cobre, sempre em ordem cronológica.
 *
 * Trimestre e ano são os CIVIS (jan–mar, jan–dez), não os doze meses que
 * terminam no mês exibido. É o recorte com que as contas do mundo real são
 * fechadas, e o único em que "1º trimestre" quer dizer a mesma coisa para duas
 * pessoas.
 */
export function mesesDoRecorte(mesIso: string, recorte: Recorte): string[] {
  const canonico = mesCanonicoDe(mesIso);
  if (recorte === "mes") return [canonico];

  const ano = canonico.slice(0, 4);
  if (recorte === "ano") {
    return Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}-01`);
  }

  const mes = Number(canonico.slice(5, 7));
  const primeiro = Math.floor((mes - 1) / 3) * 3 + 1;
  return Array.from(
    { length: 3 },
    (_, i) => `${ano}-${String(primeiro + i).padStart(2, "0")}-01`,
  );
}

/**
 * O período imediatamente anterior, do mesmo tamanho. É o que dá sentido a
 * "vs. período anterior" sem inventar uma segunda regra para cada recorte.
 */
export function periodoAnterior(meses: string[]): string[] {
  return meses.map((m) => somaMeses(m, -meses.length));
}

/** Rótulo curto do período, para o cabeçalho de um cartão. */
export function rotuloDoPeriodo(meses: string[], recorte: Recorte): string {
  const primeiro = meses[0];
  if (!primeiro) return "—";
  if (recorte === "ano") return primeiro.slice(0, 4);
  if (recorte === "trimestre") {
    const trimestre = Math.floor(Number(primeiro.slice(5, 7)) / 3) + 1;
    return `${trimestre}º trimestre de ${primeiro.slice(0, 4)}`;
  }
  return primeiro;
}

/* ---------------------------------------------------------------- totais */

export interface MonthTotals {
  incomeCents: number;
  expenseCents: number;
  balanceCents: number;
  transactionCount: number;
}

/** Totais de um conjunto de meses (competência), sem transferências. */
export function totaisDoPeriodo(
  txs: FinanceTransaction[],
  meses: string[],
  contas: ContaParaCompetencia[],
): MonthTotals {
  const alvo = conjuntoDeMeses(meses);
  const cartoes = cartoesDe(contas);

  let incomeCents = 0;
  let expenseCents = 0;
  let transactionCount = 0;

  for (const tx of txs) {
    if (isTransfer(tx)) continue;
    if (!noPeriodo(tx, alvo, cartoes)) continue;
    transactionCount++;
    if (tx.kind === "income") incomeCents += tx.amount_cents;
    else if (tx.kind === "expense") expenseCents += tx.amount_cents;
  }

  return {
    incomeCents,
    expenseCents,
    balanceCents: incomeCents - expenseCents,
    transactionCount,
  };
}

/** Um mês só. Atalho para o caso mais comum de `totaisDoPeriodo`. */
export function monthTotals(
  txs: FinanceTransaction[],
  monthIso: string,
  contas: ContaParaCompetencia[],
): MonthTotals {
  return totaisDoPeriodo(txs, [monthIso], contas);
}

export interface CategoryTotal {
  categoryId: string | null;
  name: string;
  totalCents: number;
  share: number;
  /** Chave de cor da categoria — `null` para o balde "Sem categoria". */
  colorKey: string | null;
}

export function expensesByCategory(
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  meses: string[],
  contas: ContaParaCompetencia[],
): CategoryTotal[] {
  const porId = new Map(categories.map((c) => [c.id, c]));
  const alvo = conjuntoDeMeses(meses);
  const cartoes = cartoesDe(contas);
  const totais = new Map<string | null, number>();

  for (const tx of txs) {
    if (isTransfer(tx)) continue;
    if (tx.kind !== "expense") continue;
    if (!noPeriodo(tx, alvo, cartoes)) continue;
    totais.set(tx.category_id, (totais.get(tx.category_id) ?? 0) + tx.amount_cents);
  }

  const soma = [...totais.values()].reduce((a, b) => a + b, 0);

  return [...totais.entries()]
    .map(([categoryId, totalCents]) => {
      const categoria = categoryId ? porId.get(categoryId) : undefined;
      return {
        categoryId,
        name: categoryId ? (categoria?.name ?? "Categoria removida") : "Sem categoria",
        totalCents,
        share: soma === 0 ? 0 : totalCents / soma,
        colorKey: categoria?.color_key ?? null,
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents);
}

export interface TagTotal {
  tagId: string;
  name: string;
  totalCents: number;
  share: number;
  colorKey: string;
}

/**
 * Despesa por etiqueta.
 *
 * ⚠️ A SOMA DAS ETIQUETAS NÃO FECHA COM O TOTAL DO PERÍODO, e isso é correto:
 * um lançamento pode ter várias etiquetas (ele conta em cada uma) ou nenhuma
 * (não conta em lugar nenhum). Por isso `share` é sobre o total de DESPESA
 * ETIQUETADA, não sobre a despesa do período — apresentar o segundo faria as
 * fatias somarem mais de 100% sem explicação.
 */
export function despesasPorEtiqueta(
  txs: FinanceTransaction[],
  tags: FinanceTag[],
  vinculos: { transaction_id: string; tag_id: string }[],
  meses: string[],
  contas: ContaParaCompetencia[],
): TagTotal[] {
  const alvo = conjuntoDeMeses(meses);
  const cartoes = cartoesDe(contas);
  const porTx = new Map<string, string[]>();
  for (const v of vinculos) {
    const lista = porTx.get(v.transaction_id) ?? [];
    lista.push(v.tag_id);
    porTx.set(v.transaction_id, lista);
  }

  const totais = new Map<string, number>();
  for (const tx of txs) {
    if (isTransfer(tx)) continue;
    if (tx.kind !== "expense") continue;
    if (!noPeriodo(tx, alvo, cartoes)) continue;
    for (const tagId of porTx.get(tx.id) ?? []) {
      totais.set(tagId, (totais.get(tagId) ?? 0) + tx.amount_cents);
    }
  }

  const porId = new Map(tags.map((t) => [t.id, t]));
  const soma = [...totais.values()].reduce((a, b) => a + b, 0);

  return [...totais.entries()]
    .map(([tagId, totalCents]) => ({
      tagId,
      name: porId.get(tagId)?.name ?? "Etiqueta removida",
      totalCents,
      share: soma === 0 ? 0 : totalCents / soma,
      colorKey: porId.get(tagId)?.color_key ?? "stone",
    }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

export interface BeneficiarioTotal {
  nome: string;
  totalCents: number;
  quantidade: number;
}

/**
 * Onde o dinheiro foi parar, por `payee`.
 *
 * Agrupa por texto normalizado (minúsculas, sem espaço nas pontas) e exibe a
 * primeira grafia que apareceu: "Mercado X" e "mercado x " são o mesmo lugar, e
 * duas linhas quase idênticas no topo da lista fazem o cartão parecer quebrado.
 * Lançamento sem beneficiário fica de fora — um balde "Sem beneficiário" ganharia
 * o primeiro lugar em quase todo mês e não responde a pergunta nenhuma.
 */
export function topBeneficiarios(
  txs: FinanceTransaction[],
  meses: string[],
  contas: ContaParaCompetencia[],
  limite = 5,
): BeneficiarioTotal[] {
  const alvo = conjuntoDeMeses(meses);
  const cartoes = cartoesDe(contas);
  const totais = new Map<string, BeneficiarioTotal>();

  for (const tx of txs) {
    if (isTransfer(tx)) continue;
    if (tx.kind !== "expense") continue;
    if (!noPeriodo(tx, alvo, cartoes)) continue;
    const bruto = tx.payee?.trim();
    if (!bruto) continue;
    const chave = bruto.toLowerCase();
    const atual = totais.get(chave) ?? { nome: bruto, totalCents: 0, quantidade: 0 };
    atual.totalCents += tx.amount_cents;
    atual.quantidade++;
    totais.set(chave, atual);
  }

  return [...totais.values()].sort((a, b) => b.totalCents - a.totalCents).slice(0, limite);
}

/* ------------------------------------------------------------- histórico */

export interface MesDoHistorico {
  mes: string;
  incomeCents: number;
  expenseCents: number;
  balanceCents: number;
}

/**
 * Os N meses que TERMINAM em `mesFinal`, do mais antigo para o mais recente.
 *
 * Uma única varredura sobre os lançamentos, com os totais indexados por mês —
 * chamar `monthTotals` doze vezes seria doze varreduras completas da mesma
 * lista.
 */
export function historicoMensal(
  txs: FinanceTransaction[],
  contas: ContaParaCompetencia[],
  mesFinal: string,
  quantidade: number,
): MesDoHistorico[] {
  const meses = Array.from({ length: quantidade }, (_, i) =>
    somaMeses(mesCanonicoDe(mesFinal), i - (quantidade - 1)),
  );
  const indice = new Map(
    meses.map((mes) => [mes, { mes, incomeCents: 0, expenseCents: 0, balanceCents: 0 }]),
  );
  const cartoes = cartoesDe(contas);

  for (const tx of txs) {
    if (isTransfer(tx)) continue;
    const mes = mesDeCompetencia(tx, cartoes);
    if (mes === null) continue;
    const alvo = indice.get(mes);
    if (!alvo) continue;
    if (tx.kind === "income") alvo.incomeCents += tx.amount_cents;
    else if (tx.kind === "expense") alvo.expenseCents += tx.amount_cents;
  }

  return meses.map((mes) => {
    const t = indice.get(mes)!;
    return { ...t, balanceCents: t.incomeCents - t.expenseCents };
  });
}


/* ------------------------------------------------------------- variação */

/** Variação percentual entre dois períodos. null quando não há base de comparação. */
export function variation(currentCents: number, previousCents: number): number | null {
  if (previousCents === 0) return null;
  return (currentCents - previousCents) / previousCents;
}

export function previousMonthIso(monthIso: string): string {
  return somaMeses(mesCanonicoDe(monthIso), -1);
}

export function nextMonthIso(monthIso: string): string {
  return somaMeses(mesCanonicoDe(monthIso), 1);
}

/* ------------------------------------------ dívida, compromissos, previsto */

/** O recorte de um lançamento que ainda não foi (totalmente) pago. */
export type LancamentoPendente = Pick<
  FinanceTransaction,
  | "id"
  | "account_id"
  | "kind"
  | "amount_cents"
  | "paid_cents"
  | "occurred_on"
  | "transfer_group_id"
  | "serie_tipo"
  | "description"
>;

export interface Horizontes {
  /** Dinheiro de fato: contas, poupança, investimento. Da view. */
  patrimonioCents: number;
  /**
   * O que se deve INCONDICIONALMENTE — existe mesmo se você parar tudo hoje.
   * Cartão (saldo negativo) + despesa vencida não paga + parcelamento futuro.
   */
  dividaCents: number;
  /**
   * O que ainda vai sair mas é CANCELÁVEL: ocorrências futuras de recorrência e
   * despesas futuras ainda não vencidas.
   */
  compromissosCents: number;
  /** Dívida + Compromissos. Tudo o que ainda vai sair. */
  totalPrevistoCents: number;
  /**
   * Patrimônio menos DÍVIDA — nunca menos o total previsto. Ver o comentário
   * de `horizontesDoDinheiro`.
   */
  liquidoCents: number;
  /** Até que mês ("YYYY-MM-01") o previsto se estende. `null` se não há nada. */
  ate: string | null;
}

/** Quanto ainda falta pagar de uma linha. Nunca negativo (o CHECK da 0023 garante). */
function restanteDe(tx: Pick<LancamentoPendente, "amount_cents" | "paid_cents">): number {
  return Math.max(0, tx.amount_cents - tx.paid_cents);
}

/**
 * TRÊS NÚMEROS, E O NOME DE CADA UM É A DECISÃO.
 *
 * =============================================================================
 * ⚠️ POR QUE "DÍVIDA" E "COMPROMISSOS" NÃO PODEM VIRAR UM NÚMERO SÓ
 * =============================================================================
 * O pedido era somar as despesas futuras no total do Painel — e ele está certo.
 * O que estaria errado é chamar essa soma de DÍVIDA.
 *
 * "Dívida" carrega significado de balanço: passivo é o que existe mesmo se você
 * parar tudo hoje. Doze aluguéis futuros não são isso — saindo do imóvel no
 * terceiro mês, os outros nove simplesmente não acontecem. Doze parcelas de um
 * sofá são, porque o sofá já está na sala.
 *
 * Com os dois separados e um terceiro somando-os, o futuro aparece no total (que
 * é o que interessa no dia a dia) sem virar passivo.
 *
 * =============================================================================
 * ⚠️ O LÍQUIDO USA SÓ A DÍVIDA
 * =============================================================================
 * `liquido = patrimônio − dívida`, NUNCA menos o total previsto. Patrimônio
 * líquido é ativo menos passivo; compromisso cancelável não é passivo.
 * Subtrair doze aluguéis futuros faria o Líquido despencar sem que nada tivesse
 * acontecido — e o número deixaria de significar o que o nome promete.
 *
 * =============================================================================
 * A CLASSIFICAÇÃO, NA ORDEM EM QUE ELA É DECIDIDA
 * =============================================================================
 *   1. VENCEU (occurred_on <= hoje) e não foi paga  -> DÍVIDA
 *      Vale para recorrência também: você não deve doze aluguéis, mas DEVE o
 *      deste mês se ele venceu e não foi pago.
 *   2. É futura e é PARCELAMENTO                    -> DÍVIDA
 *      A contrapartida já foi entregue. Cancelar não devolve o bem.
 *   3. É futura e é qualquer outra coisa            -> COMPROMISSOS
 *
 * ⚠️ CONTA DE CARTÃO FICA DE FORA desta soma, e a exclusão é o que impede a
 * dupla contagem: compra no cartão já pesa em `debt_cents` pelo SALDO da conta
 * (a 0022 garante `is_paid = true` lá, então `paid_cents` é sempre cheio e a
 * linha já está no `balance_cents`). Somá-la de novo aqui dobraria a dívida do
 * cartão.
 *
 * Receita não paga (dinheiro a RECEBER) não entra em nenhum dos dois: nem
 * dívida nem compromisso são entrada. Ela aparece no saldo previsto da conta,
 * que é outra pergunta — ver `previstoPorConta`.
 */
export function horizontesDoDinheiro({
  balances,
  accounts,
  pendentes,
  lancamentosDeCartao,
  hoje,
}: {
  balances: Pick<FinanceAccountBalance, "account_id" | "balance_cents">[];
  accounts: ContaParaCompetencia[];
  /** TODOS os lançamentos não quitados do usuário, de qualquer data. */
  pendentes: LancamentoPendente[];
  /** Linhas de cartão já carregadas — só para descobrir até quando a dívida vai. */
  lancamentosDeCartao: Pick<
    FinanceTransaction,
    "account_id" | "kind" | "transfer_group_id" | "statement_month" | "occurred_on"
  >[];
  /** "AAAA-MM-DD" no fuso do app. Vem de fora: este módulo não tem relógio. */
  hoje: string;
}): Horizontes {
  const { patrimonioCents, dividaCents: dividaDeCartaoCents } = patrimonioEDivida(
    balances,
    accounts,
  );
  const cartoes = cartoesDe(accounts);

  let dividaPendenteCents = 0;
  let compromissosCents = 0;
  let ate: string | null = null;

  function esticar(mes: string | null) {
    if (mes !== null && (ate === null || mes > ate)) ate = mes;
  }

  for (const tx of pendentes) {
    if (cartoes.has(tx.account_id)) continue;
    if (isTransfer(tx)) continue;
    if (tx.kind !== "expense") continue;

    const restante = restanteDe(tx);
    if (restante === 0) continue;

    if (tx.occurred_on <= hoje) {
      dividaPendenteCents += restante;
    } else if (tx.serie_tipo === "parcelamento") {
      dividaPendenteCents += restante;
    } else {
      compromissosCents += restante;
    }
    esticar(mesCanonicoDe(tx.occurred_on));
  }

  // O horizonte da dívida de cartão vem da FATURA, não da data da compra — é o
  // mesmo critério de competência do resto do módulo.
  for (const tx of lancamentosDeCartao) {
    if (!cartoes.has(tx.account_id)) continue;
    if (isTransfer(tx)) continue;
    esticar(mesDeCompetencia(tx, cartoes));
  }

  const dividaCents = dividaDeCartaoCents + dividaPendenteCents;

  return {
    patrimonioCents,
    dividaCents,
    compromissosCents,
    totalPrevistoCents: dividaCents + compromissosCents,
    liquidoCents: patrimonioCents - dividaCents,
    ate,
  };
}

/**
 * O que ainda vai sair (ou entrar) de cada conta, para o SALDO PREVISTO.
 *
 * ⚠️ NÃO substitui o saldo da view, ACOMPANHA. A view é a autoridade sobre o
 * realizado, e é contra ela que o usuário confere o extrato do banco. Um saldo
 * único que já descontasse o pendente divergiria do extrato todo dia — e a
 * pessoa não teria como saber qual dos dois está errado.
 *
 * Aqui receita pendente CONTA (com sinal positivo): "quanto vou ter depois que
 * tudo se resolver" inclui o que está para entrar. É a diferença desta função
 * para `horizontesDoDinheiro`, que responde sobre dívida e só olha saída.
 */
export function previstoPorConta(pendentes: LancamentoPendente[]): Map<string, number> {
  const porConta = new Map<string, number>();
  for (const tx of pendentes) {
    if (isTransfer(tx)) continue;
    const restante = restanteDe(tx);
    if (restante === 0) continue;
    const delta = tx.kind === "expense" ? -restante : restante;
    porConta.set(tx.account_id, (porConta.get(tx.account_id) ?? 0) + delta);
  }
  return porConta;
}

/**
 * As despesas não pagas cuja COMPETÊNCIA é um dos meses do período.
 *
 * É o recorte mensal do total previsto, e o que completa o card "A pagar em
 * {mês}": ele já somava as faturas que vencem no mês, e ignorava tudo que não
 * fosse cartão. Uma conta de luz lançada e não paga não aparecia em lugar
 * nenhum além de "Despesas do mês".
 */
export function pendentesDoPeriodo(
  pendentes: LancamentoPendente[],
  meses: string[],
  contas: ContaParaCompetencia[],
): { totalCents: number; quantidade: number } {
  const alvo = conjuntoDeMeses(meses);
  const cartoes = cartoesDe(contas);

  let totalCents = 0;
  let quantidade = 0;
  for (const tx of pendentes) {
    // Cartão fora: o que vence no mês, para cartão, é a FATURA — e ela já é
    // somada por `faturasQueVencemEm`. Contar a compra aqui a somaria duas vezes.
    if (cartoes.has(tx.account_id)) continue;
    if (isTransfer(tx)) continue;
    if (tx.kind !== "expense") continue;
    const restante = restanteDe(tx);
    if (restante === 0) continue;
    if (!alvo.has(mesCanonicoDe(tx.occurred_on))) continue;
    totalCents += restante;
    quantidade++;
  }
  return { totalCents, quantidade };
}

/* --------------------------------------------------- o pacote do Painel */

/**
 * Tudo que o Painel exibe, já somado.
 *
 * ⚠️ O TIPO MORA AQUI, e não em `data.ts`, de propósito. `data.ts` é
 * `server-only`; `FinanceView` é componente de CLIENTE. Um `import type` de lá
 * funcionaria (tipo é apagado na compilação), mas deixaria um arquivo de
 * cliente apontando para um módulo de servidor no grafo de dependências — o
 * tipo de aresta que o contrato de camadas existe para não ter que julgar caso a
 * caso. Este arquivo é puro e os dois lados podem importá-lo.
 */
export interface FinanceAnalytics {
  meses: string[];
  mesesAnteriores: string[];
  atual: MonthTotals;
  anterior: MonthTotals;
  porCategoria: CategoryTotal[];
  porEtiqueta: TagTotal[];
  beneficiarios: BeneficiarioTotal[];
  historico: MesDoHistorico[];
  /** Lançamentos de cartão sem fatura atribuída — contados, nunca omitidos. */
  orfaos: ForaDeCompetencia;
}

/* ----------------------------------------------------------- orçamentos */

export interface BudgetProgress {
  budget: FinanceBudget;
  categoryName: string;
  spentCents: number;
  ratio: number;
  over: boolean;
}

/**
 * Orçamento é MENSAL por construção (`finance_budgets.month`), então esta é a
 * única agregação que continua recebendo um mês só — dar-lhe um recorte
 * trimestral compararia o gasto de três meses contra um limite de um.
 */
export function budgetProgress(
  budgets: FinanceBudget[],
  txs: FinanceTransaction[],
  categories: FinanceCategory[],
  monthIso: string,
  contas: ContaParaCompetencia[],
): BudgetProgress[] {
  const porId = new Map(categories.map((c) => [c.id, c.name]));
  const alvo = conjuntoDeMeses([monthIso]);
  const cartoes = cartoesDe(contas);

  const gastoPorCategoria = new Map<string, number>();
  for (const tx of txs) {
    if (isTransfer(tx)) continue;
    if (tx.kind !== "expense") continue;
    if (tx.category_id === null) continue;
    if (!noPeriodo(tx, alvo, cartoes)) continue;
    gastoPorCategoria.set(
      tx.category_id,
      (gastoPorCategoria.get(tx.category_id) ?? 0) + tx.amount_cents,
    );
  }

  return budgets.map((budget) => {
    const spentCents = gastoPorCategoria.get(budget.category_id) ?? 0;
    const ratio = budget.limit_cents === 0 ? 0 : spentCents / budget.limit_cents;
    return {
      budget,
      categoryName: porId.get(budget.category_id) ?? "—",
      spentCents,
      ratio,
      over: spentCents > budget.limit_cents,
    };
  });
}
