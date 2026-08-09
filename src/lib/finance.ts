import type {
  FinanceAccount,
  FinanceTransaction,
  FinanceCategory,
  FinanceTag,
  FinanceBudget,
} from "@/lib/database.types";
import { somaMeses } from "@/lib/credit";

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

/* --------------------------------------------------------------- semanas */

export interface FaixaSemanal {
  /** "YYYY-MM-DD" do primeiro e do último dia da faixa. */
  inicio: string;
  fim: string;
  incomeCents: number;
  expenseCents: number;
}

/**
 * Soma o mesmo `Date.UTC` que `previousMonthIso` usa. Aritmética em UTC puro é
 * exata e não tem fuso: o perigo do módulo de datas é `new Date("2026-03-01")`,
 * que PARSEIA como UTC e devolve componentes locais. Aqui não há parse de
 * string — os componentes entram como números.
 */
function somaDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + dias)).toISOString().slice(0, 10);
}

/**
 * O período dividido em faixas de 7 dias por DATA DA COMPRA.
 *
 * ⚠️ AS FAIXAS SÃO ANCORADAS NA PRIMEIRA COMPRA DO PERÍODO, e não no dia 1 do
 * calendário. O motivo é a competência: num mês de cartão as compras vêm do
 * CICLO da fatura, que começa no dia do fechamento anterior — âncora fixa no dia
 * 1 deixaria as compras do fim do mês passado numa faixa negativa, ou fora do
 * gráfico. Ancorando no dado, a soma das barras é sempre igual ao total do
 * período, que é a única propriedade que precisa valer.
 *
 * Por isso cada barra mostra o INTERVALO DE DATAS no rótulo, e não "semana 1":
 * um número ordinal sugeriria uma semana do calendário que estas faixas não são.
 */
export function porSemana(
  txs: FinanceTransaction[],
  meses: string[],
  contas: ContaParaCompetencia[],
): FaixaSemanal[] {
  const alvo = conjuntoDeMeses(meses);
  const cartoes = cartoesDe(contas);

  const doPeriodo = txs.filter((tx) => !isTransfer(tx) && noPeriodo(tx, alvo, cartoes));
  if (doPeriodo.length === 0) return [];

  let inicio = doPeriodo[0]!.occurred_on;
  let fim = inicio;
  for (const tx of doPeriodo) {
    if (tx.occurred_on < inicio) inicio = tx.occurred_on;
    if (tx.occurred_on > fim) fim = tx.occurred_on;
  }

  const faixas: FaixaSemanal[] = [];
  for (let cursor = inicio; cursor <= fim; cursor = somaDias(cursor, 7)) {
    faixas.push({
      inicio: cursor,
      fim: somaDias(cursor, 6),
      incomeCents: 0,
      expenseCents: 0,
    });
  }

  for (const tx of doPeriodo) {
    // A última faixa absorve qualquer data além do fim calculado. Não deveria
    // acontecer (o laço cobre até `fim`), mas um lançamento perdido é pior que
    // uma barra ligeiramente mais longa: a soma das barras não bateria com o
    // total exibido logo acima delas.
    const faixa =
      faixas.find((f) => tx.occurred_on >= f.inicio && tx.occurred_on <= f.fim) ??
      faixas[faixas.length - 1]!;
    if (tx.kind === "income") faixa.incomeCents += tx.amount_cents;
    else if (tx.kind === "expense") faixa.expenseCents += tx.amount_cents;
  }

  return faixas;
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
  semanas: FaixaSemanal[];
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
