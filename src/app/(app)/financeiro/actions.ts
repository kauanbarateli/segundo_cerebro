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
  financeStatementPaymentSchema,
  financeBudgetSchema,
} from "@/lib/validation";
import {
  faturaDe,
  planoDeParcelas,
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
      is_paid: i.isPaid,
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
    const diaFechamento =
      conta.kind === "credit_card" ? conta.statement_closing_day : null;

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
      // `is_paid` true, como em qualquer compra no cartão: a dívida já existe
      // por inteiro no instante da compra. É isso que faz `debt_cents` e
      // `available_cents` da view refletirem o limite realmente comprometido —
      // marcar as parcelas futuras como não pagas mostraria limite disponível
      // que o cartão não te dá.
      is_paid: true,
      installment_group_id: groupId,
      installment_no: parcela.numero,
      installment_total: parcela.total,
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

    const { data, error } = await supabase
      .from("finance_transactions")
      .insert([
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
      ])
      .select("id");

    if (error) return { ok: false, error: error.message };
    if (((data as { id: string }[] | null) ?? []).length !== 2) {
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
