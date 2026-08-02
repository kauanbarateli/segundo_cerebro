import { describe, expect, it } from "vitest";
import { pairForLink, type RelatedEntity } from "./links";

/**
 * `pairForLink` é a única peça do fluxo de vínculos que decide ORDEM, e errar a
 * ordem não produz erro de compilação (os dois lados são uuid) nem mensagem
 * honesta na tela: o banco recusa com foreign_key_violation e a action devolve
 * "Item não encontrado." de propósito, para não virar oráculo de existência.
 * Ou seja, a inversão apareceria como "não salva e não explica". Daí os testes.
 */

const TAREFA: RelatedEntity = { kind: "task", id: "11111111-1111-4111-8111-111111111111" };
const CAPTURA: RelatedEntity = { kind: "capture", id: "22222222-2222-4222-8222-222222222222" };
const EVENTO: RelatedEntity = { kind: "event", id: "33333333-3333-4333-8333-333333333333" };

describe("pairForLink", () => {
  it("põe a tarefa em aId e a captura em bId, venha de que lado vier", () => {
    expect(pairForLink(TAREFA, CAPTURA)).toEqual({
      tipo: "task-capture",
      aId: TAREFA.id,
      bId: CAPTURA.id,
    });
    // O mesmo par, aberto pela tela de capturas: a ordem NÃO acompanha a ordem
    // dos argumentos, acompanha o nome da tabela.
    expect(pairForLink(CAPTURA, TAREFA)).toEqual({
      tipo: "task-capture",
      aId: TAREFA.id,
      bId: CAPTURA.id,
    });
  });

  it("põe a tarefa em aId e o evento em bId", () => {
    const esperado = { tipo: "task-event", aId: TAREFA.id, bId: EVENTO.id };
    expect(pairForLink(TAREFA, EVENTO)).toEqual(esperado);
    expect(pairForLink(EVENTO, TAREFA)).toEqual(esperado);
  });

  it("põe a captura em aId e o evento em bId", () => {
    const esperado = { tipo: "capture-event", aId: CAPTURA.id, bId: EVENTO.id };
    expect(pairForLink(CAPTURA, EVENTO)).toEqual(esperado);
    expect(pairForLink(EVENTO, CAPTURA)).toEqual(esperado);
  });

  it("recusa dois lados do mesmo tipo — não existe tabela para isso", () => {
    expect(pairForLink(TAREFA, { kind: "task", id: "44444444-4444-4444-8444-444444444444" })).toBeNull();
    expect(pairForLink(CAPTURA, { kind: "capture", id: CAPTURA.id })).toBeNull();
    expect(pairForLink(EVENTO, { kind: "event", id: EVENTO.id })).toBeNull();
  });

  it("cobre as três tabelas e nenhuma a mais", () => {
    const tipos = [
      pairForLink(TAREFA, CAPTURA)?.tipo,
      pairForLink(TAREFA, EVENTO)?.tipo,
      pairForLink(CAPTURA, EVENTO)?.tipo,
    ];
    expect(new Set(tipos)).toEqual(new Set(["task-capture", "task-event", "capture-event"]));
  });
});
