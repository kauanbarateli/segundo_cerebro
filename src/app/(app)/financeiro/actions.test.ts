import { beforeEach, describe, expect, it, vi } from "vitest";
import { zerarLimites } from "@/lib/rate-limit";
import type { FinanceAccountKind } from "@/lib/database.types";

/**
 * =============================================================================
 * O LIMITE DO CARTÃO PRECISA SER CONSUMIDO — E ISSO DEPENDE DE `is_paid`
 * =============================================================================
 * A view `finance_account_balances` junta as transações com `and t.is_paid =
 * true` (0005:267, preservado na 0010:431). Uma linha de cartão com
 * `is_paid = false` some de `balance_cents`, `debt_cents` fica zero e
 * `available_cents` não se move: a compra existe na lista e não existe no
 * limite.
 *
 * Este arquivo prova que nenhuma entrada consegue produzir esse estado pela
 * action. E ele exercita a action DE VERDADE, contra um cliente Supabase falso,
 * porque o que precisa ser provado é o VALOR GRAVADO — uma varredura no texto do
 * arquivo (o padrão de `guards.test.ts`) aprovaria uma implementação que
 * calcula o valor certo e grava o errado.
 *
 * ⚠️ O CASO DECISIVO É `isPaid: false` NA ENTRADA. Não basta testar o caminho
 * do formulário: uma Server Action É um endpoint HTTP, e um POST montado à mão
 * — ou uma aba aberta antes desta correção — manda o que quiser. Se a regra
 * viver só no formulário, ela não existe.
 */

/* --------------------------------------------------------- Supabase falso */

interface Resposta {
  data: unknown;
  error: unknown;
}

/**
 * Cadeia do PostgREST: todo filtro devolve `this`, e o `await` no fim resolve.
 *
 * `single()`/`maybeSingle()` trocam a FORMA da resposta (objeto em vez de
 * lista), e isso precisa estar aqui: `upsertTransaction` faz
 * `.insert(row).select("id").single()` e lê `data.id`. Um falso que devolvesse
 * sempre lista quebraria por um motivo que não tem nada a ver com o que se
 * testa.
 */
class Cadeia implements PromiseLike<Resposta> {
  private singular = false;

  constructor(private readonly resolver: () => Resposta) {}

  select(): this {
    return this;
  }
  eq(): this {
    return this;
  }
  in(): this {
    return this;
  }
  is(): this {
    return this;
  }
  not(): this {
    return this;
  }
  or(): this {
    return this;
  }
  gt(): this {
    return this;
  }
  gte(): this {
    return this;
  }
  lte(): this {
    return this;
  }
  order(): this {
    return this;
  }
  range(): this {
    return this;
  }
  single(): this {
    this.singular = true;
    return this;
  }
  maybeSingle(): this {
    this.singular = true;
    return this;
  }

  then<R1 = Resposta, R2 = never>(
    aoResolver?: ((valor: Resposta) => R1 | PromiseLike<R1>) | null,
    aoRejeitar?: ((motivo: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    const bruto = this.resolver();
    const data = this.singular
      ? Array.isArray(bruto.data)
        ? (bruto.data[0] ?? null)
        : bruto.data
      : bruto.data;
    return Promise.resolve({ data, error: bruto.error }).then(aoResolver, aoRejeitar);
  }
}

interface Escrita {
  tabela: string;
  operacao: "insert" | "update" | "delete" | "upsert";
  linhas: Record<string, unknown>[];
}

interface Conta {
  id: string;
  kind: FinanceAccountKind;
  statement_closing_day: number | null;
}

function criarBanco(contas: Conta[], lancamentos: Record<string, unknown>[] = []) {
  const escritas: Escrita[] = [];
  /*
    As leituras de `finance_transactions` são PAGINADAS no código real (o
    PostgREST corta em 1000 linhas sem avisar). O falso precisa devolver a lista
    na primeira página e vazio depois — devolvendo sempre a mesma lista, o laço
    de páginas nunca terminaria e o teste travaria em vez de falhar.
  */
  let paginasDeLancamento = 0;

  function registrar(
    tabela: string,
    operacao: Escrita["operacao"],
    payload: unknown,
  ): Record<string, unknown>[] {
    const linhas = (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];
    escritas.push({ tabela, operacao, linhas });
    return linhas;
  }

  const cliente = {
    auth: {
      getUser: async () => ({ data: { user: { id: "usuario-1" } }, error: null }),
    },
    from(tabela: string) {
      return {
        select: () =>
          new Cadeia(() => {
            if (tabela === "finance_accounts") return { data: contas, error: null };
            if (tabela === "finance_transactions") {
              return { data: paginasDeLancamento++ === 0 ? lancamentos : [], error: null };
            }
            return { data: [], error: null };
          }),
        insert: (payload: unknown) => {
          const linhas = registrar(tabela, "insert", payload);
          return new Cadeia(() => ({
            data: linhas.map((_, i) => ({ id: `${tabela}-${i + 1}` })),
            error: null,
          }));
        },
        update: (payload: unknown) => {
          registrar(tabela, "update", payload);
          return new Cadeia(() => ({ data: [{ id: "linha-1" }], error: null }));
        },
        upsert: (payload: unknown) => {
          const linhas = registrar(tabela, "upsert", payload);
          return new Cadeia(() => ({
            data: linhas.map((_, i) => ({ id: `${tabela}-${i + 1}` })),
            error: null,
          }));
        },
        delete: () => {
          registrar(tabela, "delete", {});
          return new Cadeia(() => ({ data: [], error: null }));
        },
      };
    },
  };

  return { cliente, escritas };
}

/*
  O suporte precisa ser MUTÁVEL: `vi.mock` é içado para cima dos imports, então
  a fábrica não pode fechar sobre um valor definido depois. Ela lê o suporte no
  momento da chamada, e cada teste troca o cliente antes de agir.
*/
const suporte: { cliente: unknown } = { cliente: null };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => suporte.cliente,
}));

// Import dinâmico pelo mesmo motivo: os mocks precisam estar de pé antes de o
// módulo sob teste resolver suas dependências.
const {
  upsertTransaction,
  upsertAccount,
  payStatement,
  payTransaction,
  createRecurringSeries,
  createInstallmentPurchase,
  cancelarFuturasDaSerie,
} = await import("./actions");

/** Só as escritas de lançamento — auditoria e etiquetas são ruído aqui. */
function lancamentosGravados(escritas: Escrita[]): Record<string, unknown>[] {
  return escritas
    .filter((e) => e.tabela === "finance_transactions" && e.operacao !== "delete")
    .flatMap((e) => e.linhas);
}

const CARTAO: Conta = { id: "11111111-1111-4111-8111-111111111111", kind: "credit_card", statement_closing_day: 15 };
const CORRENTE: Conta = { id: "22222222-2222-4222-8222-222222222222", kind: "checking", statement_closing_day: null };

function entrada(accountId: string, isPaid: boolean) {
  return {
    accountId,
    categoryId: "",
    kind: "expense" as const,
    amountCents: 12_345,
    description: "Compra",
    payee: "",
    occurredOn: "2026-08-10",
    notes: "",
    isPaid,
    tagIds: [],
  };
}

beforeEach(() => {
  // Sem isto a cota de escrita vaza de um caso para o outro e a ORDEM dos
  // testes passa a importar — o começo de uma suíte que só falha no CI.
  zerarLimites();
});

describe("upsertTransaction — is_paid em cartão de crédito", () => {
  it("⚠️ GRAVA `true` mesmo com `isPaid: false` na entrada", async () => {
    /*
      O TESTE QUE JUSTIFICA O ARQUIVO.

      Este era o estado que apagava a dívida: `is_paid = false` numa conta
      `credit_card`. Se esta asserção cair, o limite do cartão voltou a não ser
      consumido — e o sintoma na tela é "disponível" alto demais, que ninguém
      reconhece como defeito.
    */
    const { cliente, escritas } = criarBanco([CARTAO]);
    suporte.cliente = cliente;

    const r = await upsertTransaction(entrada(CARTAO.id, false));

    expect(r.ok, `a action recusou: ${"error" in r ? r.error : ""}`).toBe(true);
    const [linha] = lancamentosGravados(escritas);
    expect(linha?.is_paid).toBe(true);
  });

  it("grava a fatura junto, para a compra não sumir do ciclo", () => {
    // Companheira da anterior: `is_paid` faz a compra pesar no LIMITE,
    // `statement_month` faz ela aparecer na FATURA. Uma sem a outra deixa a
    // barra de limite e a lista da fatura discordando.
    const { cliente, escritas } = criarBanco([CARTAO]);
    suporte.cliente = cliente;

    return upsertTransaction(entrada(CARTAO.id, false)).then(() => {
      const [linha] = lancamentosGravados(escritas);
      // Compra em 10/08 com fechamento dia 15 -> ainda entra na fatura de agosto.
      expect(linha?.statement_month).toBe("2026-08-01");
    });
  });

  it("conta corrente CONTINUA respeitando o que o usuário marcou", async () => {
    /*
      O contrapeso, e ele não é formalidade: forçar `is_paid` em toda conta
      destruiria a despesa agendada — um estado real e útil fora de cartão, onde
      `available_cents` já é NULL por desenho (0010) e não há limite a consumir.
    */
    const { cliente, escritas } = criarBanco([CORRENTE]);
    suporte.cliente = cliente;

    const r = await upsertTransaction(entrada(CORRENTE.id, false));

    expect(r.ok).toBe(true);
    const [linha] = lancamentosGravados(escritas);
    expect(linha?.is_paid).toBe(false);
  });

  it("conta corrente com `isPaid: true` grava true — o caminho comum", async () => {
    const { cliente, escritas } = criarBanco([CORRENTE]);
    suporte.cliente = cliente;

    await upsertTransaction(entrada(CORRENTE.id, true));

    expect(lancamentosGravados(escritas)[0]?.is_paid).toBe(true);
  });
});

describe("upsertAccount — converter uma conta comum em cartão", () => {
  it("normaliza `is_paid` dos lançamentos que já existiam", async () => {
    /*
      O CAMINHO DE CONSERTO DE UM CARTÃO CADASTRADO COM O TIPO ERRADO.

      Sem este passo a correção fica pela metade: a conta vira cartão, ganha
      limite, e as compras antigas continuam com `is_paid = false` — legítimo
      enquanto ela era corrente. `debt_cents` seguiria zero e a tela mostraria o
      limite inteiro disponível.

      O gatilho da 0022 não cobre isto sozinho: ele age na escrita de
      `finance_transactions`, e trocar o tipo da CONTA não escreve em nenhuma
      delas.
    */
    const { cliente, escritas } = criarBanco([CORRENTE]);
    suporte.cliente = cliente;

    const r = await upsertAccount({
      id: CORRENTE.id,
      name: "Mercado Pago",
      kind: "credit_card",
      institution: "",
      openingBalanceCents: 0,
      colorKey: "stone",
      creditLimitCents: 500_000,
      statementClosingDay: 22,
      paymentDueDay: 30,
    });

    expect(r.ok, `a action recusou: ${"error" in r ? r.error : ""}`).toBe(true);

    const normalizacao = escritas.find(
      (e) =>
        e.tabela === "finance_transactions" &&
        e.operacao === "update" &&
        e.linhas.some((l) => l.is_paid === true),
    );
    expect(normalizacao, "a conversão para cartão não normalizou is_paid").toBeDefined();
  });

  it("conta que continua NÃO sendo cartão não tem `is_paid` mexido", async () => {
    // O espelho do anterior. Um `update` de is_paid aqui apagaria a despesa
    // agendada de quem só renomeou a conta corrente.
    const { cliente, escritas } = criarBanco([CORRENTE]);
    suporte.cliente = cliente;

    await upsertAccount({
      id: CORRENTE.id,
      name: "Conta do dia a dia",
      kind: "checking",
      institution: "",
      openingBalanceCents: 0,
      colorKey: "stone",
    });

    const mexeu = escritas.some(
      (e) => e.tabela === "finance_transactions" && e.linhas.some((l) => "is_paid" in l),
    );
    expect(mexeu).toBe(false);
  });
});

describe("payStatement — pagamento parcial com juros", () => {
  const CONTA_ORIGEM = CORRENTE;
  /** Uma compra de R$ 1.000 na fatura de agosto do cartão. */
  const COMPRA = {
    id: "tx-1",
    user_id: "usuario-1",
    account_id: CARTAO.id,
    category_id: null,
    kind: "expense",
    amount_cents: 100_000,
    description: "Compra",
    payee: null,
    occurred_on: "2026-08-05",
    transfer_group_id: null,
    notes: null,
    is_paid: true,
    created_at: "",
    updated_at: "",
    installment_group_id: null,
    installment_no: null,
    installment_total: null,
    statement_month: "2026-08-01",
  };

  function pagamento(over: Record<string, unknown> = {}) {
    return {
      cardAccountId: CARTAO.id,
      fromAccountId: CONTA_ORIGEM.id,
      mesFatura: "2026-08-01",
      amountCents: 40_000,
      occurredOn: "2026-08-20",
      ...over,
    };
  }

  it("sem taxa: grava SÓ as duas pernas da transferência", async () => {
    const { cliente, escritas } = criarBanco([CARTAO, CONTA_ORIGEM], [COMPRA]);
    suporte.cliente = cliente;

    const r = await payStatement(pagamento());

    expect(r.ok, `a action recusou: ${"error" in r ? r.error : ""}`).toBe(true);
    expect(lancamentosGravados(escritas)).toHaveLength(2);
  });

  it("⚠️ COM TAXA: gera UM lançamento a mais — os ENCARGOS, nunca o principal", async () => {
    /*
      O TESTE DE INVARIANTE DESTA ETAPA.

      O saldo que rola para o mês seguinte JÁ FOI CONTADO, uma vez por compra.
      Um terceiro lançamento de "saldo remanescente" contaria a MESMA despesa
      duas vezes — e o sintoma seria uma dívida que cresce sozinha a cada
      pagamento parcial, que é o oposto do que um pagamento faz.

      Três linhas, e a terceira vale exatamente os juros: R$ 600 de saldo
      restante (1.000 − 400) a 10% ao mês = R$ 60.
    */
    const { cliente, escritas } = criarBanco([CARTAO, CONTA_ORIGEM], [COMPRA]);
    suporte.cliente = cliente;

    const r = await payStatement(pagamento({ taxaMensalPercent: 10 }));

    expect(r.ok, `a action recusou: ${"error" in r ? r.error : ""}`).toBe(true);
    const linhas = lancamentosGravados(escritas);
    expect(linhas).toHaveLength(3);

    const encargo = linhas[2]!;
    expect(encargo.amount_cents).toBe(6_000);
    expect(encargo.account_id).toBe(CARTAO.id);
    expect(encargo.kind).toBe("expense");
    // O valor do PRINCIPAL não aparece em lançamento nenhum.
    expect(linhas.some((l) => l.amount_cents === 60_000)).toBe(false);
  });

  it("o encargo NÃO carrega transfer_group_id — senão sumiria das despesas", async () => {
    /*
      Amarrar o encargo ao grupo da transferência o transformaria numa perna:
      `isTransfer()` o excluiria de toda soma de despesa, e os juros — a única
      coisa que o rotativo cria de novo — não apareceriam em lugar nenhum.
    */
    const { cliente, escritas } = criarBanco([CARTAO, CONTA_ORIGEM], [COMPRA]);
    suporte.cliente = cliente;

    await payStatement(pagamento({ taxaMensalPercent: 10 }));

    const encargo = lancamentosGravados(escritas)[2]!;
    expect(encargo.transfer_group_id).toBeUndefined();
    expect(encargo.is_paid).toBe(true);
  });

  it("o encargo cai na fatura SEGUINTE, não na que está sendo paga", async () => {
    // Fatura de agosto paga em 20/08, fechamento dia 15 -> a fatura de 20/08 já
    // é a de setembro. `faturaDoEncargo` também protege o pagamento ANTECIPADO,
    // que é o caso em que a data sozinha devolveria a própria fatura paga.
    const { cliente, escritas } = criarBanco([CARTAO, CONTA_ORIGEM], [COMPRA]);
    suporte.cliente = cliente;

    await payStatement(pagamento({ taxaMensalPercent: 10 }));

    expect(lancamentosGravados(escritas)[2]!.statement_month).toBe("2026-09-01");
  });

  it("pagando a fatura INTEIRA não há encargo, mesmo com taxa informada", async () => {
    // Não sobra saldo, não há rotativo. O piso em zero de `calcularEncargos` é o
    // que impede uma taxa esquecida no campo de virar despesa do nada.
    const { cliente, escritas } = criarBanco([CARTAO, CONTA_ORIGEM], [COMPRA]);
    suporte.cliente = cliente;

    await payStatement(pagamento({ amountCents: 100_000, taxaMensalPercent: 10 }));

    expect(lancamentosGravados(escritas)).toHaveLength(2);
  });

  it("IOF sozinho, sem juros, ainda gera o lançamento", async () => {
    const { cliente, escritas } = criarBanco([CARTAO, CONTA_ORIGEM], [COMPRA]);
    suporte.cliente = cliente;

    await payStatement(pagamento({ taxaMensalPercent: 0, iofCents: 1_234 }));

    const linhas = lancamentosGravados(escritas);
    expect(linhas).toHaveLength(3);
    expect(linhas[2]!.amount_cents).toBe(1_234);
  });

  it("recusa a cobrança de juros em cartão sem dia de fechamento", async () => {
    // Sem fechamento não há como saber em que fatura os juros caem. Recusar é
    // melhor que escolher uma fatura por conta própria e errar em silêncio.
    const semFechamento: Conta = {
      id: CARTAO.id,
      kind: "credit_card",
      statement_closing_day: null,
    };
    const { cliente, escritas } = criarBanco([semFechamento, CONTA_ORIGEM], [COMPRA]);
    suporte.cliente = cliente;

    const r = await payStatement(pagamento({ taxaMensalPercent: 10 }));

    expect(r.ok).toBe(false);
    // E nada foi gravado: o pagamento inteiro é recusado, não gravado pela metade.
    expect(lancamentosGravados(escritas)).toHaveLength(0);
  });
});

describe("payTransaction — pagar um lançamento avulso", () => {
  /** Uma despesa de R$ 800 numa conta corrente, ainda não paga. */
  function despesa(over: Record<string, unknown> = {}) {
    return {
      id: "33333333-3333-4333-8333-333333333333",
      user_id: "usuario-1",
      account_id: CORRENTE.id,
      category_id: null,
      kind: "expense",
      amount_cents: 80_000,
      paid_cents: 0,
      description: "Conserto",
      payee: null,
      occurred_on: "2026-08-01",
      transfer_group_id: null,
      notes: null,
      is_paid: false,
      created_at: "",
      updated_at: "",
      installment_group_id: null,
      installment_no: null,
      installment_total: null,
      statement_month: null,
      serie_tipo: null,
      ...over,
    };
  }

  const ID = "33333333-3333-4333-8333-333333333333";

  it("⚠️ PAGAMENTO PARCIAL MEXE EM `paid_cents` E NÃO CRIA LANÇAMENTO NENHUM", async () => {
    /*
      O TESTE DE INVARIANTE DO R4.

      O restante já foi contado quando a despesa foi lançada. Uma linha nova de
      "saldo remanescente" contaria a mesma saída duas vezes — e o sintoma seria
      uma dívida que CRESCE a cada pagamento, o oposto do que pagar faz.
    */
    const { cliente, escritas } = criarBanco([CORRENTE], [despesa()]);
    suporte.cliente = cliente;

    const r = await payTransaction({
      transactionId: ID,
      amountCents: 30_000,
      occurredOn: "2026-08-20",
    });

    expect(r.ok, `a action recusou: ${"error" in r ? r.error : ""}`).toBe(true);

    const escritasDeTx = escritas.filter((e) => e.tabela === "finance_transactions");
    // UMA escrita, e ela é um update de paid_cents. Nenhum insert.
    expect(escritasDeTx.every((e) => e.operacao === "update")).toBe(true);
    expect(escritasDeTx[0]!.linhas[0]!.paid_cents).toBe(30_000);
  });

  it("acumula sobre o que já havia sido pago", async () => {
    const { cliente, escritas } = criarBanco([CORRENTE], [despesa({ paid_cents: 30_000 })]);
    suporte.cliente = cliente;

    await payTransaction({ transactionId: ID, amountCents: 20_000, occurredOn: "2026-08-20" });

    const update = escritas.find((e) => e.tabela === "finance_transactions");
    expect(update!.linhas[0]!.paid_cents).toBe(50_000);
  });

  it("recusa pagar MAIS do que falta, dizendo quanto falta", async () => {
    // O CHECK `paid_cents <= amount_cents` recusaria no banco, com mensagem crua
    // de constraint. Recusar aqui dá o número que a pessoa precisa.
    const { cliente, escritas } = criarBanco([CORRENTE], [despesa({ paid_cents: 60_000 })]);
    suporte.cliente = cliente;

    const r = await payTransaction({ transactionId: ID, amountCents: 30_000, occurredOn: "2026-08-20" });

    expect(r.ok).toBe(false);
    expect("error" in r && r.error).toContain("200,00");
    expect(escritas.filter((e) => e.tabela === "finance_transactions")).toHaveLength(0);
  });

  it("recusa lançamento já quitado", async () => {
    const { cliente } = criarBanco([CORRENTE], [despesa({ paid_cents: 80_000, is_paid: true })]);
    suporte.cliente = cliente;

    const r = await payTransaction({ transactionId: ID, amountCents: 1_000, occurredOn: "2026-08-20" });
    expect(r.ok).toBe(false);
    expect("error" in r && r.error).toContain("quitado");
  });

  it("⚠️ RECUSA COMPRA DE CARTÃO — quem se paga lá é a FATURA", async () => {
    /*
      Em cartão o gatilho da 0023 mantém toda linha quitada (a dívida existe
      desde a compra), então não há saldo a pagar. Deixar passar criaria um
      segundo mecanismo de pagamento concorrendo com `payStatement`, e os dois
      abateriam a mesma dívida.
    */
    const { cliente, escritas } = criarBanco(
      [CARTAO],
      [despesa({ account_id: CARTAO.id, statement_month: "2026-08-01" })],
    );
    suporte.cliente = cliente;

    const r = await payTransaction({ transactionId: ID, amountCents: 10_000, occurredOn: "2026-08-20" });

    expect(r.ok).toBe(false);
    expect("error" in r && r.error).toContain("FATURA");
    expect(escritas.filter((e) => e.tabela === "finance_transactions")).toHaveLength(0);
  });

  it("recusa perna de transferência — ela já aconteceu quando foi criada", async () => {
    const { cliente } = criarBanco([CORRENTE], [despesa({ transfer_group_id: "g1" })]);
    suporte.cliente = cliente;

    const r = await payTransaction({ transactionId: ID, amountCents: 10_000, occurredOn: "2026-08-20" });
    expect(r.ok).toBe(false);
  });

  it("com juros e saldo remanescente, cria UM lançamento — o de encargos, NÃO PAGO", async () => {
    /*
      R$ 500 de saldo (800 − 300) a 10% ao mês = R$ 50 de juros. Ele nasce com
      `paid_cents = 0`: o juro é dívida nova, que ainda vai sair. Marcá-lo como
      pago tiraria o dinheiro da conta no mesmo gesto em que a pessoa deixou de
      pagar o principal.
    */
    const { cliente, escritas } = criarBanco([CORRENTE], [despesa()]);
    suporte.cliente = cliente;

    const r = await payTransaction({
      transactionId: ID,
      amountCents: 30_000,
      occurredOn: "2026-08-20",
      taxaMensalPercent: 10,
    });

    expect(r.ok, `a action recusou: ${"error" in r ? r.error : ""}`).toBe(true);

    const inserts = escritas.filter(
      (e) => e.tabela === "finance_transactions" && e.operacao === "insert",
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.linhas[0]!.amount_cents).toBe(5_000);
    expect(inserts[0]!.linhas[0]!.paid_cents).toBe(0);
    expect(inserts[0]!.linhas[0]!.is_paid).toBe(false);
    // E o principal continua sem virar linha nova.
    expect(inserts[0]!.linhas[0]!.amount_cents).not.toBe(50_000);
  });

  it("quitando por inteiro não há encargo, mesmo com taxa informada", async () => {
    const { cliente, escritas } = criarBanco([CORRENTE], [despesa()]);
    suporte.cliente = cliente;

    await payTransaction({
      transactionId: ID,
      amountCents: 80_000,
      occurredOn: "2026-08-20",
      taxaMensalPercent: 10,
    });

    const inserts = escritas.filter(
      (e) => e.tabela === "finance_transactions" && e.operacao === "insert",
    );
    expect(inserts).toHaveLength(0);
  });
});

describe("séries — recorrência e parcelamento", () => {
  const base = {
    accountId: CORRENTE.id,
    categoryId: "",
    description: "Aluguel",
    occurredOn: "2026-08-05",
    tagIds: [] as string[],
  };

  it("⚠️ RECORRÊNCIA GRAVA `serie_tipo` — é a única coisa que a separa de parcela", () => {
    /*
      Sem esta coluna, doze aluguéis e doze parcelas são indistinguíveis na
      estrutura: mesmo grupo, mesmo `installment_no`, mesmo "3/12". E o Painel
      passaria a mostrar R$ 24.000 de passivo que não existe.
    */
    const { cliente, escritas } = criarBanco([CORRENTE]);
    suporte.cliente = cliente;

    return createRecurringSeries({ ...base, amountCents: 200_000, ocorrencias: 3 }).then((r) => {
      expect(r.ok, `a action recusou: ${"error" in r ? r.error : ""}`).toBe(true);
      const linhas = lancamentosGravados(escritas);
      expect(linhas).toHaveLength(3);
      expect(linhas.every((l) => l.serie_tipo === "recorrencia")).toBe(true);
      // O MESMO valor em todas — nunca um total dividido.
      expect(linhas.every((l) => l.amount_cents === 200_000)).toBe(true);
    });
  });

  it("recorrência nasce NÃO PAGA — o dinheiro ainda não saiu", async () => {
    const { cliente, escritas } = criarBanco([CORRENTE]);
    suporte.cliente = cliente;

    await createRecurringSeries({ ...base, amountCents: 200_000, ocorrencias: 3 });

    const linhas = lancamentosGravados(escritas);
    expect(linhas.every((l) => l.is_paid === false && l.paid_cents === 0)).toBe(true);
  });

  it("a descrição NÃO ganha o sufixo (3/12) — isso significaria parcela", async () => {
    // No extrato, "(3/12)" quer dizer parcelamento. A distinção vem das colunas,
    // e a tela mostra "3 de 12 · recorrente" a partir delas.
    const { cliente, escritas } = criarBanco([CORRENTE]);
    suporte.cliente = cliente;

    await createRecurringSeries({ ...base, amountCents: 200_000, ocorrencias: 3 });

    expect(lancamentosGravados(escritas).every((l) => l.description === "Aluguel")).toBe(true);
  });

  it("⚠️ RECUSA RECORRÊNCIA EM CARTÃO, sem gravar nada", async () => {
    /*
      Lá o gatilho da 0023 força `is_paid = true` em toda linha — a garantia que
      impede o limite de deixar de ser consumido. Com ela, as ocorrências futuras
      de uma assinatura comeriam limite que o cartão ainda não comprometeu.
    */
    const { cliente, escritas } = criarBanco([CARTAO]);
    suporte.cliente = cliente;

    const r = await createRecurringSeries({
      ...base,
      accountId: CARTAO.id,
      amountCents: 4_500,
      ocorrencias: 12,
    });

    expect(r.ok).toBe(false);
    expect("error" in r && r.error).toContain("limite");
    expect(lancamentosGravados(escritas)).toHaveLength(0);
  });

  it("parcelamento FORA do cartão nasce não pago, mas marcado como parcelamento", async () => {
    /*
      O dinheiro ainda não saiu da conta — marcar como pago derrubaria o saldo
      pelo total no dia da compra e ele deixaria de bater com o extrato. A dívida
      não some por isso: `serie_tipo = 'parcelamento'` manda as parcelas futuras
      para a Dívida, porque a contrapartida já foi entregue.
    */
    const { cliente, escritas } = criarBanco([CORRENTE]);
    suporte.cliente = cliente;

    const r = await createInstallmentPurchase({
      accountId: CORRENTE.id,
      categoryId: "",
      description: "Sofá",
      totalAmountCents: 240_000,
      installments: 3,
      occurredOn: "2026-08-05",
      tagIds: [],
    });

    expect(r.ok, `a action recusou: ${"error" in r ? r.error : ""}`).toBe(true);
    const linhas = lancamentosGravados(escritas);
    expect(linhas).toHaveLength(3);
    expect(linhas.every((l) => l.serie_tipo === "parcelamento")).toBe(true);
    expect(linhas.every((l) => l.is_paid === false && l.paid_cents === 0)).toBe(true);
    // E o TOTAL é dividido, ao contrário da recorrência.
    expect(linhas.map((l) => l.amount_cents)).toEqual([80_000, 80_000, 80_000]);
  });

  it("parcelamento NO cartão continua nascendo pago — a dívida existe desde a compra", async () => {
    const { cliente, escritas } = criarBanco([CARTAO]);
    suporte.cliente = cliente;

    await createInstallmentPurchase({
      accountId: CARTAO.id,
      categoryId: "",
      description: "Geladeira",
      totalAmountCents: 240_000,
      installments: 3,
      occurredOn: "2026-08-05",
      tagIds: [],
    });

    const linhas = lancamentosGravados(escritas);
    expect(linhas.every((l) => l.is_paid === true)).toBe(true);
    expect(linhas.every((l) => l.paid_cents === l.amount_cents)).toBe(true);
  });

  it("⚠️ ENCERRAR SÓ VALE PARA RECORRÊNCIA — parcelamento é recusado", async () => {
    /*
      Apagar parcelas futuras de uma compra parcelada apagaria dívida que
      CONTINUA existindo: o sofá já está na sala e o banco vai cobrar. O sistema
      passaria a mostrar que se deve menos do que se deve.
    */
    const parcela = {
      id: "44444444-4444-4444-8444-444444444444",
      installment_group_id: "g-1",
      installment_no: 2,
      serie_tipo: "parcelamento",
    };
    const { cliente, escritas } = criarBanco([CORRENTE], [parcela]);
    suporte.cliente = cliente;

    const r = await cancelarFuturasDaSerie("44444444-4444-4444-8444-444444444444");

    expect(r.ok).toBe(false);
    expect("error" in r && r.error).toContain("recorrência");
    expect(escritas.some((e) => e.operacao === "delete")).toBe(false);
  });

  it("encerrar uma recorrência apaga a partir desta ocorrência", async () => {
    const ocorrencia = {
      id: "44444444-4444-4444-8444-444444444444",
      installment_group_id: "g-1",
      installment_no: 3,
      serie_tipo: "recorrencia",
    };
    const { cliente, escritas } = criarBanco([CORRENTE], [ocorrencia]);
    suporte.cliente = cliente;

    const r = await cancelarFuturasDaSerie("44444444-4444-4444-8444-444444444444");

    // O falso devolve lista vazia no delete, então a action reporta "nada a
    // encerrar" — o que importa provar aqui é que ela CHEGOU ao delete, ou seja,
    // que recorrência não é recusada como parcelamento é.
    expect(escritas.some((e) => e.tabela === "finance_transactions" && e.operacao === "delete")).toBe(
      true,
    );
    expect(r.ok).toBe(false);
    expect("error" in r && r.error).toContain("futura");
  });
});
