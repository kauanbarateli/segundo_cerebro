import { describe, expect, it } from "vitest";
import { filtrarEvento, filtrarTrilha } from "./observabilidade";

/**
 * ============================================================================
 * O TESTE QUE JUSTIFICA A ETAPA INTEIRA
 * ============================================================================
 * A pergunta não é "o filtro remove o campo X?" — é "existe ALGUM caminho pelo
 * qual conteúdo sensível chega ao Sentry?". Por isso os testes abaixo montam
 * eventos com segredo plantado em toda parte e afirmam sobre o JSON
 * SERIALIZADO inteiro, não campo a campo. Verificar campo a campo só provaria
 * que os campos lembrados foram tratados, que é exatamente a fraqueza da
 * denylist que a allowlist existe para evitar.
 */

/** Sentinelas: se qualquer uma sair do filtro, o teste falha. */
const SEGREDOS = [
  "senha-mestra-do-cofre",
  "pk_12345678_ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "ya29.token-do-google",
  "contas.blacksheep@gmail.com",
  "minha nota particular sobre terapia",
];

describe("filtrarEvento — allowlist", () => {
  it("NÃO deixa passar segredo plantado em campo nenhum", () => {
    const evento = filtrarEvento({
      event_id: "abc",
      exception: { values: [{ type: "TypeError", value: "x is not a function" }] },
      // Cada um destes é um campo que o SDK preenche sozinho.
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "contas.blacksheep@gmail.com",
        ip_address: "200.1.2.3",
        username: "kauan",
      },
      request: {
        url: "https://app.exemplo.com/cofre?q=senha-mestra-do-cofre",
        headers: { authorization: "Bearer ya29.token-do-google" },
        data: { senha: "senha-mestra-do-cofre" },
        cookies: "sb-access-token=ya29.token-do-google",
      },
      extra: { clipboard: "minha nota particular sobre terapia" },
      contexts: {
        trace: { trace_id: "t1", span_id: "s1" },
        state: { vault: { itens: ["minha nota particular sobre terapia"] } },
      },
      tags: { token: "pk_12345678_ABCDEFGHIJKLMNOPQRSTUVWXYZ" },
      breadcrumbs: [{ message: "senha-mestra-do-cofre" }],
    });

    const serializado = JSON.stringify(evento);
    for (const segredo of SEGREDOS) {
      expect(serializado).not.toContain(segredo);
    }
  });

  it("guarda o id do usuário e descarta e-mail, IP e nome", () => {
    const evento = filtrarEvento({
      user: { id: "user-1", email: "a@b.com", ip_address: "1.2.3.4", username: "x" },
    });
    expect(evento?.user).toEqual({ id: "user-1" });
  });

  it("mantém o que a depuração realmente usa", () => {
    const evento = filtrarEvento({
      exception: { values: [{ type: "TypeError", value: "x is not a function" }] },
      transaction: "/projetos/[projectId]",
      level: "error",
      release: "v1",
      environment: "production",
    });

    expect(evento?.exception).toBeDefined();
    expect(evento?.transaction).toBe("/projetos/[projectId]");
    expect(evento?.level).toBe("error");
    expect(evento?.release).toBe("v1");
  });

  it("reduz a URL ao caminho, sem query nem fragmento", () => {
    const evento = filtrarEvento({
      request: { url: "https://app.exemplo.com/conhecimento?q=onde+guardei+a+senha#nota" },
    });
    expect(evento?.request?.url).toBe("/conhecimento");
  });

  it("trunca mensagem longa — texto livre é por onde o dado escapa", () => {
    const evento = filtrarEvento({ message: "x".repeat(5_000) });
    expect((evento?.message as string).length).toBeLessThanOrEqual(301);
  });

  /*
    A prova de que é allowlist e não denylist: um campo que NINGUÉM previu —
    porque ele ainda não existe — não passa. É o caso que uma denylist deixaria
    vazar em silêncio no dia em que uma funcionalidade nova o criasse.
  */
  it("descarta campo desconhecido, inclusive um que ainda não existe", () => {
    const evento = filtrarEvento({
      campo_que_ninguem_previu: "minha nota particular sobre terapia",
    } as never);
    expect(JSON.stringify(evento)).not.toContain("terapia");
  });

  it("descarta evento nulo em vez de deixá-lo seguir", () => {
    expect(filtrarEvento(null as never)).toBeNull();
  });
});

describe("filtrarTrilha", () => {
  it("descarta TUDO que passou pelo console", () => {
    // Um `console.log` de depuração esquecido não pode virar exportação de
    // segredo.
    expect(filtrarTrilha({ category: "console", message: "senha-mestra-do-cofre" })).toBeNull();
  });

  it("descarta interação de interface (o que foi digitado e clicado)", () => {
    expect(filtrarTrilha({ category: "ui.input", message: "senha-mestra-do-cofre" })).toBeNull();
    expect(filtrarTrilha({ category: "ui.click", message: "Cofre" })).toBeNull();
  });

  it("na navegação guarda só os caminhos", () => {
    const t = filtrarTrilha({
      category: "navigation",
      data: { from: "/cofre?q=senha-mestra-do-cofre", to: "/tarefas?tarefa=1" },
    });
    expect(t?.data).toEqual({ from: "/cofre", to: "/tarefas" });
  });

  it("em requisição guarda método, status e caminho — nunca o corpo", () => {
    const t = filtrarTrilha({
      category: "fetch",
      data: {
        method: "POST",
        status_code: 500,
        url: "https://x.supabase.co/rest/v1/vault_items?select=*",
        body: "senha-mestra-do-cofre",
      },
    });
    expect(JSON.stringify(t)).not.toContain("senha-mestra-do-cofre");
    expect(t?.data?.method).toBe("POST");
    expect(t?.data?.status_code).toBe(500);
  });

  it("categoria desconhecida perde os dados e mantém só o esqueleto", () => {
    const t = filtrarTrilha({ category: "coisa.nova", data: { x: "senha-mestra-do-cofre" } });
    expect(JSON.stringify(t)).not.toContain("senha-mestra-do-cofre");
  });
});
