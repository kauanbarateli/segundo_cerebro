import { describe, expect, it } from "vitest";
import {
  taskInputSchema,
  captureInputSchema,
  captureUpdateSchema,
  vaultItemUpsertSchema,
  financeAccountSchema,
  financeInstallmentSchema,
  financeStatementPaymentSchema,
  socialLinkSchema,
  socialLinkUpdateSchema,
  socialLinkReorderSchema,
} from "./validation";

const CAPTURE_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ACCOUNT_ID = "11111111-2222-4333-8444-555555555555";
const OUTRA_CONTA_ID = "99999999-8888-4777-8666-555555555555";

describe("taskInputSchema", () => {
  it("requires a non-empty title", () => {
    expect(taskInputSchema.safeParse({ title: "" }).success).toBe(false);
    expect(taskInputSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("applies defaults and normalizes empty optionals to null", () => {
    const r = taskInputSchema.parse({ title: "Revisar proposta" });
    expect(r.priority).toBe("medium");
    expect(r.status).toBe("todo");
    expect(r.description).toBeNull();
    expect(r.dueAt).toBeNull();
    expect(r.allDay).toBe(false);
  });

  it("converts a datetime-local string to an ISO timestamp", () => {
    const r = taskInputSchema.parse({ title: "X", dueAt: "2026-07-28T10:00" });
    expect(r.dueAt).toMatch(/^2026-07-28T/);
    expect(new Date(r.dueAt as string).toISOString()).toBe(r.dueAt);
  });
});

describe("captureInputSchema", () => {
  it("defaults type to note and content to empty", () => {
    const r = captureInputSchema.parse({});
    expect(r.type).toBe("note");
    expect(r.content).toBe("");
  });

  it("accepts the four capture types", () => {
    for (const type of ["idea", "task", "note", "reminder"]) {
      expect(captureInputSchema.safeParse({ type }).success).toBe(true);
    }
  });
});

describe("captureUpdateSchema", () => {
  it("rejects a malformed id", () => {
    expect(captureUpdateSchema.safeParse({ id: "abc", type: "note" }).success).toBe(false);
    expect(captureUpdateSchema.safeParse({ type: "note" }).success).toBe(false);
    expect(
      captureUpdateSchema.safeParse({ id: CAPTURE_ID, type: "note", content: "ok" }).success,
    ).toBe(true);
  });

  it("normalizes an empty categoryId to null", () => {
    const r = captureUpdateSchema.parse({
      id: CAPTURE_ID,
      type: "idea",
      content: "trocar de categoria",
      categoryId: "",
    });
    expect(r.categoryId).toBeNull();
  });

  it("rejects content longer than 10.000 characters", () => {
    const id = CAPTURE_ID;
    expect(
      captureUpdateSchema.safeParse({ id, type: "note", content: "a".repeat(10_000) }).success,
    ).toBe(true);
    expect(
      captureUpdateSchema.safeParse({ id, type: "note", content: "a".repeat(10_001) }).success,
    ).toBe(false);
  });

  it("requires an explicit type, unlike the create schema", () => {
    expect(captureUpdateSchema.safeParse({ id: CAPTURE_ID, content: "x" }).success).toBe(false);
  });
});

/* --------------------------------------------------------------- cartão (0010) */

describe("financeAccountSchema", () => {
  const contaBase = { name: "Nubank", openingBalanceCents: 0 };
  const camposDeCartao = {
    creditLimitCents: 500_000,
    statementClosingDay: 15,
    paymentDueDay: 22,
  };

  it("exige limite, fechamento e vencimento quando a conta é cartão", () => {
    const r = financeAccountSchema.safeParse({ ...contaBase, kind: "credit_card" });
    expect(r.success).toBe(false);
    // Um issue por campo, cada um com seu path — é isso que faz o formulário
    // destacar os três campos em vez de mostrar um erro solto no topo.
    const paths = r.success ? [] : r.error.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(
      expect.arrayContaining(["creditLimitCents", "statementClosingDay", "paymentDueDay"]),
    );
  });

  it("recusa também o null explícito, não só o campo ausente", () => {
    // O formulário manda null quando o campo foi limpo. Checar só `undefined`
    // deixaria passar um cartão zerado, e aí quem recusaria seria o CHECK do
    // banco — com mensagem crua de constraint no lugar do campo destacado.
    const r = financeAccountSchema.safeParse({
      ...contaBase,
      kind: "credit_card",
      creditLimitCents: null,
      statementClosingDay: null,
      paymentDueDay: null,
    });
    expect(r.success).toBe(false);
    expect(r.success ? 0 : r.error.issues.length).toBe(3);
  });

  it("aceita o cartão completo", () => {
    expect(
      financeAccountSchema.safeParse({ ...contaBase, kind: "credit_card", ...camposDeCartao })
        .success,
    ).toBe(true);
  });

  it("não exige nada disso das outras contas", () => {
    for (const kind of ["checking", "savings", "cash", "investment", "other"]) {
      expect(financeAccountSchema.safeParse({ ...contaBase, kind }).success).toBe(true);
    }
  });

  it("recusa dia fora de 1-31 e limite não positivo", () => {
    const cartao = { ...contaBase, kind: "credit_card", ...camposDeCartao };
    expect(financeAccountSchema.safeParse({ ...cartao, statementClosingDay: 0 }).success).toBe(false);
    expect(financeAccountSchema.safeParse({ ...cartao, statementClosingDay: 32 }).success).toBe(false);
    expect(financeAccountSchema.safeParse({ ...cartao, paymentDueDay: 0 }).success).toBe(false);
    expect(financeAccountSchema.safeParse({ ...cartao, creditLimitCents: 0 }).success).toBe(false);
    expect(financeAccountSchema.safeParse({ ...cartao, creditLimitCents: 1000.5 }).success).toBe(false);
  });

  it("aceita null explícito fora de cartão — é assim que o formulário limpa os campos", () => {
    const r = financeAccountSchema.safeParse({
      ...contaBase,
      kind: "checking",
      creditLimitCents: null,
      statementClosingDay: null,
      paymentDueDay: null,
    });
    expect(r.success).toBe(true);
  });
});

describe("financeInstallmentSchema", () => {
  const compra = {
    accountId: ACCOUNT_ID,
    description: "Geladeira",
    totalAmountCents: 100_00,
    installments: 3,
    occurredOn: "2026-03-10",
  };

  it("aceita uma compra parcelada válida e aplica o default de etiquetas", () => {
    const r = financeInstallmentSchema.parse(compra);
    expect(r.tagIds).toEqual([]);
    expect(r.categoryId).toBeNull();
  });

  it("limita o número de parcelas a 1..36", () => {
    expect(financeInstallmentSchema.safeParse({ ...compra, installments: 0 }).success).toBe(false);
    expect(financeInstallmentSchema.safeParse({ ...compra, installments: 37 }).success).toBe(false);
    expect(financeInstallmentSchema.safeParse({ ...compra, installments: 2.5 }).success).toBe(false);
    expect(financeInstallmentSchema.safeParse({ ...compra, installments: 36 }).success).toBe(true);
  });

  it("recusa parcelas de zero centavo antes de o banco recusar por constraint", () => {
    // 10 centavos em 36x daria 0 nas primeiras parcelas, e
    // finance_tx_amount_positive derrubaria o INSERT inteiro com erro cru.
    expect(financeInstallmentSchema.safeParse({ ...compra, totalAmountCents: 10, installments: 36 }).success).toBe(false);
    expect(financeInstallmentSchema.safeParse({ ...compra, totalAmountCents: 36, installments: 36 }).success).toBe(true);
  });

  it("deixa espaço na descrição para o sufixo da parcela", () => {
    expect(financeInstallmentSchema.safeParse({ ...compra, description: "a".repeat(140) }).success).toBe(true);
    expect(financeInstallmentSchema.safeParse({ ...compra, description: "a".repeat(141) }).success).toBe(false);
  });

  it("recusa data mal formada e valor não inteiro", () => {
    expect(financeInstallmentSchema.safeParse({ ...compra, occurredOn: "10/03/2026" }).success).toBe(false);
    expect(financeInstallmentSchema.safeParse({ ...compra, totalAmountCents: 100.5 }).success).toBe(false);
    expect(financeInstallmentSchema.safeParse({ ...compra, totalAmountCents: 0 }).success).toBe(false);
  });
});

describe("financeStatementPaymentSchema", () => {
  const pagamento = {
    cardAccountId: ACCOUNT_ID,
    fromAccountId: OUTRA_CONTA_ID,
    mesFatura: "2026-04-01",
    amountCents: 1_200_00,
    occurredOn: "2026-05-05",
  };

  it("aceita um pagamento válido", () => {
    expect(financeStatementPaymentSchema.safeParse(pagamento).success).toBe(true);
  });

  it("exige o mês da fatura normalizado no dia 1", () => {
    expect(financeStatementPaymentSchema.safeParse({ ...pagamento, mesFatura: "2026-04-15" }).success).toBe(false);
    expect(financeStatementPaymentSchema.safeParse({ ...pagamento, mesFatura: "2026-04" }).success).toBe(false);
  });

  it("impede o cartão de pagar a si mesmo", () => {
    const r = financeStatementPaymentSchema.safeParse({
      ...pagamento,
      fromAccountId: ACCOUNT_ID,
    });
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues[0]?.path).toEqual(["fromAccountId"]);
  });

  it("valida os dois ids como uuid antes de qualquer ida ao banco", () => {
    expect(financeStatementPaymentSchema.safeParse({ ...pagamento, cardAccountId: "abc" }).success).toBe(false);
    expect(financeStatementPaymentSchema.safeParse({ ...pagamento, fromAccountId: "abc" }).success).toBe(false);
  });
});

describe("vaultItemUpsertSchema", () => {
  it("requires ciphertext and iv", () => {
    expect(
      vaultItemUpsertSchema.safeParse({ itemType: "login", encryptedPayload: "", itemIv: "" }).success,
    ).toBe(false);
    expect(
      vaultItemUpsertSchema.safeParse({
        itemType: "login",
        encryptedPayload: "abc",
        itemIv: "def",
      }).success,
    ).toBe(true);
  });
});

/* ------------------------------------------------------------- redes sociais */

/**
 * O ponto de segurança da fase, na borda que a server action realmente usa.
 *
 * `socialLinkSchema` é a BARREIRA 1: o que passa por aqui vira `href` de um
 * `<a>`, e `href="javascript:..."` executa script na origem do aplicativo — a
 * mesma origem do Cofre. Estes testes existem para que trocar o schema por um
 * `z.string().url()` (que aceita `javascript:` sem reclamar) fique vermelho.
 */
describe("socialLinkSchema", () => {
  const LINK_ID = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";

  it("recusa os esquemas que executam código, inclusive disfarçados", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "  javascript:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      expect(socialLinkSchema.safeParse({ label: "X", url }).success).toBe(false);
    }
  });

  it("recusa http, que sai da página em texto claro", () => {
    expect(socialLinkSchema.safeParse({ label: "X", url: "http://exemplo.com" }).success).toBe(
      false,
    );
  });

  it("devolve a URL canônica, e não o texto digitado", () => {
    const r = socialLinkSchema.parse({ label: "Meu perfil", url: "instagram.com/eu" });
    // Sem a canonização o banco receberia "instagram.com/eu", que o CHECK
    // `social_links_url_https` recusa por não começar com "https://".
    expect(r.url).toBe("https://instagram.com/eu");
  });

  it("aparra o rótulo e respeita o teto de 40 caracteres do banco", () => {
    const url = "https://exemplo.com";
    expect(socialLinkSchema.parse({ label: "  GitHub  ", url }).label).toBe("GitHub");
    expect(socialLinkSchema.safeParse({ label: "   ", url }).success).toBe(false);
    expect(socialLinkSchema.safeParse({ label: "a".repeat(41), url }).success).toBe(false);
    expect(socialLinkSchema.safeParse({ label: "a".repeat(40), url }).success).toBe(true);
  });

  it("explica em português qual regra falhou", () => {
    const r = socialLinkSchema.safeParse({ label: "X", url: "javascript:alert(1)" });
    expect(r.success).toBe(false);
    expect(r.success ? "" : r.error.issues[0]?.message).toBe("Só endereços https:// são aceitos.");
  });

  it("exige uuid no id da edição, antes de qualquer ida ao banco", () => {
    const base = { label: "X", url: "https://exemplo.com" };
    expect(socialLinkUpdateSchema.safeParse({ ...base, id: "abc" }).success).toBe(false);
    expect(socialLinkUpdateSchema.safeParse({ ...base, id: LINK_ID }).success).toBe(true);
  });
});

describe("socialLinkReorderSchema", () => {
  const A = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
  const B = "6ba7b811-9dad-41d1-80b4-00c04fd430c8";

  it("recusa ids repetidos, que fariam o upsert em lote falhar no banco", () => {
    // "ON CONFLICT DO UPDATE command cannot affect row a second time" — barrar
    // aqui troca esse erro cru por uma frase legível.
    expect(socialLinkReorderSchema.safeParse({ ids: [A, B, A] }).success).toBe(false);
    expect(socialLinkReorderSchema.safeParse({ ids: [A, B] }).success).toBe(true);
  });

  it("recusa lista vazia, id malformado e lista acima do limite", () => {
    expect(socialLinkReorderSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(socialLinkReorderSchema.safeParse({ ids: ["abc"] }).success).toBe(false);
    const muitos = Array.from({ length: 9 }, (_, i) => `6ba7b81${i}-9dad-41d1-80b4-00c04fd430c8`);
    expect(socialLinkReorderSchema.safeParse({ ids: muitos }).success).toBe(false);
  });
});
