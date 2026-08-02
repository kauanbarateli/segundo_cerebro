import { describe, expect, it } from "vitest";
import { planejarSync, mapEventRow, type GoogleEvent, type SyncPlan } from "./sync-plan";

const IDS = { userId: "u1", accountId: "a1", sourceId: "s1" };

function ev(over: Partial<GoogleEvent> & { id: string }): GoogleEvent {
  return {
    summary: "Reunião",
    start: { dateTime: "2026-08-03T14:00:00.000Z" },
    end: { dateTime: "2026-08-03T15:00:00.000Z" },
    ...over,
  };
}

/**
 * PROVA DE COMPILAÇÃO: `SyncPlan` tem exatamente dois campos.
 *
 * Este bloco não roda nada — ele é verificado pelo `tsc --noEmit`. Se alguém
 * acrescentar um `paraApagar` (ou qualquer terceira saída) à interface, a
 * atribuição abaixo deixa de compilar e a build quebra ANTES de qualquer teste.
 *
 * O QUE ESTE ARQUIVO NÃO PROVA: que a linha do evento cancelado sobrevive. Tudo
 * aqui é sobre o PLANO; quem decide entre apagar e marcar é `calendar.ts`, e
 * `paraCancelar: string[]` alimenta um `.delete().in(...)` tão bem quanto o
 * `.update(...)` atual. Essa prova mora em `calendar.test.ts`.
 */
type ChavesDoPlano = keyof SyncPlan;
const CHAVES_ESPERADAS: ChavesDoPlano[] = ["paraUpsert", "paraCancelar"];
// A seta contrária: toda chave esperada é chave do plano, e vice-versa.
type Exatamente<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const PLANO_TEM_DUAS_SAIDAS: Exatamente<ChavesDoPlano, "paraUpsert" | "paraCancelar"> = true;

describe("planejarSync — o plano só sabe gravar e cancelar", () => {
  it("não expõe nenhuma saída de exclusão", () => {
    const plano = planejarSync([ev({ id: "g1" })], IDS);
    // O teste de tipo acima já barra a regressão na compilação; este aqui pega o
    // caso de alguém devolver um objeto com campo extra via `as`.
    expect(Object.keys(plano).sort()).toEqual(CHAVES_ESPERADAS.sort());
    expect(PLANO_TEM_DUAS_SAIDAS).toBe(true);
  });

  it("evento cancelado vai para paraCancelar e NÃO para paraUpsert", () => {
    const plano = planejarSync([ev({ id: "g1", status: "cancelled" })], IDS);
    expect(plano.paraCancelar).toEqual(["g1"]);
    expect(plano.paraUpsert).toHaveLength(0);
  });

  it("evento confirmado vai para paraUpsert", () => {
    const plano = planejarSync([ev({ id: "g1", status: "confirmed" })], IDS);
    expect(plano.paraCancelar).toHaveLength(0);
    expect(plano.paraUpsert).toHaveLength(1);
    expect(plano.paraUpsert[0]!.google_event_id).toBe("g1");
    expect(plano.paraUpsert[0]!.status).toBe("confirmed");
  });

  it("evento SEM status é tratado como ATIVO, não como cancelado", () => {
    // O Google omite `status` em parte dos eventos. Só 'cancelled' significa
    // cancelado — qualquer outra coisa, inclusive a ausência, é evento vivo.
    const plano = planejarSync([ev({ id: "g1", status: undefined })], IDS);
    expect(plano.paraUpsert).toHaveLength(1);
    expect(plano.paraCancelar).toHaveLength(0);
    // E a linha guarda NULL, que é o que a coluna anulável espera.
    expect(plano.paraUpsert[0]!.status).toBeNull();
  });

  it("lista vazia gera plano vazio", () => {
    const plano = planejarSync([], IDS);
    expect(plano.paraUpsert).toEqual([]);
    expect(plano.paraCancelar).toEqual([]);
  });

  it("separa ativos e cancelados na mesma página", () => {
    const plano = planejarSync(
      [
        ev({ id: "g1", status: "confirmed" }),
        ev({ id: "g2", status: "cancelled" }),
        ev({ id: "g3" }),
        ev({ id: "g4", status: "tentative" }),
      ],
      IDS,
    );
    expect(plano.paraUpsert.map((r) => r.google_event_id)).toEqual(["g1", "g3", "g4"]);
    expect(plano.paraCancelar).toEqual(["g2"]);
  });
});

describe("planejarSync — id repetido na mesma página", () => {
  /**
   * ESCOLHA: o ÚLTIMO estado vence, e o id aparece em UM único lado do plano.
   *
   * A coleta incremental (`syncToken`) entrega as alterações em ordem
   * cronológica de modificação, então o último registro do mesmo id é o estado
   * atual. Além da semântica, há uma razão mecânica: `upsert` com a mesma chave
   * de conflito duas vezes no MESMO comando faz o Postgres recusar tudo com
   * "ON CONFLICT DO UPDATE command cannot affect row a second time". E mandar o
   * id para os dois lados ao mesmo tempo deixaria o resultado dependendo da
   * ordem em que as duas escritas acontecem — isto é, de uma coincidência.
   */
  it("confirmado e depois cancelado: fica cancelado", () => {
    const plano = planejarSync(
      [ev({ id: "g1", status: "confirmed" }), ev({ id: "g1", status: "cancelled" })],
      IDS,
    );
    expect(plano.paraCancelar).toEqual(["g1"]);
    expect(plano.paraUpsert).toHaveLength(0);
  });

  it("cancelado e depois ressuscitado: volta a ser gravado", () => {
    const plano = planejarSync(
      [
        ev({ id: "g1", status: "cancelled" }),
        ev({ id: "g1", status: "confirmed", summary: "Reunião remarcada" }),
      ],
      IDS,
    );
    expect(plano.paraCancelar).toHaveLength(0);
    expect(plano.paraUpsert).toHaveLength(1);
    expect(plano.paraUpsert[0]!.summary).toBe("Reunião remarcada");
    // O status gravado é o do Google: é assim que o upsert desfaz sozinho o
    // soft delete de uma rodada anterior, sem código de "descancelamento".
    expect(plano.paraUpsert[0]!.status).toBe("confirmed");
  });

  it("duas versões ativas do mesmo id viram UMA linha (a última)", () => {
    const plano = planejarSync(
      [ev({ id: "g1", summary: "Título antigo" }), ev({ id: "g1", summary: "Título novo" })],
      IDS,
    );
    expect(plano.paraUpsert).toHaveLength(1);
    expect(plano.paraUpsert[0]!.summary).toBe("Título novo");
  });

  it("descarta evento sem id — não é endereçável no upsert nem no update", () => {
    const plano = planejarSync([{ id: "" } as GoogleEvent, ev({ id: "g1" })], IDS);
    expect(plano.paraUpsert.map((r) => r.google_event_id)).toEqual(["g1"]);
    expect(plano.paraCancelar).toHaveLength(0);
  });
});

describe("mapEventRow", () => {
  it("marca dia inteiro quando só há `date`", () => {
    const row = mapEventRow(
      { id: "g1", start: { date: "2026-08-03" }, end: { date: "2026-08-04" } },
      IDS,
    );
    expect(row.all_day).toBe(true);
    expect(row.start_date).toBe("2026-08-03");
    expect(row.start_at).toBeNull();
  });

  it("não marca dia inteiro quando há `dateTime`", () => {
    const row = mapEventRow(ev({ id: "g1" }), IDS);
    expect(row.all_day).toBe(false);
    expect(row.start_at).toBe("2026-08-03T14:00:00.000Z");
  });

  it("carrega os ids locais, que não vêm do Google", () => {
    const row = mapEventRow(ev({ id: "g1" }), IDS);
    expect(row.user_id).toBe("u1");
    expect(row.calendar_account_id).toBe("a1");
    expect(row.calendar_source_id).toBe("s1");
  });

  it("prefere o e-mail do organizador ao nome de exibição", () => {
    const row = mapEventRow(
      ev({ id: "g1", organizer: { email: "a@b.com", displayName: "Fulano" } }),
      IDS,
    );
    expect(row.organizer).toBe("a@b.com");
  });
});
