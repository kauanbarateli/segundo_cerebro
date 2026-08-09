"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  financeAccountSchema,
  financeCategorySchema,
  financeTagSchema,
  financeTransactionSchema,
  financeTransferSchema,
  financeInstallmentSchema,
  financeRecorrenciaSchema,
  financeStatementPaymentSchema,
  financeTransactionPaymentSchema,
  financeBudgetSchema,
  lerUuid,
  ID_INVALIDO,
} from "@/lib/validation";
import {
  calcularEncargos,
  faturaDe,
  faturaDoCartao,
  faturaDoEncargo,
  planoDeParcelas,
  planoDeRecorrencia,
  ultimoFechamentoAte,
  ehPagamentoDeFatura,
} from "@/lib/credit";
import { bloqueioPorLimite } from "@/lib/rate-limit";
import type { ActionResult } from "@/lib/action-types";
import type { FinanceAccountKind, FinanceTransaction } from "@/lib/database.types";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada");
  return { supabase, user };
}

/* ------------------------------------------------- contas do lado do servidor */

type ClienteSupabase = Awaited<ReturnType<typeof createClient>>;

/** O mínimo que uma escrita de lançamento precisa saber sobre a conta. */
interface ContaDoLancamento {
  id: string;
  kind: FinanceAccountKind;
  statement_closing_day: number | null;
}

/**
 * Carrega várias contas de uma vez.
 *
 * UMA consulta com `in`, nunca uma por conta: uma transferência precisa das
 * duas pontas e um loop de `eq` aqui seria o começo do N+1 do lado da escrita.
 *
 * Serve também de CHECAGEM DE PROPRIEDADE de graça: a RLS filtra por user_id,
 * então o id de uma conta de outro usuário simplesmente não volta no Map, e o
 * chamador trata isso como "conta não encontrada" — que é a resposta certa e
 * não revela que a conta existe.
 */
async function carregarContas(
  supabase: ClienteSupabase,
  ids: string[],
): Promise<Map<string, ContaDoLancamento>> {
  const { data } = await supabase
    .from("finance_accounts")
    .select("id, kind, statement_closing_day")
    .in("id", [...new Set(ids)]);

  return new Map(
    ((data as ContaDoLancamento[] | null) ?? []).map((conta) => [conta.id, conta]),
  );
}

/**
 * A que fatura um lançamento pertence — `null` quando a conta não é cartão.
 *
 * Cumpre o contrato da 0010: `statement_month` é gravado na ESCRITA, com a
 * mesma `faturaDe()` que a interface usa, para que exista uma única
 * implementação das convenções de data (corte `>=`, clamp de dia inexistente).
 *
 * Devolve `null` também para um cartão legado sem `statement_closing_day`
 * preenchido (o caso do WARNING da 0010): sem o dia do fechamento não há como
 * saber a fatura, e chutar uma seria pior que deixar em branco.
 */
function mesDaFatura(conta: ContaDoLancamento | undefined, occurredOn: string): string | null {
  if (!conta || conta.kind !== "credit_card" || conta.statement_closing_day === null) return null;
  return faturaDe(occurredOn, conta.statement_closing_day);
}

/**
 * `is_paid` de um lançamento — FORÇADO a `true` em cartão de crédito.
 *
 * =============================================================================
 * ⚠️ A REGRA É DO SERVIDOR, E NÃO PODE SER DO FORMULÁRIO
 * =============================================================================
 * `is_paid = false` numa linha de cartão é o único estado que quebra o cálculo
 * de limite, e ele é fácil de produzir de boa-fé: a view
 * `finance_account_balances` junta as transações com `and t.is_paid = true`
 * (0005:267, preservado na 0010:431), então a linha não pesa em `balance_cents`,
 * `debt_cents` fica zero e `available_cents` não se move. A compra existe na
 * lista e não existe no limite.
 *
 * O formulário já esconde a caixa "Já pago / recebido" quando a conta é cartão,
 * mas isso é conveniência: uma Server Action É um endpoint HTTP, e um POST
 * montado à mão (ou uma aba aberta antes desta correção, ou uma versão futura do
 * formulário) manda o que quiser. A checagem que vale é esta.
 *
 * NÃO vale para conta corrente: ali "agendado mas ainda não debitado" é um
 * estado real e a caixa continua na tela.
 *
 * É a mesma decisão que `createInstallmentPurchase` já tomava para o caminho
 * parcelado (`is_paid: true` fixo). Aqui ela deixa de valer só para parcelamento
 * e passa a valer para toda compra no cartão, que é onde ela sempre esteve
 * certa.
 */
function pagoNoCartao(conta: ContaDoLancamento, informado: boolean): boolean {
  return conta.kind === "credit_card" ? true : informado;
}

/**
 * "YYYY-MM-DD" de hoje. Mesma convenção do resto do app (FinanceForms.today).
 *
 * É UTC, então em UTC-3 depois das 21h a data já virou. O erro possível é tratar
 * o fechamento de hoje como ocorrido algumas horas antes — e ele cai para o lado
 * SEGURO: preserva mais fatura como passado, nunca reescreve mais.
 */
function hojeIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Quebra a lista de ids em lotes para o `in(...)` do PostgREST.
 *
 * O filtro viaja na URL: uns 37 caracteres por uuid, contra um limite prático de
 * poucos KB no servidor. Uma conta corrente de anos convertida em cartão passa
 * fácil disso, e o efeito seria um 414 — a atualização inteira falhando por
 * causa do tamanho da string, não do dado.
 */
function emLotes<T>(itens: T[], tamanho = 100): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/** Colunas mínimas para decidir a fatura de uma linha já gravada. */
type LinhaParaRecalculo = Pick<
  FinanceTransaction,
  "id" | "occurred_on" | "kind" | "transfer_group_id" | "statement_month"
>;

/**
 * Reescreve `statement_month` dos lançamentos de uma conta que DIVERGEM do que a
 * configuração atual do cartão manda.
 *
 * `diaFechamento` null zera a coluna (a conta deixou de ser cartão). `desde`
 * null significa "todas as linhas"; com data, só as de `occurred_on >= desde`.
 *
 * Escrever só a diferença é o que torna a operação idempotente e barata: editar
 * o NOME de um cartão passa por aqui, não acha divergência e não grava nada. E é
 * o que faz uma segunda tentativa consertar o que a primeira deixou pela metade
 * (o PostgREST não dá transação entre chamadas, então "pela metade" é um estado
 * possível de verdade).
 *
 * Devolve false se algum lote falhou — o chamador precisa contar isso, porque
 * lançamento com fatura errada é dinheiro no mês errado.
 */
async function reescreverFaturas(
  supabase: ClienteSupabase,
  accountId: string,
  diaFechamento: number | null,
  desde: string | null,
): Promise<boolean> {
  /*
    Leitura PAGINADA, e não um `select` solto.

    O PostgREST corta a resposta no `db-max-rows` do projeto (1000 por padrão no
    Supabase) SEM erro e sem aviso. Uma conta com mais lançamentos que isso na
    janela teria as linhas excedentes caladamente não recalculadas — o mesmo tipo
    de silêncio que esta correção existe para eliminar.

    O passo é o TAMANHO DA PÁGINA QUE VOLTOU, nunca o que foi pedido: se o
    servidor limitar a menos que `PAGINA`, avançar pelo valor pedido pularia
    linhas. Ordenado por `id` porque `range` sobre resultado sem ordem estável
    pode repetir e omitir linhas entre páginas.
  */
  const PAGINA = 500;
  const linhas: LinhaParaRecalculo[] = [];
  for (let inicio = 0; ; ) {
    let consulta = supabase
      .from("finance_transactions")
      .select("id, occurred_on, kind, transfer_group_id, statement_month")
      .eq("account_id", accountId)
      .order("id", { ascending: true })
      .range(inicio, inicio + PAGINA - 1);
    if (desde !== null) consulta = consulta.gte("occurred_on", desde);

    const { data, error } = await consulta;
    if (error) return false;
    const pagina = (data as LinhaParaRecalculo[] | null) ?? [];
    if (pagina.length === 0) break;
    linhas.push(...pagina);
    inicio += pagina.length;
  }

  // Agrupa por fatura de destino: UM update por mês (em lotes), não um por
  // linha. O número de faturas distintas é pequeno — uma por mês de parcela — e
  // um update por linha viraria dezenas de idas ao banco em série.
  const porFatura = new Map<string | null, string[]>();
  for (const linha of linhas) {
    // O pagamento de fatura NUNCA é recalculado: o `statement_month` dele é a
    // fatura que o usuário escolheu QUITAR, não a fatura da data em que pagou.
    // Derivar pela data mandaria o pagamento de abril feito em 5 de maio para a
    // fatura de maio, e abril voltaria a parecer em aberto. Ao ZERAR (a conta
    // deixou de ser cartão) ele entra junto: sem cartão não há fatura a quitar.
    if (diaFechamento !== null && ehPagamentoDeFatura(linha)) continue;

    const mes = diaFechamento === null ? null : faturaDe(linha.occurred_on, diaFechamento);
    // Nada de `<>` mental aqui: os dois lados podem ser null e `null === null` é
    // true em JavaScript, ao contrário do SQL. Já gravado e igual, não reescreve.
    if (linha.statement_month === mes) continue;

    const lista = porFatura.get(mes) ?? [];
    lista.push(linha.id);
    porFatura.set(mes, lista);
  }

  let tudoCerto = true;
  for (const [mes, ids] of porFatura) {
    for (const lote of emLotes(ids)) {
      const { error: erroUpdate } = await supabase
        .from("finance_transactions")
        .update({ statement_month: mes })
        .in("id", lote);
      if (erroUpdate) tudoCerto = false;
    }
  }
  return tudoCerto;
}

/**
 * Mantém `statement_month` coerente depois de editar a conta — obrigação que a
 * 0010 (seção 3) atribui explicitamente à APLICAÇÃO.
 *
 * O preço da opção (a) da 0010 (gravar a fatura na escrita, para ela ser um fato
 * histórico) é este: mudar a configuração do cartão não conserta sozinho o que
 * já está gravado. Sem esta função, criar a conta como corrente, lançar uma
 * despesa futura e só então transformá-la em cartão deixa aquela linha com
 * `statement_month` null PARA SEMPRE: ela pesa em `debt_cents` mas some da
 * projeção das próximas faturas, porque `getFinanceSnapshot` recorta as linhas
 * de cartão por `statement_month not null` (data.ts).
 *
 * Quatro casos, e o corte entre eles é o que importa:
 *
 * - Continua cartão SEM dia de fechamento: não dá para calcular fatura nenhuma.
 *   Não mexe — apagar as que existem seria destruir dado por não saber recriá-lo.
 * - DEIXOU de ser cartão: zera. A coluna significa "linha de cartão" para o
 *   snapshot, e deixá-la preenchida faria lançamentos de uma conta corrente
 *   entrarem na lista de parcelas futuras de cartão.
 * - VIROU cartão (ou ganhou dia de fechamento agora): recalcula TUDO. Nenhuma
 *   fatura foi fechada, cobrada ou paga sob esta conta enquanto ela não era
 *   cartão, então não há passado a preservar.
 * - Continua cartão: reconcilia a janela `occurred_on >= último fechamento já
 *   ocorrido` — a fatura aberta e as futuras. As anteriores já foram cobradas e
 *   conciliadas; reescrevê-las faria o total de uma fatura paga deixar de bater
 *   com o extrato do banco, que é exatamente o que a opção (b) fazia e a 0010
 *   recusou. A janela é varrida MESMO quando o dia não mudou, e não é
 *   desperdício: `reescreverFaturas` só grava o que diverge, então o caso comum
 *   (renomear o cartão) custa um SELECT e nenhuma escrita — e uma edição
 *   seguinte conserta sozinha uma reconciliação anterior interrompida no meio.
 *
 * O corte de "já ocorrido" usa o dia de fechamento ANTIGO: é ele que definia
 * onde as faturas passadas fecharam.
 */
async function sincronizarFaturas(
  supabase: ClienteSupabase,
  accountId: string,
  antes: ContaDoLancamento,
  depois: { kind: FinanceAccountKind; statement_closing_day: number | null },
): Promise<boolean> {
  /*
    A CONTA VIROU CARTÃO: os lançamentos antigos precisam passar a pesar no
    limite.

    Este é o caminho de conserto de um cartão cadastrado com o tipo errado
    ('checking', 'other'), e sem esta linha ele ficaria pela metade: as compras
    antigas continuariam com `is_paid = false` — legítimo enquanto a conta era
    corrente — e a view `finance_account_balances`, que junta com
    `is_paid = true`, seguiria ignorando cada uma delas. A conta apareceria como
    cartão, com limite cadastrado, e `debt_cents` continuaria zero.

    O gatilho `trg_finance_tx_divida_de_cartao` (0022) NÃO cobre isto sozinho:
    ele age na escrita de `finance_transactions`, e trocar o tipo da CONTA não
    escreve em nenhuma delas.

    Mesma exclusão do reparo da 0022: perna de transferência fica de fora,
    porque a que entra no cartão é pagamento de fatura e marcá-la como paga
    abateria a dívida. Falha aqui não derruba a operação — a conta foi salva, e
    salvar de novo repete o passo (é idempotente, como todo o resto desta função).
  */
  if (depois.kind === "credit_card") {
    await supabase
      .from("finance_transactions")
      .update({ is_paid: true })
      .eq("account_id", accountId)
      .eq("is_paid", false)
      .is("transfer_group_id", null);
  }

  if (depois.kind === "credit_card" && depois.statement_closing_day === null) return true;

  if (depois.kind !== "credit_card") {
    if (antes.kind !== "credit_card") return true;
    return reescreverFaturas(supabase, accountId, null, null);
  }

  const diaNovo = depois.statement_closing_day!;
  if (antes.kind !== "credit_card" || antes.statement_closing_day === null) {
    return reescreverFaturas(supabase, accountId, diaNovo, null);
  }

  return reescreverFaturas(
    supabase,
    accountId,
    diaNovo,
    ultimoFechamentoAte(hojeIso(), antes.statement_closing_day),
  );
}

function revalidate() {
  revalidatePath("/financeiro");
  revalidatePath("/");
}

/** Auditoria: só metadados. NUNCA valores, saldos ou descrições. */
async function audit(entity: string, action: string, entityId?: string) {
  try {
    const { supabase, user } = await requireUser();
    await supabase.from("finance_audit_events").insert({
      user_id: user.id,
      entity,
      entity_id: entityId ?? null,
      action,
    });
  } catch {
    // Auditoria nunca pode bloquear a operação principal.
  }
}

function fail(e: unknown): ActionResult {
  return { ok: false, error: e instanceof Error ? e.message : "Erro" };
}

/* ------------------------------------------------------------------- contas */

export async function upsertAccount(input: unknown): Promise<ActionResult> {
  const parsed = financeAccountSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  try {
    const { supabase, user } = await requireUser();
    const i = parsed.data;

    // Os três campos de cartão são gravados SEMPRE, e zerados quando a conta não
    // é cartão. Deixá-los para trás ao trocar o tipo (de 'credit_card' para
    // 'checking') guardaria um limite fantasma numa conta corrente: a view
    // devolveria available_cents null e ninguém veria o lixo, até o dia em que
    // alguém trocasse o tipo de volta e herdasse silenciosamente o limite antigo.
    const ehCartao = i.kind === "credit_card";
    const row = {
      user_id: user.id,
      name: i.name,
      kind: i.kind,
      institution: i.institution,
      opening_balance_cents: i.openingBalanceCents,
      color_key: i.colorKey,
      // O `?? null` é só para o TypeScript: o superRefine do schema já garantiu
      // que os três existem quando ehCartao é true.
      credit_limit_cents: ehCartao ? (i.creditLimitCents ?? null) : null,
      statement_closing_day: ehCartao ? (i.statementClosingDay ?? null) : null,
      payment_due_day: ehCartao ? (i.paymentDueDay ?? null) : null,
    };

    if (i.id) {
      // Estado ANTERIOR da conta, lido antes de sobrescrevê-lo: é ele que diz se
      // o dia de fechamento mudou e qual era o corte das faturas já fechadas.
      // Sem esta leitura só daria para recalcular tudo ou nada — e "tudo" é a
      // opção (b) que a 0010 descartou, reescrevendo fatura antiga já paga.
      const antes = (await carregarContas(supabase, [i.id])).get(i.id);
      if (!antes) return { ok: false, error: "Conta não encontrada." };

      // `select` no update para distinguir "atualizei" de "não achei". Sem ele o
      // PostgREST devolve error: null com ZERO linhas afetadas quando o id não
      // existe ou é de outro usuário (a RLS o esconde), e a action responderia
      // "salvo" para uma edição que não aconteceu.
      const { data, error } = await supabase
        .from("finance_accounts")
        .update(row)
        .eq("id", i.id)
        .select("id");
      if (error) return { ok: false, error: error.message };
      if (!data || data.length === 0) return { ok: false, error: "Conta não encontrada." };

      // Depois do update, nunca antes: se a gravação falhar, os lançamentos não
      // podem ficar apontando para uma configuração de cartão que não existe.
      const faturasEmDia = await sincronizarFaturas(supabase, i.id, antes, {
        kind: i.kind,
        statement_closing_day: row.statement_closing_day,
      });

      await audit("account", "updated", i.id);
      revalidate();

      // A conta FOI salva — dizer o contrário seria mentir —, mas os
      // lançamentos podem ter ficado apontando para a fatura antiga, e isso é
      // dinheiro no mês errado. O texto diz as duas coisas e a saída é
      // idempotente: salvar de novo reconcilia o que faltou.
      if (!faturasEmDia) {
        return {
          ok: false,
          error:
            "A conta foi salva, mas as faturas dos lançamentos não puderam ser recalculadas. Salve a conta de novo para concluir.",
        };
      }
      return { ok: true, id: i.id };
    }

    const { data, error } = await supabase
      .from("finance_accounts")
      .insert(row)
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    await audit("account", "created", data.id as string);
    revalidate();
    return { ok: true, id: data.id as string };
  } catch (e) {
    return fail(e);
  }
}

/** Arquiva em vez de excluir: apagar a conta levaria junto o histórico. */
export async function archiveAccount(id: string): Promise<ActionResult> {
  if (!lerUuid(id)) return { ok: false, error: ID_INVALIDO };
  try {
    const { supabase } = await requireUser();
    const { error } = await supabase
      .from("finance_accounts")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    await audit("account", "archived", id);
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteAccount(id: string): Promise<ActionResult> {
  if (!lerUuid(id)) return { ok: false, error: ID_INVALIDO };
  try {
    const { supabase } = await requireUser();
    const { error } = await supabase.from("finance_accounts").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    await audit("account", "deleted", id);
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* --------------------------------------------------------------- categorias */

export async function upsertCategory(input: unknown): Promise<ActionResult> {
  const parsed = financeCategorySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  try {
    const { supabase, user } = await requireUser();
    const i = parsed.data;
    const row = { user_id: user.id, name: i.name, kind: i.kind, color_key: i.colorKey };

    if (i.id) {
      // Mesmo `select` de upsertAccount, pelo mesmo motivo: sem ele o PostgREST
      // devolve error null com zero linhas afetadas e a action diz "salvo".
      const { data, error } = await supabase
        .from("finance_categories")
        .update(row)
        .eq("id", i.id)
        .select("id");
      if (error) return { ok: false, error: error.message };
      if (!data || data.length === 0) return { ok: false, error: "Categoria não encontrada." };
      revalidate();
      return { ok: true, id: i.id };
    }
    const { data, error } = await supabase
      .from("finance_categories")
      .insert(row)
      .select("id")
      .single();
    if (error) {
      return {
        ok: false,
        error: error.code === "23505" ? "Já existe uma categoria com esse nome." : error.message,
      };
    }
    revalidate();
    return { ok: true, id: data.id as string };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  if (!lerUuid(id)) return { ok: false, error: ID_INVALIDO };
  try {
    const { supabase } = await requireUser();
    const { error } = await supabase.from("finance_categories").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* --------------------------------------------------------------------- tags */

export async function upsertTag(input: unknown): Promise<ActionResult> {
  const parsed = financeTagSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  try {
    const { supabase, user } = await requireUser();
    const i = parsed.data;
    const row = { user_id: user.id, name: i.name, color_key: i.colorKey };

    if (i.id) {
      const { data, error } = await supabase
        .from("finance_tags")
        .update(row)
        .eq("id", i.id)
        .select("id");
      if (error) return { ok: false, error: error.message };
      if (!data || data.length === 0) return { ok: false, error: "Etiqueta não encontrada." };
      revalidate();
      return { ok: true, id: i.id };
    }
    const { data, error } = await supabase.from("finance_tags").insert(row).select("id").single();
    if (error) {
      return {
        ok: false,
        error: error.code === "23505" ? "Já existe uma etiqueta com esse nome." : error.message,
      };
    }
    revalidate();
    return { ok: true, id: data.id as string };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteTag(id: string): Promise<ActionResult> {
  if (!lerUuid(id)) return { ok: false, error: ID_INVALIDO };
  try {
    const { supabase } = await requireUser();
    const { error } = await supabase.from("finance_tags").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* --------------------------------------------------------------- lançamentos */

export async function upsertTransaction(input: unknown): Promise<ActionResult> {
  const parsed = financeTransactionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  try {
    const { supabase, user } = await requireUser();

    /*
      Lançamento é a escrita mais cara de todas para se ter errada: cada linha
      indevida entra em saldo, em fatura e em orçamento, e limpar depois é
      conferir extrato mês a mês. Por isso o limite vale para os DOIS caminhos
      (criação e edição) — uma edição em laço reescreve `statement_month` de
      linha em linha e é tão destrutiva quanto criar.

      A cota é separada da de tarefas e capturas (ver `chaveDeUsuario`): um dia
      de trabalho no financeiro não pode consumir a cota de capturar uma ideia.
    */
    const bloqueio = bloqueioPorLimite("financeiro:lancamento", user.id);
    if (bloqueio) return bloqueio;

    const i = parsed.data;

    // Uma leitura da conta antes de escrever, para saber se é cartão. É uma ida
    // a mais ao banco em cada lançamento, e ela paga por si: sem ela
    // statement_month ficaria nulo e a fatura teria de ser derivada na leitura,
    // que é justamente a opção (b) descartada na 0010 — mudar o dia de
    // fechamento reescreveria retroativamente faturas antigas já pagas.
    const contas = await carregarContas(supabase, [i.accountId]);
    const conta = contas.get(i.accountId);
    if (!conta) return { ok: false, error: "Conta não encontrada." };

    /*
      ⚠️ EDITAR UM LANÇAMENTO PARCIALMENTE PAGO NÃO PODE APAGAR O PAGAMENTO.

      A caixa "Já pago / recebido" só sabe dizer tudo ou nada. Traduzi-la
      diretamente para `paid_cents` faria uma correção de descrição — ou de
      valor — zerar os R$ 300 que já saíram da conta, e o saldo passaria a
      divergir do extrato do banco por um gesto que não tinha nada a ver com
      pagamento.

      Por isso o valor já pago é PRESERVADO quando ele está no meio, e o
      formulário esconde a caixa nesse caso (mostra "Pago X de Y" e manda usar
      "Pagar"). O `min` cobre a edição que REDUZ o valor total para menos do que
      já foi pago: aí o lançamento passa a estar quitado, que é a leitura certa
      e a única que o CHECK `paid_cents <= amount_cents` aceita.
    */
    let pagoCents = i.isPaid ? i.amountCents : 0;
    let serie: {
      installment_group_id: string | null;
      installment_no: number | null;
      serie_tipo: string | null;
    } | null = null;

    if (i.id) {
      const { data: atual } = await supabase
        .from("finance_transactions")
        .select("paid_cents, amount_cents, installment_group_id, installment_no, serie_tipo")
        .eq("id", i.id)
        .maybeSingle();
      const anterior = atual as
        | {
            paid_cents: number;
            amount_cents: number;
            installment_group_id: string | null;
            installment_no: number | null;
            serie_tipo: string | null;
          }
        | null;
      if (anterior) {
        if (anterior.paid_cents > 0 && anterior.paid_cents < anterior.amount_cents) {
          pagoCents = Math.min(anterior.paid_cents, i.amountCents);
        }
        serie = {
          installment_group_id: anterior.installment_group_id,
          installment_no: anterior.installment_no,
          serie_tipo: anterior.serie_tipo,
        };
      }
    }

    const row = {
      user_id: user.id,
      account_id: i.accountId,
      category_id: i.categoryId,
      kind: i.kind,
      amount_cents: i.amountCents,
      description: i.description,
      payee: i.payee,
      occurred_on: i.occurredOn,
      notes: i.notes,
      // Ver `pagoNoCartao`: em cartão a dívida existe desde a compra, e
      // `is_paid = false` a apagaria do limite. A regra não pode vir do cliente.
      // O gatilho da 0023 deriva este campo de `paid_cents` de qualquer forma;
      // mandá-lo coerente evita depender disso para o valor ficar certo.
      is_paid: pagoNoCartao(conta, pagoCents >= i.amountCents),
      paid_cents: pagoCents,
      // Vale para income também: estorno de compra abate a fatura do ciclo em
      // que caiu. E é reescrito em toda edição de propósito — mover o
      // lançamento para outra conta ou outra data muda a fatura dele, e um
      // statement_month herdado da conta anterior seria pior que nenhum.
      statement_month: mesDaFatura(conta, i.occurredOn),
    };

    let txId = i.id;
    if (txId) {
      // `select("id")` + checagem de zero linhas, exatamente como upsertAccount.
      // O PostgREST devolve error: null quando NENHUMA linha casa — id apagado em
      // outra aba, id de outro usuário escondido pela RLS. Sem isto a action
      // responde { ok: true }, o toast diz "Lançamento salvo", o modal fecha e a
      // correção de um valor em dinheiro simplesmente não aconteceu. Pior: sem o
      // early return, as etiquetas abaixo seriam reescritas para um
      // transaction_id que não é desta edição.
      const { data, error } = await supabase
        .from("finance_transactions")
        .update(row)
        .eq("id", txId)
        .select("id");
      if (error) return { ok: false, error: error.message };
      if (!data || data.length === 0) return { ok: false, error: "Lançamento não encontrado." };
    } else {
      const { data, error } = await supabase
        .from("finance_transactions")
        .insert(row)
        .select("id")
        .single();
      if (error) return { ok: false, error: error.message };
      txId = data.id as string;
    }

    /*
      =========================================================================
      EDIÇÃO EM SÉRIE — "esta e as futuras" / "todas"
      =========================================================================
      O problema clássico de agenda. A ocorrência editada já foi gravada acima;
      aqui as IRMÃS recebem o que faz sentido propagar.

      ⚠️ `occurred_on` E `paid_cents` NUNCA SE PROPAGAM. Cada ocorrência tem a sua
      data (é o que a torna mensal) e o seu estado de pagamento — propagar
      qualquer um dos dois apagaria justamente o que distingue uma ocorrência da
      outra.

      ⚠️ A DESCRIÇÃO SÓ SE PROPAGA EM RECORRÊNCIA. Em parcelamento ela carrega o
      sufixo "(3/12)", gravado por linha; escrever a mesma string em todas
      renomearia a 7ª parcela para "Geladeira (3/12)". Reconstruir o sufixo linha
      a linha seriam N escritas sem transação — e o ganho (renomear uma compra
      parcelada) não paga o risco de deixar metade renomeada.

      "todas" alcança meses JÁ FECHADOS. Quem confirma é avisado do número deles
      pela interface, e a decisão de oferecer a opção é do plano.
    */
    if (serie?.installment_group_id && i.escopo !== "esta") {
      const patch: Record<string, unknown> = {
        amount_cents: i.amountCents,
        category_id: i.categoryId,
      };
      if (serie.serie_tipo === "recorrencia") patch.description = i.description;

      let alcance = supabase
        .from("finance_transactions")
        .update(patch)
        .eq("installment_group_id", serie.installment_group_id)
        .neq("id", txId);

      if (i.escopo === "futuras" && serie.installment_no !== null) {
        alcance = alcance.gte("installment_no", serie.installment_no);
      }
      await alcance;
    }

    // Reescreve as etiquetas: mais simples e previsível que fazer diff.
    //
    // Falha aqui NÃO derruba a operação, e é a mesma decisão de
    // createInstallmentPurchase: o lançamento já está gravado com o valor certo,
    // e devolver erro faria o usuário repetir o formulário e criar um lançamento
    // DUPLICADO. Etiqueta errada se conserta editando; lançamento duplicado de
    // dinheiro se conserta excluindo — e alguém precisa perceber que existe.
    // O `txId` daqui só chega preenchido depois da checagem de zero linhas acima.
    await supabase.from("finance_transaction_tags").delete().eq("transaction_id", txId);
    if (i.tagIds.length > 0) {
      await supabase.from("finance_transaction_tags").insert(
        i.tagIds.map((tagId) => ({
          transaction_id: txId!,
          tag_id: tagId,
          user_id: user.id,
        })),
      );
    }

    await audit("transaction", i.id ? "updated" : "created", txId);
    revalidate();
    return { ok: true, id: txId };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Exclui um lançamento — e, quando ele faz parte de um GRUPO, o grupo inteiro.
 *
 * São dois grupos, com o mesmo motivo: uma linha sozinha não é uma operação
 * inteira, e deixar metade dela no banco corrompe um total.
 *
 * - `transfer_group_id`: as duas pernas. Deixar uma desbalancearia os saldos.
 * - `installment_group_id`: as N parcelas. É o espelho, no delete, do
 *   "parcelamento pela metade" que o insert em array de
 *   `createInstallmentPurchase` foi feito para evitar. Apagando só a parcela
 *   visível some 1/12 da dívida e as outras 11 continuam pesando em
 *   `debt_cents`, em `available_cents` e nas faturas futuras — e a aba
 *   Lançamentos só lista o mês exibido, então limpar à mão seria navegar mês a
 *   mês doze vezes. Quem confirma é avisado do número de parcelas pelo
 *   ConfirmationDialog da FinanceView.
 */
export async function deleteTransaction(id: string): Promise<ActionResult> {
  if (!lerUuid(id)) return { ok: false, error: ID_INVALIDO };
  // Valida ANTES do banco: um id fora do formato uuid faria o PostgREST devolver
  // erro cru de sintaxe de tipo (22P02), que não diz nada a quem lê o toast.
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "Lançamento inválido." };
  }
  try {
    const { supabase } = await requireUser();

    const { data: tx } = await supabase
      .from("finance_transactions")
      .select("transfer_group_id, installment_group_id")
      .eq("id", id)
      .maybeSingle();

    const alvo = tx as {
      transfer_group_id: string | null;
      installment_group_id: string | null;
    } | null;

    const query = supabase.from("finance_transactions").delete();
    // `select("id")` também aqui: o delete de um id inexistente (ou escondido
    // pela RLS) volta com error null, e sem contar as linhas a action diria
    // "excluído" para nada.
    const { data, error } = alvo?.transfer_group_id
      ? await query.eq("transfer_group_id", alvo.transfer_group_id).select("id")
      : alvo?.installment_group_id
        ? await query.eq("installment_group_id", alvo.installment_group_id).select("id")
        : await query.eq("id", id).select("id");

    if (error) return { ok: false, error: error.message };
    if (((data as { id: string }[] | null) ?? []).length === 0) {
      return { ok: false, error: "Lançamento não encontrado." };
    }

    await audit("transaction", "deleted", id);
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Transferência = duas linhas (saída + entrada) unidas por transfer_group_id.
 * Modelar assim mantém o extrato de cada conta correto; e como as pernas são
 * income/expense, elas são filtradas dos totais pelo transfer_group_id.
 */
export async function createTransfer(input: unknown): Promise<ActionResult> {
  const parsed = financeTransferSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const i = parsed.data;
  if (i.fromAccountId === i.toAccountId) {
    return { ok: false, error: "Escolha contas diferentes." };
  }
  try {
    const { supabase, user } = await requireUser();
    const groupId = crypto.randomUUID();

    const contas = await carregarContas(supabase, [i.fromAccountId, i.toAccountId]);
    const origem = contas.get(i.fromAccountId);
    const destino = contas.get(i.toAccountId);
    if (!origem || !destino) return { ok: false, error: "Conta não encontrada." };

    const { error } = await supabase.from("finance_transactions").insert([
      {
        user_id: user.id,
        account_id: i.fromAccountId,
        kind: "expense",
        amount_cents: i.amountCents,
        description: i.description,
        occurred_on: i.occurredOn,
        transfer_group_id: groupId,
        // Saída DE um cartão (saque, transferência) é dívida nova e pertence ao
        // ciclo da data — `faturaDoCartao()` conta essa perna justamente por isso.
        statement_month: mesDaFatura(origem, i.occurredOn),
      },
      {
        user_id: user.id,
        account_id: i.toAccountId,
        kind: "income",
        amount_cents: i.amountCents,
        description: i.description,
        occurred_on: i.occurredOn,
        transfer_group_id: groupId,
        // Entrada EM cartão é pagamento de fatura, e a fatura paga é uma ESCOLHA
        // do usuário, não uma dedução da data: quem paga a fatura de abril no
        // dia 5 de maio está pagando abril, e `faturaDe()` diria maio. Por isso
        // fica null aqui e quem sabe o mês é `payStatement`, que o recebe como
        // entrada. Não perde nada: `ehPagamentoDeFatura()` reconhece esta perna
        // por kind + transfer_group_id, sem olhar statement_month.
        statement_month: null,
      },
    ]);

    if (error) return { ok: false, error: error.message };
    await audit("transfer", "created", groupId);
    revalidate();
    return { ok: true, id: groupId };
  } catch (e) {
    return fail(e);
  }
}

/* --------------------------------------------------- encargos do rotativo */

/**
 * As linhas que `faturaDoCartao()` precisa ver para somar UMA fatura.
 *
 * Traz as do mês pedido e as SEM fatura atribuída — estas últimas porque
 * `faturaDaLinha()` deriva a fatura delas por `faturaDe(occurred_on)`, e ignorá-las
 * aqui produziria um saldo devedor menor que o real. Juros sobre um saldo
 * subestimado erram para menos, o que parece inofensivo e não é: o número que a
 * pessoa confere contra o extrato do banco deixaria de bater.
 *
 * Paginado pelo motivo de sempre: o PostgREST corta no `db-max-rows` do projeto
 * (1000 por padrão) SEM erro e sem aviso.
 */
async function linhasDaFatura(
  supabase: ClienteSupabase,
  accountId: string,
  mesFatura: string,
): Promise<FinanceTransaction[]> {
  const PAGINA = 500;
  const linhas: FinanceTransaction[] = [];
  for (let inicio = 0; ; ) {
    const { data, error } = await supabase
      .from("finance_transactions")
      .select("*")
      .eq("account_id", accountId)
      .or(`statement_month.eq.${mesFatura},statement_month.is.null`)
      .order("id", { ascending: true })
      .range(inicio, inicio + PAGINA - 1);
    if (error) break;
    const lote = (data as FinanceTransaction[] | null) ?? [];
    if (lote.length === 0) break;
    linhas.push(...lote);
    inicio += lote.length;
  }
  return linhas;
}

const NOME_DA_CATEGORIA_DE_ENCARGOS = "Juros e encargos";

/**
 * A categoria em que os encargos caem — criada na primeira vez que forem cobrados.
 *
 * =============================================================================
 * POR QUE CATEGORIA, E NÃO UMA COLUNA `is_encargo`
 * =============================================================================
 * Uma coluna nova exigiria migration, tipo, e um caso especial em toda soma que
 * hoje agrupa por categoria. A categoria já é o eixo pelo qual o Painel separa
 * despesa — os encargos entram nele de graça, aparecem na rosca com nome próprio
 * e podem ganhar orçamento como qualquer outra.
 *
 * =============================================================================
 * POR QUE CRIAR SOB DEMANDA, E NÃO SEMEAR NUMA MIGRATION
 * =============================================================================
 * Semear criaria a categoria para todo mundo, inclusive para quem nunca vai
 * pagar fatura parcelada — mais uma linha no seletor de categoria de toda tela,
 * para sempre. Aqui ela nasce no dia em que passa a significar alguma coisa.
 *
 * ⚠️ O 23505 NÃO É ERRO, é a corrida perdida. `finance_categories_unique` cobre
 * (user_id, kind, normalized_name); duas ações simultâneas podem chegar juntas
 * ao insert. Quem perde relê e usa a que o outro criou — é isso que torna a
 * função idempotente de verdade, e não só "quase sempre".
 *
 * `null` em qualquer outra falha: um encargo sem categoria é levemente pior de
 * analisar; um encargo NÃO REGISTRADO é dinheiro que some da dívida.
 */
async function categoriaDeEncargos(
  supabase: ClienteSupabase,
  userId: string,
): Promise<string | null> {
  const normalizado = NOME_DA_CATEGORIA_DE_ENCARGOS.toLowerCase();

  async function achar(): Promise<string | null> {
    const { data } = await supabase
      .from("finance_categories")
      .select("id")
      .eq("kind", "expense")
      .eq("normalized_name", normalizado)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  }

  const existente = await achar();
  if (existente) return existente;

  const { data, error } = await supabase
    .from("finance_categories")
    .insert({
      user_id: userId,
      name: NOME_DA_CATEGORIA_DE_ENCARGOS,
      kind: "expense",
      color_key: "terracota",
    })
    .select("id")
    .single();

  if (error) return error.code === "23505" ? achar() : null;
  return (data as { id: string } | null)?.id ?? null;
}

/* ------------------------------------------------------------------- cartões */

/**
 * Compra parcelada no cartão: N lançamentos unidos por `installment_group_id`.
 *
 * POR QUE UM ÚNICO `.insert([...])` COM ARRAY, E NÃO N INSERTS: o PostgREST não
 * dá transação entre chamadas. Em N chamadas separadas, a 7ª falhando (rede,
 * timeout, RLS) deixaria uma compra de 12x gravada pela metade — seis parcelas
 * órfãs, saldo errado, e nenhum lugar de onde continuar. Um array é UM comando
 * no Postgres: ou as doze linhas entram, ou nenhuma entra.
 *
 * O rateio dos centavos e a fatura de cada parcela vêm de `planoDeParcelas()`
 * (src/lib/credit.ts), que é testado. Aqui não se decide nada sobre datas nem
 * sobre arredondamento.
 */
export async function createInstallmentPurchase(input: unknown): Promise<ActionResult> {
  const parsed = financeInstallmentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  try {
    const { supabase, user } = await requireUser();
    const i = parsed.data;

    const contas = await carregarContas(supabase, [i.accountId]);
    const conta = contas.get(i.accountId);
    if (!conta) return { ok: false, error: "Conta não encontrada." };

    // Sem cartão não existe fatura, e o plano sai com statementMonth null — mas
    // as N parcelas mensais continuam fazendo sentido (carnê, boleto), então não
    // recusamos a operação. Cartão legado sem dia de fechamento cai aqui também.
    const ehCartao = conta.kind === "credit_card";
    const diaFechamento = ehCartao ? conta.statement_closing_day : null;

    const plano = planoDeParcelas({
      totalCents: i.totalAmountCents,
      numeroDeParcelas: i.installments,
      dataCompra: i.occurredOn,
      diaFechamento,
    });

    const groupId = crypto.randomUUID();
    const linhas = plano.map((parcela) => ({
      user_id: user.id,
      account_id: i.accountId,
      category_id: i.categoryId,
      // Compra parcelada é sempre saída. O sinal vem de `kind` (a coluna
      // amount_cents é positiva por constraint), então não há o que inverter.
      kind: "expense",
      amount_cents: parcela.amountCents,
      // O sufixo "(3/12)" só aparece quando há mais de uma parcela: "(1/1)"
      // seria ruído numa compra à vista feita por este mesmo caminho.
      description:
        parcela.total > 1
          ? `${i.description} (${parcela.numero}/${parcela.total})`
          : i.description,
      occurred_on: parcela.occurredOn,
      /*
        ⚠️ EM CARTÃO, PAGO. FORA DELE, NÃO PAGO. E a dívida é a mesma nos dois.

        No CARTÃO o banco adiantou o dinheiro: a dívida já existe por inteiro no
        instante da compra, e é isso que faz `debt_cents` e `available_cents`
        refletirem o limite realmente comprometido. Marcar as parcelas futuras
        como não pagas mostraria limite disponível que o cartão não te dá.

        FORA DO CARTÃO (carnê, boleto, crediário — o caso novo), o dinheiro ainda
        NÃO saiu da conta. Marcar como pago derrubaria o saldo pelo total no dia
        da compra, e ele deixaria de bater com o extrato do banco por doze meses.

        A dívida não some por isso: `serie_tipo = 'parcelamento'` faz
        `horizontesDoDinheiro` mandar as parcelas futuras não pagas para a
        DÍVIDA, não para os Compromissos — a contrapartida já foi entregue, e
        cancelar não devolve o bem. É essa coluna que carrega a diferença que o
        `is_paid` deixou de carregar aqui.
      */
      is_paid: ehCartao,
      paid_cents: ehCartao ? parcela.amountCents : 0,
      installment_group_id: groupId,
      installment_no: parcela.numero,
      installment_total: parcela.total,
      serie_tipo: "parcelamento",
      statement_month: parcela.statementMonth,
    }));

    const { data, error } = await supabase
      .from("finance_transactions")
      .insert(linhas)
      .select("id");
    if (error) return { ok: false, error: error.message };

    // "0 linhas afetadas": o PostgREST devolve error null com data vazio quando
    // nada entrou. Sem esta checagem a action diria "salvo" para uma compra que
    // não existe.
    const ids = ((data as { id: string }[] | null) ?? []).map((linha) => linha.id);
    if (ids.length !== linhas.length) {
      return { ok: false, error: "Não foi possível registrar todas as parcelas." };
    }

    if (i.tagIds.length > 0) {
      // Falha aqui NÃO derruba a operação, e isso é deliberado: a compra já está
      // gravada, e devolver erro faria o usuário repetir o formulário e criar uma
      // SEGUNDA compra parcelada. Etiqueta faltando se conserta editando; compra
      // duplicada se conserta apagando doze linhas.
      await supabase.from("finance_transaction_tags").insert(
        ids.flatMap((transactionId) =>
          i.tagIds.map((tagId) => ({
            transaction_id: transactionId,
            tag_id: tagId,
            user_id: user.id,
          })),
        ),
      );
    }

    // Auditoria só com metadados: o id do grupo, nunca o valor nem a descrição.
    await audit("installment_purchase", "created", groupId);
    revalidate();
    return { ok: true, id: groupId };
  } catch (e) {
    return fail(e);
  }
}

/**
 * RECORRÊNCIA: N ocorrências do MESMO valor, uma por mês.
 *
 * =============================================================================
 * ⚠️ ELA NÃO É DÍVIDA, E É POR ISSO QUE `serie_tipo` EXISTE
 * =============================================================================
 * "12× aluguel de R$ 2.000" não é uma dívida de R$ 24.000: saindo do imóvel no
 * terceiro mês, os outros nove simplesmente não acontecem. As linhas nascem
 * `is_paid = false` e `serie_tipo = 'recorrencia'`, e `horizontesDoDinheiro`
 * manda as futuras para COMPROMISSOS, nunca para Dívida.
 *
 * É o oposto exato de `createInstallmentPurchase`, que grava
 * `serie_tipo = 'parcelamento'` justamente porque ali a contrapartida já foi
 * entregue e a dívida existe por inteiro desde a compra.
 *
 * =============================================================================
 * ⚠️ NÃO É PERMITIDA EM CARTÃO DE CRÉDITO
 * =============================================================================
 * Lá o gatilho da 0023 força `is_paid = true` em toda linha — a garantia que
 * impede o limite de deixar de ser consumido. Com ela, as doze ocorrências
 * futuras de uma assinatura entrariam na dívida e comeriam limite que o cartão
 * ainda NÃO comprometeu (diferente de um parcelamento, em que o banco já
 * autorizou o total).
 *
 * A alternativa seria abrir uma exceção no gatilho por `serie_tipo` — e aí
 * "recorrência" viraria a forma de gravar compra de cartão não paga, que é
 * exatamente o estado que apagava a dívida do sistema. A recusa é a resposta
 * barata; a exceção custaria a garantia inteira.
 */
export async function createRecurringSeries(input: unknown): Promise<ActionResult> {
  const parsed = financeRecorrenciaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  try {
    const { supabase, user } = await requireUser();
    const bloqueio = bloqueioPorLimite("financeiro:lancamento", user.id);
    if (bloqueio) return bloqueio;

    const i = parsed.data;
    const contas = await carregarContas(supabase, [i.accountId]);
    const conta = contas.get(i.accountId);
    if (!conta) return { ok: false, error: "Conta não encontrada." };

    if (conta.kind === "credit_card") {
      return {
        ok: false,
        error:
          "Recorrência não vai em cartão: cada ocorrência futura consumiria limite desde já. Lance na conta de onde a fatura é paga.",
      };
    }

    const plano = planoDeRecorrencia({
      valorCents: i.amountCents,
      ocorrencias: i.ocorrencias,
      dataInicial: i.occurredOn,
    });

    const groupId = crypto.randomUUID();
    const linhas = plano.map((ocorrencia) => ({
      user_id: user.id,
      account_id: i.accountId,
      category_id: i.categoryId,
      kind: "expense",
      amount_cents: ocorrencia.amountCents,
      /*
        SEM o sufixo "(3/12)" que o parcelamento acrescenta. No extrato, "(3/12)"
        significa PARCELA — e confundir os dois é o erro que esta separação
        inteira existe para evitar. A tela mostra "3 de 12 · recorrente" a partir
        das colunas, que é onde a distinção pode vir com o tipo junto.
      */
      description: i.description,
      occurred_on: ocorrencia.occurredOn,
      // Nada foi pago ainda — nem a primeira. O dinheiro sai quando sair, e é a
      // ação "Pagar" que registra isso.
      is_paid: false,
      paid_cents: 0,
      installment_group_id: groupId,
      installment_no: ocorrencia.numero,
      installment_total: ocorrencia.total,
      serie_tipo: "recorrencia",
      // Recorrência não vai em cartão (acima), logo não pertence a fatura nenhuma.
      statement_month: null,
    }));

    // UM insert com array, como no parcelamento: o PostgREST não dá transação
    // entre chamadas, e N chamadas deixariam a série gravada pela metade.
    const { data, error } = await supabase
      .from("finance_transactions")
      .insert(linhas)
      .select("id");
    if (error) return { ok: false, error: error.message };

    const ids = ((data as { id: string }[] | null) ?? []).map((linha) => linha.id);
    if (ids.length !== linhas.length) {
      return { ok: false, error: "Não foi possível registrar todas as ocorrências." };
    }

    if (i.tagIds.length > 0) {
      // Falha aqui não derruba a operação: a série já está gravada, e devolver
      // erro faria o usuário repetir o formulário e criar uma SEGUNDA série.
      await supabase.from("finance_transaction_tags").insert(
        ids.flatMap((transactionId) =>
          i.tagIds.map((tagId) => ({ transaction_id: transactionId, tag_id: tagId, user_id: user.id })),
        ),
      );
    }

    await audit("recurring_series", "created", groupId);
    revalidate();
    return { ok: true, id: groupId };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Encerra uma RECORRÊNCIA: apaga as ocorrências a partir desta.
 *
 * =============================================================================
 * ⚠️ SÓ PARA RECORRÊNCIA. NUNCA PARA PARCELAMENTO.
 * =============================================================================
 * Você sai do imóvel no terceiro mês e os nove aluguéis seguintes deixam de
 * existir — é o caso que dá sentido a esta operação.
 *
 * Apagar parcelas futuras de uma compra parcelada apagaria DÍVIDA QUE CONTINUA
 * EXISTINDO: o sofá já está na sala, e o banco vai cobrar as nove restantes de
 * qualquer jeito. O sistema passaria a mostrar que você deve menos do que deve,
 * que é o pior sentido para um número de dinheiro errar.
 *
 * Quem quiser mesmo apagar um parcelamento usa `deleteTransaction`, que apaga o
 * GRUPO INTEIRO — inclusive as já pagas — e avisa disso no diálogo. É uma
 * operação diferente, com uma confirmação diferente.
 */
export async function cancelarFuturasDaSerie(transactionId: string): Promise<ActionResult> {
  if (!lerUuid(transactionId)) return { ok: false, error: ID_INVALIDO };
  try {
    const { supabase } = await requireUser();

    const { data } = await supabase
      .from("finance_transactions")
      .select("installment_group_id, installment_no, serie_tipo")
      .eq("id", transactionId)
      .maybeSingle();

    const alvo = data as {
      installment_group_id: string | null;
      installment_no: number | null;
      serie_tipo: string | null;
    } | null;
    if (!alvo) return { ok: false, error: "Lançamento não encontrado." };

    if (alvo.serie_tipo !== "recorrencia") {
      return {
        ok: false,
        error:
          "Só recorrência pode ser encerrada. Apagar parcelas futuras apagaria dívida que continua existindo.",
      };
    }
    if (alvo.installment_group_id === null || alvo.installment_no === null) {
      return { ok: false, error: "Este lançamento não faz parte de uma série." };
    }

    /*
      A partir DESTA ocorrência, inclusive. Quem clica em "encerrar" na
      ocorrência de novembro está dizendo "novembro em diante não acontece" — e
      as já pagas ficam, porque elas aconteceram de verdade.
    */
    const { data: apagados, error } = await supabase
      .from("finance_transactions")
      .delete()
      .eq("installment_group_id", alvo.installment_group_id)
      .gte("installment_no", alvo.installment_no)
      .eq("paid_cents", 0)
      .select("id");

    if (error) return { ok: false, error: error.message };
    const quantos = ((apagados as { id: string }[] | null) ?? []).length;
    if (quantos === 0) {
      return { ok: false, error: "Nenhuma ocorrência futura em aberto para encerrar." };
    }

    await audit("recurring_series", "ended", alvo.installment_group_id);
    revalidate();
    return { ok: true, id: alvo.installment_group_id };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Pagamento de fatura = TRANSFERÊNCIA da conta para o cartão.
 *
 * Não é um terceiro modelo: são as mesmas duas pernas unidas por
 * `transfer_group_id` que `createTransfer` já grava — saída (expense) na conta
 * de onde o dinheiro sai, entrada (income) no cartão. A perna que entra no
 * cartão é exatamente o que `ehPagamentoDeFatura()` reconhece (kind 'income' +
 * transfer_group_id não nulo), e por isso `faturaDoCartao()` a EXCLUI do total:
 * se ela somasse, pagar R$ 500 abateria R$ 500 de compras e a fatura pareceria
 * quitada no mês em que a dívida foi contraída.
 *
 * Modelar assim também é o que impede a despesa de ser contada duas vezes: a
 * compra pesa no cartão, o pagamento pesa na conta corrente, e as duas pernas
 * são filtradas dos totais de receita/despesa por `isTransfer()`.
 */
export async function payStatement(input: unknown): Promise<ActionResult> {
  const parsed = financeStatementPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  try {
    const { supabase, user } = await requireUser();
    const i = parsed.data;

    const contas = await carregarContas(supabase, [i.cardAccountId, i.fromAccountId]);
    const cartao = contas.get(i.cardAccountId);
    const origem = contas.get(i.fromAccountId);
    if (!cartao || !origem) return { ok: false, error: "Conta não encontrada." };

    if (cartao.kind !== "credit_card") {
      return { ok: false, error: "O destino do pagamento precisa ser um cartão de crédito." };
    }
    // Pagar cartão com cartão não é pagamento, é troca de dívida — e o modelo
    // não sabe representar isso: as duas pernas virariam pagamento de fatura e
    // uma dívida sumiria da soma.
    if (origem.kind === "credit_card") {
      return { ok: false, error: "Não dá para pagar um cartão com outro cartão." };
    }

    const groupId = crypto.randomUUID();
    const [ano, mes] = [i.mesFatura.slice(0, 4), i.mesFatura.slice(5, 7)];
    const description = `Pagamento da fatura ${mes}/${ano}`;

    const linhas: Record<string, unknown>[] = [
      {
        user_id: user.id,
        account_id: i.fromAccountId,
        kind: "expense",
        amount_cents: i.amountCents,
        description,
        occurred_on: i.occurredOn,
        transfer_group_id: groupId,
        // A conta de origem não é cartão (recusado acima), logo não tem fatura.
        statement_month: null,
      },
      {
        user_id: user.id,
        account_id: i.cardAccountId,
        kind: "income",
        amount_cents: i.amountCents,
        description,
        occurred_on: i.occurredOn,
        transfer_group_id: groupId,
        // A fatura QUITADA, escolhida pelo usuário — não a fatura da data do
        // pagamento. É o que permite reconciliar "esta fatura foi paga", e é
        // dele que sai o `paidCents` de `faturaDoCartao()`: sem este mês
        // gravado, "quanto já paguei da fatura de abril" não teria resposta e
        // o formulário voltaria a sugerir o total bruto depois de um pagamento
        // parcial.
        //
        // ATENÇÃO a quem for somar por statement_month: esta linha está dentro
        // do mês da fatura e ANULARIA o total dela. Qualquer soma por
        // statement_month precisa excluir income com transfer_group_id, que é
        // o que `faturaDoCartao()` faz via `ehPagamentoDeFatura()` — lá ela sai
        // do total e entra no pago.
        statement_month: i.mesFatura,
      },
    ];

    /*
      =========================================================================
      O ROTATIVO — e o que ele NÃO gera
      =========================================================================
      ⚠️ NENHUM lançamento é criado para o PRINCIPAL que rolou. Ele já foi
      contado quando cada compra aconteceu, e continua exatamente onde estava: na
      fatura de origem, em aberto, pesando em `debt_cents`. Criar aqui um
      "saldo remanescente" na fatura seguinte contaria a MESMA despesa duas
      vezes — o erro que o Dashboard já documenta ter corrigido no patrimônio.

      O que é despesa nova são os ENCARGOS, e só eles.

      O saldo é lido do BANCO, não do que o formulário mandou: a tela do usuário
      pode estar desatualizada (outro pagamento registrado em outra aba), e
      juros sobre um saldo que já não existe é dinheiro inventado.
    */
    let encargos = { jurosCents: 0, iofCents: 0, totalCents: 0 };
    if (i.taxaMensalPercent > 0 || i.iofCents > 0) {
      if (cartao.statement_closing_day === null) {
        return {
          ok: false,
          error:
            "Sem dia de fechamento cadastrado não dá para saber em que fatura os juros caem. Edite o cartão.",
        };
      }

      const doCartao = await linhasDaFatura(supabase, i.cardAccountId, i.mesFatura);
      const { openCents } = faturaDoCartao(
        doCartao,
        { id: i.cardAccountId, statement_closing_day: cartao.statement_closing_day },
        i.mesFatura,
      );
      // O que sobra DEPOIS deste pagamento. Piso em zero: pagar mais do que se
      // deve não gera juros negativos, gera crédito a favor.
      const restante = Math.max(0, openCents - i.amountCents);
      encargos = calcularEncargos({
        saldoRemanescenteCents: restante,
        taxaMensalPercent: i.taxaMensalPercent,
        iofCents: i.iofCents,
      });

      if (encargos.totalCents > 0) {
        const categoriaId = await categoriaDeEncargos(supabase, user.id);
        const mesDoEncargo = faturaDoEncargo(
          i.mesFatura,
          i.occurredOn,
          cartao.statement_closing_day,
        );
        linhas.push({
          user_id: user.id,
          account_id: i.cardAccountId,
          category_id: categoriaId,
          kind: "expense",
          amount_cents: encargos.totalCents,
          description:
            encargos.iofCents > 0
              ? `Juros e IOF sobre a fatura ${mes}/${ano}`
              : `Juros sobre a fatura ${mes}/${ano}`,
          occurred_on: i.occurredOn,
          // Sem `transfer_group_id`: o encargo NÃO faz parte da transferência.
          // Amarrá-lo ao grupo o transformaria numa perna, `isTransfer()` o
          // excluiria dos totais e os juros sumiriam das despesas do mês — que é
          // o único lugar onde eles precisam aparecer.
          is_paid: true,
          statement_month: mesDoEncargo,
        });
      }
    }

    /*
      UM único `.insert([...])` com as duas ou três linhas.

      O PostgREST não dá transação entre chamadas: inserir os encargos numa
      segunda chamada deixaria, no caso de falha, um pagamento gravado e um
      encargo perdido — ou pior, um encargo gravado sem o pagamento que o
      justifica. Um array é UM comando no Postgres. É a mesma razão de
      `createInstallmentPurchase` inserir as doze parcelas de uma vez.
    */
    const { data, error } = await supabase
      .from("finance_transactions")
      .insert(linhas)
      .select("id");

    if (error) return { ok: false, error: error.message };
    if (((data as { id: string }[] | null) ?? []).length !== linhas.length) {
      return { ok: false, error: "Não foi possível registrar o pagamento." };
    }

    // Metadados apenas: o grupo identifica o pagamento, o valor nunca é gravado.
    await audit("statement_payment", "created", groupId);
    revalidate();
    return { ok: true, id: groupId };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Pagar UM lançamento — total ou parcialmente, com juros se houver.
 *
 * =============================================================================
 * ⚠️ O RESTANTE **NÃO** VIRA LANÇAMENTO NOVO
 * =============================================================================
 * É a mesma regra do rotativo de fatura, e o mesmo motivo: a despesa já foi
 * contada quando foi lançada. Criar uma linha de "saldo remanescente" contaria a
 * mesma saída duas vezes — o erro que o Painel já documenta ter corrigido no
 * cálculo de patrimônio.
 *
 * O que muda é `paid_cents`. O restante continua na MESMA linha, agora
 * parcialmente paga, e aparece na Dívida pelo que falta (ver
 * `horizontesDoDinheiro`).
 *
 * ⚠️ E O QUE É DESPESA NOVA SÃO OS ENCARGOS. Só eles viram linha.
 *
 * =============================================================================
 * POR QUE NÃO HÁ "CONTA DE ORIGEM"
 * =============================================================================
 * Um lançamento avulso já está NA conta de onde o dinheiro sai. Pagá-lo é
 * registrar que ele saiu dali — e a view soma `paid_cents`, então o saldo se
 * move sozinho. Um campo "pagar com" seria um no-op (a mesma conta) ou criaria
 * uma transferência que contaria a saída duas vezes. Ver
 * `financeTransactionPaymentSchema`.
 */
export async function payTransaction(input: unknown): Promise<ActionResult> {
  const parsed = financeTransactionPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  try {
    const { supabase, user } = await requireUser();
    const bloqueio = bloqueioPorLimite("financeiro:lancamento", user.id);
    if (bloqueio) return bloqueio;

    const i = parsed.data;

    const { data: linha } = await supabase
      .from("finance_transactions")
      .select("id, account_id, kind, amount_cents, paid_cents, transfer_group_id, description")
      .eq("id", i.transactionId)
      .maybeSingle();

    const alvo = linha as Pick<
      FinanceTransaction,
      | "id"
      | "account_id"
      | "kind"
      | "amount_cents"
      | "paid_cents"
      | "transfer_group_id"
      | "description"
    > | null;
    // `null` também quando a linha é de outro usuário: a RLS a esconde, e a
    // mensagem é a mesma de propósito — não revela que ela existe.
    if (!alvo) return { ok: false, error: "Lançamento não encontrado." };

    if (alvo.transfer_group_id !== null) {
      return {
        ok: false,
        error: "Transferência não se paga: as duas pernas já aconteceram quando ela foi criada.",
      };
    }

    const contas = await carregarContas(supabase, [alvo.account_id]);
    const conta = contas.get(alvo.account_id);
    if (!conta) return { ok: false, error: "Conta não encontrada." };

    // Em cartão quem se paga é a FATURA, não a compra. `payStatement` já faz
    // isso, com rotativo — e o gatilho da 0023 mantém toda linha de cartão
    // quitada, então não existe o que pagar aqui.
    if (conta.kind === "credit_card") {
      return {
        ok: false,
        error: "Compra no cartão não se paga sozinha: pague a FATURA, em Contas.",
      };
    }

    const restante = alvo.amount_cents - alvo.paid_cents;
    if (restante <= 0) return { ok: false, error: "Este lançamento já está quitado." };
    if (i.amountCents > restante) {
      return {
        ok: false,
        error: `Falta pagar apenas ${(restante / 100).toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        })}.`,
      };
    }

    /*
      ⚠️ TRAVA OTIMISTA: o `eq("paid_cents", ...)` é o que impede duas abas de
      pagarem a mesma coisa duas vezes.

      Sem ele, dois pagamentos concorrentes leem `paid_cents = 0`, ambos gravam
      300, e a linha fica com 300 pagos depois de 600 terem saído da conta. Com
      ele, o segundo não encontra linha para atualizar e recebe um erro que pede
      para recarregar — que é a verdade.

      O PostgREST não dá transação entre chamadas; esta é a forma de obter a
      atomicidade que importa aqui sem uma.
    */
    const novoPago = alvo.paid_cents + i.amountCents;
    const { data: atualizado, error: erroUpdate } = await supabase
      .from("finance_transactions")
      .update({ paid_cents: novoPago })
      .eq("id", alvo.id)
      .eq("paid_cents", alvo.paid_cents)
      .select("id");

    if (erroUpdate) return { ok: false, error: erroUpdate.message };
    if (((atualizado as { id: string }[] | null) ?? []).length === 0) {
      return {
        ok: false,
        error: "Este lançamento mudou em outra aba. Recarregue a página e tente de novo.",
      };
    }

    /*
      Os encargos, e SÓ se sobrou saldo. Quitando por inteiro não há rotativo, e
      uma taxa esquecida no campo não pode virar despesa do nada.

      Eles nascem NÃO PAGOS: o juro é uma dívida nova, que ainda vai sair. Marcá-lo
      como pago tiraria o dinheiro da conta no instante em que ele foi cobrado —
      e ninguém paga juros no mesmo gesto em que deixa de pagar o principal.
    */
    const sobra = restante - i.amountCents;
    if (alvo.kind === "expense" && sobra > 0 && (i.taxaMensalPercent > 0 || i.iofCents > 0)) {
      const encargos = calcularEncargos({
        saldoRemanescenteCents: sobra,
        taxaMensalPercent: i.taxaMensalPercent,
        iofCents: i.iofCents,
      });
      if (encargos.totalCents > 0) {
        const categoriaId = await categoriaDeEncargos(supabase, user.id);
        await supabase.from("finance_transactions").insert({
          user_id: user.id,
          account_id: alvo.account_id,
          category_id: categoriaId,
          kind: "expense",
          amount_cents: encargos.totalCents,
          description: `Juros sobre ${alvo.description}`,
          occurred_on: i.occurredOn,
          is_paid: false,
          paid_cents: 0,
          // Fora de cartão não há fatura a que pertencer.
          statement_month: null,
        });
      }
    }

    await audit("transaction", "paid", alvo.id);
    revalidate();
    return { ok: true, id: alvo.id };
  } catch (e) {
    return fail(e);
  }
}

/* --------------------------------------------------------------- orçamentos */

export async function upsertBudget(input: unknown): Promise<ActionResult> {
  const parsed = financeBudgetSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  try {
    const { supabase, user } = await requireUser();
    const i = parsed.data;
    const { data, error } = await supabase
      .from("finance_budgets")
      .upsert(
        {
          user_id: user.id,
          category_id: i.categoryId,
          month: i.month,
          limit_cents: i.limitCents,
        },
        { onConflict: "user_id,category_id,month" },
      )
      .select("id");
    if (error) return { ok: false, error: error.message };
    // Mesma checagem de zero linhas das outras escritas. Aqui ela é remota (o
    // upsert insere quando não acha conflito), mas o custo é um `select("id")` e
    // o silêncio custaria um limite que o usuário acredita ter definido.
    if (!data || data.length === 0) {
      return { ok: false, error: "Não foi possível salvar o orçamento." };
    }
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteBudget(id: string): Promise<ActionResult> {
  if (!lerUuid(id)) return { ok: false, error: ID_INVALIDO };
  try {
    const { supabase } = await requireUser();
    const { error } = await supabase.from("finance_budgets").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
