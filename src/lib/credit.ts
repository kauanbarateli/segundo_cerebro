import type {
  FinanceAccount,
  FinanceAccountBalance,
  FinanceTransaction,
} from "@/lib/database.types";

/**
 * Lógica de cartão de crédito — pura, sem I/O, testável.
 *
 * O erro conceitual que este módulo corrige: a view `finance_account_balances`
 * trata TODA conta como `saldo_inicial + entradas - saídas`. Para cartão isso
 * mente em dois níveis:
 *
 * 1. TEMPO — a compra não sai do bolso na data da compra. Ela entra na FATURA,
 *    que fecha no dia X e vence no dia Y. Quem decide o mês de uma compra é o
 *    fechamento, não o calendário.
 * 2. SINAL — saldo de cartão não é dinheiro que se tem, é DÍVIDA. Somá-lo ao
 *    patrimônio conta a mesma despesa duas vezes: uma na compra, outra no
 *    pagamento da fatura.
 *
 * CONVENÇÕES DESTE MÓDULO (decididas aqui e válidas para todo o resto do app):
 *
 * - O "mês da fatura" é o mês em que ela FECHA, no formato canônico
 *   "YYYY-MM-01" — o mesmo de `finance_budgets.month`, para que fatura e
 *   orçamento sejam comparáveis sem conversão.
 * - Compra NO PRÓPRIO DIA do fechamento já pertence à PRÓXIMA fatura. O dia do
 *   fechamento é o corte: o que acontece nele já não entrou a tempo.
 * - Dia que não existe no mês (fechamento 31 em fevereiro) vale como o ÚLTIMO
 *   dia do mês. É a única leitura sã: se o cartão fecha "no fim do mês", ele
 *   fecha no fim do mês que existe. Nunca transbordamos para o mês seguinte,
 *   senão fevereiro ficaria sem fatura.
 *
 * ARMADILHA DE FUSO (motivo de todo o código de data abaixo ser manual):
 * `new Date("2025-03-01").getDate()` interpreta a string como UTC e devolve o
 * dia no fuso LOCAL. Em America/Sao_Paulo (UTC-3) isso vira 28/02 — o dia volta
 * um e a compra cai na fatura errada. Aqui nenhuma conta usa `Date`: só os
 * componentes numéricos da string. `src/lib/finance.ts` tem o mesmo cuidado
 * usando `Date.UTC` em previousMonthIso/nextMonthIso.
 */

/* ------------------------------------------------------------------ calendário */

const DIAS_POR_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MES_ISO = /^(\d{4})-(\d{2})(?:-\d{2})?$/;

/** Regra gregoriana completa: 2000 é bissexto (%400), 1900 e 2100 não são (%100). */
function ehBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

/**
 * Último dia do mês (1-based). Calculado por aritmética, não por `Date`, para
 * não depender de fuso nem do mapeamento 0-99 -> 1900+ de `Date.UTC`.
 */
export function ultimoDiaDoMes(ano: number, mes: number): number {
  if (mes < 1 || mes > 12) throw new RangeError(`mês fora do intervalo 1-12: ${mes}`);
  if (mes === 2 && ehBissexto(ano)) return 29;
  return DIAS_POR_MES[mes - 1]!;
}

function padrao2(valor: number): string {
  return String(valor).padStart(2, "0");
}

/**
 * Normaliza (ano, mês) aceitando mês 0 ou 13 e devolve "YYYY-MM-01". Existe para
 * que a virada de ano (dezembro + 1 = janeiro do ano seguinte) seja aritmética,
 * e não mais um lugar onde `Date` poderia mexer no fuso.
 */
function mesCanonico(ano: number, mes: number): string {
  const deslocamento = Math.floor((mes - 1) / 12);
  const mesNormalizado = mes - deslocamento * 12;
  return `${String(ano + deslocamento).padStart(4, "0")}-${padrao2(mesNormalizado)}-01`;
}

interface PartesDeData {
  ano: number;
  mes: number;
  dia: number;
}

/**
 * Quebra "YYYY-MM-DD" em componentes já validados. Validar aqui é barato e
 * evita o pior modo de falha deste módulo: uma data inválida virar silenciosamente
 * uma fatura errada — dinheiro no mês errado é pior que uma exceção.
 */
function partesDeData(iso: string, rotulo: string): PartesDeData {
  const casou = DATA_ISO.exec(iso);
  if (!casou) throw new RangeError(`${rotulo} deve estar no formato YYYY-MM-DD: ${iso}`);

  const ano = Number(casou[1]);
  const mes = Number(casou[2]);
  const dia = Number(casou[3]);
  if (mes < 1 || mes > 12) throw new RangeError(`${rotulo} tem mês inválido: ${iso}`);
  if (dia < 1 || dia > ultimoDiaDoMes(ano, mes)) {
    throw new RangeError(`${rotulo} tem dia que não existe nesse mês: ${iso}`);
  }
  return { ano, mes, dia };
}

/** Aceita "YYYY-MM" ou "YYYY-MM-DD" e devolve os componentes do mês. */
function partesDeMes(iso: string, rotulo: string): { ano: number; mes: number } {
  const casou = MES_ISO.exec(iso);
  if (!casou) throw new RangeError(`${rotulo} deve estar no formato YYYY-MM-01: ${iso}`);
  const ano = Number(casou[1]);
  const mes = Number(casou[2]);
  if (mes < 1 || mes > 12) throw new RangeError(`${rotulo} tem mês inválido: ${iso}`);
  return { ano, mes };
}

/**
 * Normaliza um mês vindo do banco para "YYYY-MM-01".
 *
 * O Postgres devolve `date` como "YYYY-MM-DD", e o CHECK
 * `finance_tx_statement_month_is_first_day` (0010) já garante o dia 1 — mas a
 * comparação de fatura é feita por igualdade de STRING, e "2025-04-01" contra
 * "2025-04" não casaria. Normalizar na borda é mais barato que confiar no
 * formato de quem escreveu.
 */
function normalizaMes(iso: string, rotulo: string): string {
  const { ano, mes } = partesDeMes(iso, rotulo);
  return mesCanonico(ano, mes);
}

/**
 * Dias de fechamento/vencimento são configuração do usuário: 1-31 inteiro.
 * Rejeitar aqui evita que um `0` vindo de um input vazio empurre toda compra
 * para a fatura seguinte sem ninguém perceber.
 */
function validaDiaDoMes(dia: number, rotulo: string): void {
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    throw new RangeError(`${rotulo} deve ser inteiro entre 1 e 31: ${dia}`);
  }
}

/**
 * Dia do fechamento efetivo NAQUELE mês. Fechamento 31 em fevereiro vira 28
 * (ou 29 em ano bissexto): o último dia do mês vale como fechamento.
 */
function fechamentoEfetivo(ano: number, mes: number, diaFechamento: number): number {
  return Math.min(diaFechamento, ultimoDiaDoMes(ano, mes));
}

/**
 * Avança (ou recua, com `meses` negativo) um mês canônico "YYYY-MM-01".
 *
 * Existe porque somar mês NÃO é somar 30 dias, e porque `new Date(...).setMonth`
 * transborda: mês 13 vira janeiro do ano seguinte em alguns caminhos e estoura o
 * dia em outros. Aqui é aritmética pura sobre os componentes, com a mesma
 * normalização de virada de ano usada por `faturaDe`.
 */
export function somaMeses(mesIso: string, meses: number): string {
  if (!Number.isInteger(meses)) throw new RangeError(`meses deve ser inteiro: ${meses}`);
  const { ano, mes } = partesDeMes(mesIso, "mesIso");
  return mesCanonico(ano, mes + meses);
}

/**
 * Avança uma DATA "YYYY-MM-DD" em N meses mantendo o dia, com o mesmo clamp do
 * fechamento: 31/01 + 1 mês = 28/02 (ou 29/02 em ano bissexto), nunca 03/03.
 *
 * O clamp NÃO é cumulativo, e essa é a razão de a função receber o deslocamento
 * inteiro em vez de ser chamada em cadeia: 31/01 + 2 meses é 31/03, porque parte
 * sempre da data ORIGINAL. Somando "+1 mês" duas vezes o dia 31 morreria em
 * fevereiro e as parcelas seguintes ficariam todas no dia 28 — a compra do dia
 * 31 passaria a cair, mês a mês, do lado errado do fechamento.
 */
export function somaMesesNaData(dataIso: string, meses: number): string {
  if (!Number.isInteger(meses)) throw new RangeError(`meses deve ser inteiro: ${meses}`);
  const { ano, mes, dia } = partesDeData(dataIso, "dataIso");
  const { ano: anoFinal, mes: mesFinal } = partesDeMes(mesCanonico(ano, mes + meses), "dataIso");
  return `${anoFinal}-${padrao2(mesFinal)}-${padrao2(Math.min(dia, ultimoDiaDoMes(anoFinal, mesFinal)))}`;
}

/* --------------------------------------------------------------------- fatura */

/**
 * Mês da fatura em que a compra cai, em "YYYY-MM-01".
 *
 * Compra ANTES do fechamento entra na fatura que fecha neste mês; a partir do
 * dia do fechamento (inclusive) ela já é da próxima. Exemplo do dono: compra em
 * 20/03 com fechamento dia 15 -> fatura de ABRIL, porque a de março já fechou
 * no dia 15.
 */
export function faturaDe(dataCompra: string, diaFechamento: number): string {
  validaDiaDoMes(diaFechamento, "diaFechamento");
  const { ano, mes, dia } = partesDeData(dataCompra, "dataCompra");

  // `>=` e não `>`: a convenção é que a compra no próprio dia do fechamento já
  // perdeu a fatura corrente. Trocar por `>` desloca um dia inteiro de compras
  // de mês — o bug clássico de cartão.
  return dia >= fechamentoEfetivo(ano, mes, diaFechamento)
    ? mesCanonico(ano, mes + 1)
    : mesCanonico(ano, mes);
}

/**
 * Data em que a fatura de um mês FECHA ("YYYY-MM-DD").
 *
 * É a inversa de `faturaDe`: a fatura do mês M fecha no dia do fechamento DE M,
 * porque uma compra nesse dia (corte `>=`) já é da fatura M+1. Aplica o mesmo
 * clamp do resto do módulo — fechamento 31 em fevereiro fecha dia 28.
 *
 * Existe como função própria, e não reaproveitando `vencimentoDaFatura(mes, dia)`
 * (que hoje devolveria exatamente a mesma string), porque as duas respondem a
 * perguntas diferentes: se um dia o vencimento passar a considerar dia útil ou
 * feriado, o fechamento não pode mudar junto. Chamar a função de vencimento para
 * calcular fechamento amarraria as duas regras sem ninguém perceber.
 */
export function fechamentoDaFatura(mesFatura: string, diaFechamento: number): string {
  validaDiaDoMes(diaFechamento, "diaFechamento");
  const { ano, mes } = partesDeMes(mesFatura, "mesFatura");
  const dia = fechamentoEfetivo(ano, mes, diaFechamento);
  return `${String(ano).padStart(4, "0")}-${padrao2(mes)}-${padrao2(dia)}`;
}

/**
 * Data do último fechamento QUE JÁ OCORREU em `hoje` ("YYYY-MM-DD").
 *
 * É a fronteira entre o passado e o presente de um cartão: lançamento com
 * `occurred_on` ANTES dela está numa fatura já fechada — cobrada, provavelmente
 * paga, conciliada contra o extrato do banco; a partir dela (corte `>=`, o mesmo
 * de `faturaDe`) está na fatura ainda aberta ou numa futura.
 *
 * Existe porque a 0010 (seção 3) obriga a aplicação a recalcular
 * `statement_month` "APENAS das linhas ainda não faturadas" quando o dia de
 * fechamento muda. Sem esta fronteira só existiriam dois comportamentos, ambos
 * errados: não recalcular nada (a linha futura fica órfã de fatura para sempre)
 * ou recalcular tudo (fatura antiga já paga reescrita — a opção (b) recusada).
 *
 * Fica aqui, e não na server action, porque é regra de negócio com convenção de
 * data dentro: dentro da action ela só seria exercitada com um banco na frente.
 */
export function ultimoFechamentoAte(hoje: string, diaFechamento: number): string {
  validaDiaDoMes(diaFechamento, "diaFechamento");
  const { ano, mes } = partesDeData(hoje, "hoje");

  const fechamentoDesteMes = fechamentoDaFatura(mesCanonico(ano, mes), diaFechamento);
  // Comparação de strings ISO é comparação de datas: mesmo comprimento, campos
  // em ordem decrescente de peso e zero à esquerda. Nada de `Date`, pelo motivo
  // de sempre: o parser de "YYYY-MM-DD" é UTC e devolveria o dia anterior.
  return hoje >= fechamentoDesteMes
    ? fechamentoDesteMes
    : fechamentoDaFatura(mesCanonico(ano, mes - 1), diaFechamento);
}

/**
 * Data de vencimento ("YYYY-MM-DD") da fatura de um mês.
 *
 * Por padrão o vencimento cai DENTRO do mês da fatura (cartão que fecha dia 5 e
 * vence dia 12). Informando `diaFechamento`, cobrimos o outro arranjo comum no
 * Brasil — fecha dia 28, vence dia 5 —, em que o vencimento só pode ser no mês
 * SEGUINTE: uma fatura nunca vence antes (nem no instante em que) fecha.
 * Sem esse parâmetro a função não tem como saber, e devolveria uma data
 * anterior ao próprio fechamento.
 */
export function vencimentoDaFatura(
  mesFatura: string,
  diaVencimento: number,
  diaFechamento?: number,
): string {
  validaDiaDoMes(diaVencimento, "diaVencimento");
  const { ano, mes } = partesDeMes(mesFatura, "mesFatura");

  let mesDoVencimento = mes;
  if (diaFechamento !== undefined) {
    validaDiaDoMes(diaFechamento, "diaFechamento");
    if (diaVencimento <= diaFechamento) mesDoVencimento += 1;
  }

  const { ano: anoFinal, mes: mesFinal } = partesDeMes(
    mesCanonico(ano, mesDoVencimento),
    "mesFatura",
  );
  // Mesma regra do fechamento: vencimento dia 31 em abril vence dia 30.
  const dia = Math.min(diaVencimento, ultimoDiaDoMes(anoFinal, mesFinal));
  return `${anoFinal}-${padrao2(mesFinal)}-${padrao2(dia)}`;
}

/* ---------------------------------------------------------------- parcelamento */

/**
 * Divide um total em N parcelas INTEIRAS de centavos. A última absorve o
 * arredondamento — sem isso R$ 100,00 em 3x vira 3 × R$ 33,33 = R$ 99,99 e o
 * sistema passa a dever um centavo a si mesmo em toda compra parcelada.
 *
 * Invariante garantida: `parcelas(t, n).reduce(soma) === t`, sempre.
 */
export function parcelas(totalCents: number, numeroDeParcelas: number): number[] {
  if (!Number.isSafeInteger(totalCents)) {
    // Dinheiro é bigint em centavos. Um total fracionário aqui significa que
    // alguém converteu com ponto flutuante antes — falhar alto é o certo.
    throw new RangeError(`totalCents deve ser inteiro em centavos: ${totalCents}`);
  }
  if (!Number.isInteger(numeroDeParcelas) || numeroDeParcelas <= 0) {
    throw new RangeError(`numeroDeParcelas deve ser inteiro maior que zero: ${numeroDeParcelas}`);
  }

  // `trunc` e não `floor`: com total negativo (estorno parcelado) floor jogaria
  // o resto todo para o lado errado. O resto é sempre |resto| < numeroDeParcelas.
  const base = Math.trunc(totalCents / numeroDeParcelas);
  const lista = new Array<number>(numeroDeParcelas).fill(base);
  lista[numeroDeParcelas - 1] = base + (totalCents - base * numeroDeParcelas);
  return lista;
}

export interface PlanoDeParcelasArgs {
  totalCents: number;
  numeroDeParcelas: number;
  /** Data da COMPRA, "YYYY-MM-DD". É ela que define a fatura da primeira parcela. */
  dataCompra: string;
  /** Fechamento do cartão, ou `null` quando a conta parcelada não é cartão. */
  diaFechamento: number | null;
}

export interface ParcelaPlanejada {
  /** 1-based: o "3" de "3 de 12". */
  numero: number;
  /** O "12" de "3 de 12". Repetido em toda parcela porque vira coluna. */
  total: number;
  amountCents: number;
  /** Data do lançamento desta parcela, "YYYY-MM-DD". */
  occurredOn: string;
  /** Fatura desta parcela, "YYYY-MM-01". `null` fora de cartão. */
  statementMonth: string | null;
}

/**
 * Plano completo de uma compra parcelada: uma entrada por parcela, pronta para
 * virar uma linha de `finance_transactions`.
 *
 * Está aqui, e não na server action, porque as duas decisões abaixo são REGRA DE
 * NEGÓCIO e precisam de teste — dentro da action elas só seriam exercitadas com
 * um banco na frente.
 *
 * DECISÃO 1 — a parcela k cai na fatura da PRIMEIRA parcela deslocada de k-1
 * meses, POR CONSTRUÇÃO. Não se recalcula `faturaDe()` em cima da data já
 * deslocada, e isso não é um atalho: seria um erro. Compra em 28/02 num cartão
 * que fecha dia 29 -> a 1ª parcela cai na fatura de MARÇO (o fechamento efetivo
 * de fevereiro é 28, e o corte é `>=`). A 2ª parcela ocorre em 28/03, e aí o
 * fechamento efetivo já é 29, então `faturaDe("2025-03-28", 29)` devolveria
 * MARÇO de novo — duas parcelas na mesma fatura e um mês sem nenhuma. O cartão
 * de verdade cobra exatamente uma parcela por ciclo; o parcelamento manda no
 * calendário, não o contrário.
 *
 * DECISÃO 2 — cada parcela tem sua PRÓPRIA `occurred_on`, um mês à frente da
 * anterior, em vez de todas repetirem a data da compra. Assim o que pesa em cada
 * mês no dashboard e no orçamento é o que de fato pesa naquele mês: uma compra
 * de R$ 1.200 em 12x não derruba um mês sozinha e some nos onze seguintes. É a
 * mesma decisão registrada na migration 0010 ("uma linha por parcela, sem linha
 * mãe"), que é o que mantém toda consulta de fatura e de orçamento como uma soma
 * simples, sem caso especial.
 *
 * A divisão dos centavos é de `parcelas()`: a última absorve o resto, então a
 * soma do plano bate exatamente com o total.
 */
export function planoDeParcelas({
  totalCents,
  numeroDeParcelas,
  dataCompra,
  diaFechamento,
}: PlanoDeParcelasArgs): ParcelaPlanejada[] {
  const valores = parcelas(totalCents, numeroDeParcelas);
  // Fora de cartão não existe fatura: a compra parcelada continua sendo N
  // lançamentos mensais, só que sem ciclo de faturamento (carnê, boleto).
  const primeiraFatura = diaFechamento === null ? null : faturaDe(dataCompra, diaFechamento);

  return valores.map((amountCents, indice) => ({
    numero: indice + 1,
    total: numeroDeParcelas,
    amountCents,
    occurredOn: somaMesesNaData(dataCompra, indice),
    statementMonth: primeiraFatura === null ? null : somaMeses(primeiraFatura, indice),
  }));
}

/* --------------------------------------------------------------------- limite */

export interface LimiteDisponivelArgs {
  limiteCents: number;
  /** Fatura em aberto: o que já foi faturado e ainda não foi pago. */
  faturaAbertaCents: number;
  /** Compras futuras que ainda nem entraram numa fatura (parcelas à frente). */
  naoFaturadoCents: number;
}

/**
 * Limite ainda utilizável. Pode ser NEGATIVO quando o limite estourou — não
 * forçamos para zero de propósito: a interface precisa mostrar o quanto passou,
 * e zerar aqui esconderia exatamente a informação que importa.
 */
export function limiteDisponivel({
  limiteCents,
  faturaAbertaCents,
  naoFaturadoCents,
}: LimiteDisponivelArgs): number {
  return limiteCents - faturaAbertaCents - naoFaturadoCents;
}

/* ------------------------------------------------------------ fatura do cartão */

/**
 * Recorte mínimo de um cartão. Os nomes são os das colunas que a migration
 * 0010 acrescenta em `finance_accounts`, para que a linha do banco possa ser
 * passada direto, sem uma camada de conversão onde erros de mapeamento moram.
 */
export interface CartaoDeCredito {
  id: string;
  credit_limit_cents: number;
  statement_closing_day: number;
  payment_due_day: number;
}

export interface FaturaDoCartao {
  /**
   * O que foi LANÇADO no ciclo: compras somam, estornos subtraem. É o valor da
   * fatura como o banco a emite — nunca desconta pagamento.
   */
  totalCents: number;
  /**
   * Quanto já foi PAGO desta fatura. Soma dos pagamentos que apontam para ela em
   * `statement_month` (o mês que o usuário escolheu quitar em `payStatement`).
   */
  paidCents: number;
  /**
   * Saldo devedor: `totalCents - paidCents`. É este o número que se paga, e é
   * ele que o formulário sugere — depois de um pagamento parcial de R$ 500 numa
   * fatura de R$ 1.200, o que falta é R$ 700, não R$ 1.200.
   *
   * Sem piso em zero, pela mesma razão de `limiteDisponivel` e de `debt_cents`:
   * negativo é pagamento a maior (crédito a favor) e esconder isso seria mentir
   * ao contrário. Quem pré-preenche um campo aplica o piso na borda da UI.
   */
  openCents: number;
  /** Lançamentos da fatura, em ordem cronológica. Sem os pagamentos. */
  itens: FinanceTransaction[];
}

/**
 * Os três números da fatura, sem a lista. É o que a tela de pagamento precisa —
 * derivado do tipo real para não virar uma segunda definição que envelhece
 * sozinha quando `FaturaDoCartao` ganhar um campo.
 */
export type ResumoDeFatura = Omit<FaturaDoCartao, "itens">;

/**
 * Pagamento de fatura = perna de transferência que ENTRA no cartão (income com
 * `transfer_group_id`). Reaproveita o modelo de duas pernas que já existe para
 * transferências: conta corrente perde (expense), cartão recebe (income).
 *
 * Recebe `Pick` e não a linha inteira porque a pergunta depende de dois campos
 * só: assim a mesma função serve a uma projeção parcial vinda do banco (o
 * recálculo de faturas em actions.ts lê apenas as colunas de que precisa).
 */
export function ehPagamentoDeFatura(
  tx: Pick<FinanceTransaction, "kind" | "transfer_group_id">,
): boolean {
  return tx.kind === "income" && tx.transfer_group_id !== null;
}

/**
 * A que fatura uma linha pertence.
 *
 * A COLUNA GRAVADA MANDA. `statement_month` é escrito na escrita (0010, opção
 * (a)) justamente porque a fatura é um FATO HISTÓRICO; recalcular
 * `faturaDe(occurred_on, fechamento_de_hoje)` na leitura é a opção (b), que a
 * 0010 descartou por escrito. Ela erra em dois casos reais:
 *
 * 1. PARCELAMENTO. `planoDeParcelas` desloca a FATURA de cada parcela por
 *    construção (DECISÃO 1). Compra de 28/02 num cartão que fecha dia 29: a 2ª
 *    parcela ocorre em 28/03 e `faturaDe("2025-03-28", 29)` devolve MARÇO de
 *    novo — duas parcelas na mesma fatura e abril vazio. O cartão de verdade
 *    cobra uma parcela por ciclo.
 * 2. MUDANÇA DE FECHAMENTO. Trocar o dia de fechamento reescreveria faturas
 *    antigas, já cobradas e PAGAS, que precisam continuar batendo com o extrato.
 *
 * `faturaDe` fica como ÚLTIMO RECURSO, só para linha sem `statement_month`:
 * lançamento anterior à 0010, ou gravado enquanto o cartão ainda não tinha dia
 * de fechamento. Aí não existe fato gravado para respeitar, e derivar pela data
 * é melhor que a compra sumir de toda fatura.
 */
function faturaDaLinha(tx: FinanceTransaction, diaFechamento: number): string {
  if (tx.statement_month !== null) return normalizaMes(tx.statement_month, "statement_month");
  return faturaDe(tx.occurred_on, diaFechamento);
}

/**
 * Fatura de um mês: o que foi lançado, o que já foi pago e o que falta pagar.
 *
 * Regras que não são óbvias:
 *
 * - O PAGAMENTO da fatura não é compra e NÃO entra no total — ele entra em
 *   `paidCents`. Se somasse no total, a fatura se autoabateria: pagar R$ 500
 *   zeraria R$ 500 de compras e o cartão pareceria quitado no mês em que a
 *   dívida foi contraída. Os dois números existem separados porque respondem a
 *   perguntas diferentes: "quanto veio na fatura" e "quanto ainda devo dela".
 * - A fatura que um pagamento quita é a que `payStatement` gravou em
 *   `statement_month`, e não a fatura da data em que se pagou: quem paga a
 *   fatura de abril no dia 5 de maio está pagando ABRIL. Pagamento sem
 *   `statement_month` (transferência solta para o cartão) não pertence a fatura
 *   nenhuma e não abate nada — abater a fatura do mês da data seria adivinhar.
 * - Estorno (income SEM transferência) entra no total e SUBTRAI: é dinheiro
 *   devolvido pela loja, abate a fatura de verdade.
 * - Saque/transferência SAINDO do cartão (expense com `transfer_group_id`)
 *   CONTA: é dívida nova no cartão, mesmo sendo transferência. Por isso aqui
 *   não se usa o `isTransfer` de finance.ts, que excluiria as duas pernas.
 * - `is_paid` não filtra nada: quem define a qual fatura uma compra pertence é
 *   `statement_month` (ver `faturaDaLinha`), não o estado de pagamento.
 *
 * `statement_closing_day` continua sendo pedido porque é o que permite
 * classificar linha LEGADA, sem `statement_month` gravado.
 */
export function faturaDoCartao(
  transacoes: FinanceTransaction[],
  conta: Pick<CartaoDeCredito, "id" | "statement_closing_day">,
  mesFatura: string,
): FaturaDoCartao {
  const alvo = normalizaMes(mesFatura, "mesFatura");

  const itens: FinanceTransaction[] = [];
  let totalCents = 0;
  let paidCents = 0;

  for (const tx of transacoes) {
    if (tx.account_id !== conta.id) continue;
    // Linha 'transfer' pura não deveria existir (o modelo grava duas pernas),
    // mas se existir não tem sinal definido — ignorar é melhor que chutar.
    if (tx.kind === "transfer") continue;

    if (ehPagamentoDeFatura(tx)) {
      if (tx.statement_month !== null && normalizaMes(tx.statement_month, "statement_month") === alvo) {
        paidCents += tx.amount_cents;
      }
      continue;
    }

    if (faturaDaLinha(tx, conta.statement_closing_day) !== alvo) continue;

    itens.push(tx);
    totalCents += tx.kind === "expense" ? tx.amount_cents : -tx.amount_cents;
  }

  // Ordem cronológica para a listagem da fatura. `sort` é estável, então
  // lançamentos do mesmo dia mantêm a ordem em que vieram do banco.
  itens.sort((a, b) => (a.occurred_on < b.occurred_on ? -1 : a.occurred_on > b.occurred_on ? 1 : 0));

  return { totalCents, paidCents, openCents: totalCents - paidCents, itens };
}

/* ------------------------------------------------------------ status da fatura */

/**
 * Em que pé está a fatura.
 *
 * A ordem da união é a de GRAVIDADE crescente, e ela é usada para escolher o
 * tom na interface — nada aqui depende disso, mas quem for mexer deve saber que
 * a ordem não é alfabética por acaso.
 */
export type StatusDaFatura = "aberta" | "fechada" | "parcial" | "paga" | "vencida";

export interface StatusDaFaturaArgs {
  /** Hoje, "AAAA-MM-DD" no fuso do app. Vem de fora: este módulo não tem relógio. */
  hoje: string;
  mesFatura: string;
  diaFechamento: number;
  diaVencimento: number;
  /** Os números de `faturaDoCartao`. */
  resumo: Pick<ResumoDeFatura, "totalCents" | "paidCents" | "openCents">;
}

/**
 * O status é DERIVADO, e nunca gravado. Este é o ponto inteiro da função.
 *
 * =============================================================================
 * ⚠️ POR QUE NÃO EXISTE COLUNA `status` EM `finance_transactions`
 * =============================================================================
 * Uma coluna persistida precisaria de RELÓGIO: a fatura vence sozinha, sem
 * ninguém tocar em nada. "Fechada" vira "vencida" à meia-noite do dia seguinte
 * ao vencimento, e nenhum usuário faz uma escrita nesse instante. Manter a
 * coluna correta exigiria um processo noturno — e no dia em que ele falhasse, a
 * tela mostraria "fechada" para uma fatura vencida há uma semana.
 *
 * Pior: a coluna passaria a DISCORDAR dos valores ao lado dela. Um pagamento
 * registrado zera `openCents` na hora, mas o status gravado continuaria
 * "vencida" até o processo rodar — e aí a mesma tela diria "vencida" e "R$ 0,00
 * em aberto" lado a lado, com o usuário tendo que decidir em qual acreditar.
 *
 * É o mesmo argumento que `FinanceView` já usa para não recalcular a dívida
 * localmente, e o mesmo que vale para `openCents`: número derivado se calcula
 * na hora de mostrar.
 *
 * =============================================================================
 * A ORDEM DOS TESTES, QUE É ONDE MORA A SUTILEZA
 * =============================================================================
 *   1. PAGA vem primeiro. Uma fatura quitada é "paga" mesmo depois do
 *      vencimento — testar "vencida" antes marcaria como vencida toda fatura
 *      antiga já quitada, que é a maioria delas.
 *   2. VENCIDA antes de PARCIAL e FECHADA: passou da data e ainda deve algo, o
 *      que importa é isso. "Parcial e vencida" é vencida.
 *   3. ABERTA por último entre as com saldo, porque depende só do calendário.
 *
 * ⚠️ `openCents <= 0` e não `=== 0`: pagamento a maior deixa o saldo NEGATIVO
 * (crédito a favor), e isso é fatura paga. Ver o comentário de `openCents`.
 */
export function statusDaFatura({
  hoje,
  mesFatura,
  diaFechamento,
  diaVencimento,
  resumo,
}: StatusDaFaturaArgs): StatusDaFatura {
  const fechamento = fechamentoDaFatura(mesFatura, diaFechamento);
  const vencimento = vencimentoDaFatura(mesFatura, diaVencimento, diaFechamento);

  /*
    Fatura sem lançamento nenhum e sem pagamento nunca é "vencida": não há o que
    vencer. Ela segue o calendário — aberta antes de fechar, e "paga" (ou seja,
    nada a dever) depois. Sem esta linha, todo mês sem uso de um cartão
    apareceria em vermelho.
  */
  if (resumo.totalCents === 0 && resumo.paidCents === 0) {
    return hoje < fechamento ? "aberta" : "paga";
  }

  if (resumo.openCents <= 0) return "paga";

  // Comparação de string "AAAA-MM-DD" é comparação de data — o formato é
  // ordenável por construção, e é por isso que todo este módulo trabalha com
  // ele em vez de com `Date`.
  if (hoje > vencimento) return "vencida";
  if (hoje < fechamento) return "aberta";
  if (resumo.paidCents > 0) return "parcial";
  return "fechada";
}

/** O rótulo em português. Fica aqui para que tela e e-mail digam o mesmo. */
export const ROTULO_DO_STATUS_DA_FATURA: Record<StatusDaFatura, string> = {
  aberta: "Aberta",
  fechada: "Fechada",
  parcial: "Parcialmente paga",
  paga: "Paga",
  vencida: "Vencida",
};

/* --------------------------------------------------------- patrimônio x dívida */

export interface PatrimonioEDivida {
  /** Soma das contas que são dinheiro de fato (corrente, poupança, caixa...). */
  patrimonioCents: number;
  /** Quanto se DEVE em cartões, como número POSITIVO. */
  dividaCents: number;
}

/**
 * Separa o que é dinheiro do que é dívida. Os dois valores NUNCA são somados
 * num número só: "patrimônio - dívida" esconde o endividamento, que é
 * justamente o que o dashboard precisa mostrar.
 *
 * O saldo de um cartão vem NEGATIVO da view (compras são expense), então a
 * dívida é o oposto dele. Não aplicamos piso em zero: cartão pago a maior
 * aparece como dívida negativa (crédito a favor), e a interface decide como
 * mostrar isso — mesma filosofia de `limiteDisponivel`.
 *
 * `accounts` define o universo considerado e é a fonte autoritativa do `kind`:
 * saldo de conta que não estiver nessa lista é ignorado. Passe só as contas
 * ativas para deixar arquivadas de fora do dashboard.
 */
export function patrimonioEDivida(
  balances: Pick<FinanceAccountBalance, "account_id" | "balance_cents">[],
  accounts: Pick<FinanceAccount, "id" | "kind">[],
): PatrimonioEDivida {
  const kindPorId = new Map(accounts.map((a) => [a.id, a.kind]));

  let patrimonioCents = 0;
  let dividaCents = 0;

  for (const saldo of balances) {
    const kind = kindPorId.get(saldo.account_id);
    if (kind === undefined) continue;
    if (kind === "credit_card") dividaCents += -saldo.balance_cents;
    else patrimonioCents += saldo.balance_cents;
  }

  return { patrimonioCents, dividaCents };
}
