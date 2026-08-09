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
const { upsertTransaction, upsertAccount, payStatement } = await import("./actions");

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
