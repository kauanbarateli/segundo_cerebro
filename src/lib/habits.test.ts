import { describe, expect, it } from "vitest";
import {
  celulasDoPeriodo,
  diaDaSemana,
  diferencaEmDias,
  eraEsperado,
  estaPausado,
  melhorSequencia,
  resumirHabito,
  resumirHabitos,
  segundaDaSemana,
  sequenciaAtual,
  somarDias,
  type Habito,
  type PausaHabito,
} from "./habits";

/** 2026-08-03 é SEGUNDA. Toda a suíte se ancora nela. */
const SEGUNDA = "2026-08-03";

function habito(parcial: Partial<Habito> = {}): Habito {
  return {
    id: "h1",
    name: "Ler",
    schedule_kind: "daily",
    weekdays: [],
    weekly_target: null,
    started_on: "2026-07-01",
    archived_at: null,
    ...parcial,
  };
}

/** Marca uma sequência de dias a partir de uma chave. */
function feitos(...dias: string[]): Set<string> {
  return new Set(dias);
}

function intervalo(de: string, quantos: number): string[] {
  return Array.from({ length: quantos }, (_, i) => somarDias(de, i));
}

describe("dias civis — a base de tudo", () => {
  it("diaDaSemana usa 0=domingo, igual a extract(dow)", () => {
    // A mesma numeração do Postgres e de `user_preferences.week_starts_on`.
    // Escolher outra base obrigaria tabela de conversão em cada fronteira.
    expect(diaDaSemana("2026-08-02")).toBe(0); // domingo
    expect(diaDaSemana(SEGUNDA)).toBe(1);
    expect(diaDaSemana("2026-08-08")).toBe(6); // sábado
  });

  it("⚠️ não passa pelo fuso do processo", () => {
    /*
      O dia da semana de uma data CIVIL é o mesmo no mundo inteiro. Se a conta
      passasse por `new Date("2026-08-03")` interpretado no fuso local, o
      servidor em UTC e o navegador em São Paulo discordariam — e a tela mostraria
      o hábito de segunda aparecendo no domingo.
    */
    expect(diaDaSemana("2026-08-03")).toBe(1);
    expect(somarDias("2026-08-03", 0)).toBe("2026-08-03");
  });

  it("somarDias atravessa mês e ano", () => {
    expect(somarDias("2026-01-31", 1)).toBe("2026-02-01");
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(somarDias("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("diferencaEmDias", () => {
    expect(diferencaEmDias("2026-08-01", "2026-08-04")).toBe(3);
    expect(diferencaEmDias("2026-08-04", "2026-08-01")).toBe(-3);
  });

  it("a semana começa na SEGUNDA, e o domingo pertence à anterior", () => {
    // `weekly_target` fecha no domingo à noite. Uma semana que começasse no
    // domingo viraria a contagem no meio do fim de semana.
    expect(segundaDaSemana(SEGUNDA)).toBe(SEGUNDA);
    expect(segundaDaSemana("2026-08-09")).toBe(SEGUNDA); // domingo
    expect(segundaDaSemana("2026-08-10")).toBe("2026-08-10"); // segunda seguinte
  });
});

describe("eraEsperado", () => {
  it("antes de started_on, nada é esperado", () => {
    // Sem isto, "quantas vezes falhei" contaria falha desde o começo dos tempos.
    const h = habito({ started_on: "2026-08-01" });
    expect(eraEsperado(h, "2026-07-31")).toBe(false);
    expect(eraEsperado(h, "2026-08-01")).toBe(true);
  });

  it("weekdays respeita os dias escolhidos", () => {
    const h = habito({ schedule_kind: "weekdays", weekdays: [1, 3, 5] });
    expect(eraEsperado(h, SEGUNDA)).toBe(true); // segunda
    expect(eraEsperado(h, "2026-08-04")).toBe(false); // terça
    expect(eraEsperado(h, "2026-08-05")).toBe(true); // quarta
  });

  it("⚠️ weekly_target NUNCA é esperado num dia específico", () => {
    /*
      Não é esquecimento. "Correr 3× por semana" não é esperado na terça —
      perguntar "era esperado na terça?" não tem resposta. A unidade dele é a
      semana, e quem o avalia é `resumirHabito`.
    */
    const h = habito({ schedule_kind: "weekly_target", weekly_target: 3 });
    for (const dia of intervalo(SEGUNDA, 7)) {
      expect(eraEsperado(h, dia)).toBe(false);
    }
  });

  it("dia pausado não é esperado", () => {
    const h = habito();
    const pausas: PausaHabito[] = [{ habit_id: "h1", starts_on: SEGUNDA, ends_on: "2026-08-05" }];
    expect(eraEsperado(h, SEGUNDA, pausas)).toBe(false);
    expect(eraEsperado(h, "2026-08-06", pausas)).toBe(true);
  });
});

describe("estaPausado", () => {
  it("pausa GERAL (habit_id nulo) vale para todos os hábitos", () => {
    const pausas: PausaHabito[] = [
      { habit_id: null, starts_on: "2026-08-01", ends_on: "2026-08-10" },
    ];
    expect(estaPausado("h1", "2026-08-05", pausas)).toBe(true);
    expect(estaPausado("h9", "2026-08-05", pausas)).toBe(true);
  });

  it("pausa de OUTRO hábito não pausa este", () => {
    const pausas: PausaHabito[] = [
      { habit_id: "outro", starts_on: "2026-08-01", ends_on: "2026-08-10" },
    ];
    expect(estaPausado("h1", "2026-08-05", pausas)).toBe(false);
  });

  it("ends_on nulo é pausa EM CURSO — vale dali para a frente", () => {
    const pausas: PausaHabito[] = [{ habit_id: null, starts_on: "2026-08-01", ends_on: null }];
    expect(estaPausado("h1", "2026-07-31", pausas)).toBe(false);
    expect(estaPausado("h1", "2030-01-01", pausas)).toBe(true);
  });
});

describe("sequenciaAtual — diária", () => {
  it("conta dias seguidos", () => {
    const h = habito({ started_on: "2026-07-01" });
    expect(sequenciaAtual(h, feitos(...intervalo("2026-08-01", 3)), "2026-08-03")).toBe(3);
  });

  it("⚠️ HOJE em aberto NÃO zera a sequência", () => {
    /*
      A parte que mais importa para a confiança no painel. Sem isto, quem tem 40
      dias de sequência veria "0" toda manhã até marcar — e um número que
      despenca sozinho todo dia não é usado por ninguém.
    */
    const h = habito({ started_on: "2026-07-01" });
    const marcados = feitos(...intervalo("2026-07-31", 3)); // 31/07, 01/08, 02/08
    expect(sequenciaAtual(h, marcados, "2026-08-03")).toBe(3);
  });

  it("um dia perdido no meio quebra", () => {
    const h = habito({ started_on: "2026-07-01" });
    const marcados = feitos("2026-07-30", "2026-08-01", "2026-08-02");
    expect(sequenciaAtual(h, marcados, "2026-08-03")).toBe(2);
  });

  it("⚠️ dia NÃO ELEGÍVEL é pulado, não quebra", () => {
    /*
      Um hábito de segunda/quarta/sexta zeraria toda terça-feira se o dia não
      elegível quebrasse — a sequência mediria o calendário em vez do hábito.
    */
    const h = habito({ schedule_kind: "weekdays", weekdays: [1, 3, 5], started_on: "2026-07-01" });
    // 27/07 seg, 29/07 qua, 31/07 sex, 03/08 seg
    const marcados = feitos("2026-07-27", "2026-07-29", "2026-07-31", "2026-08-03");
    expect(sequenciaAtual(h, marcados, "2026-08-03")).toBe(4);
  });

  it("pausa também é pulada, e não quebra", () => {
    // Um painel que pune férias é um painel que a pessoa para de olhar.
    const h = habito({ started_on: "2026-07-01" });
    const pausas: PausaHabito[] = [
      { habit_id: null, starts_on: "2026-07-29", ends_on: "2026-07-31" },
    ];
    const marcados = feitos("2026-07-27", "2026-07-28", "2026-08-01", "2026-08-02", "2026-08-03");
    expect(sequenciaAtual(h, marcados, "2026-08-03", pausas)).toBe(5);
  });

  it("sem nada marcado, a sequência é zero", () => {
    expect(sequenciaAtual(habito(), new Set(), "2026-08-03")).toBe(0);
  });

  it("não conta antes de started_on", () => {
    const h = habito({ started_on: "2026-08-02" });
    const marcados = feitos("2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02");
    expect(sequenciaAtual(h, marcados, "2026-08-02")).toBe(1);
  });
});

describe("sequenciaAtual — weekly_target conta SEMANAS", () => {
  const h = habito({
    schedule_kind: "weekly_target",
    weekly_target: 3,
    started_on: "2026-07-06", // uma segunda
  });

  it("⚠️ a unidade é a semana, não o dia", () => {
    // Contar dias aqui diria "sequência de 1" para quem correu três vezes na
    // semana — pior que não mostrar.
    const marcados = feitos(
      "2026-07-20", "2026-07-22", "2026-07-24", // semana de 20/07: 3 ✓
      "2026-07-27", "2026-07-29", "2026-07-31", // semana de 27/07: 3 ✓
    );
    expect(sequenciaAtual(h, marcados, "2026-08-03")).toBe(2);
  });

  it("a semana CORRENTE não quebra enquanto ainda dá tempo", () => {
    // Quebrar na terça puniria alguém por não ter terminado o que ainda pode.
    const marcados = feitos("2026-07-27", "2026-07-29", "2026-07-31");
    expect(sequenciaAtual(h, marcados, "2026-08-04")).toBe(1);
  });

  it("a semana corrente SOMA quando o alvo já foi batido", () => {
    const marcados = feitos(
      "2026-07-27", "2026-07-29", "2026-07-31",
      "2026-08-03", "2026-08-04", "2026-08-05",
    );
    expect(sequenciaAtual(h, marcados, "2026-08-05")).toBe(2);
  });

  it("semana encerrada abaixo do alvo quebra", () => {
    const marcados = feitos(
      "2026-07-20", "2026-07-22", "2026-07-24",
      "2026-07-27", // só 1 na semana de 27/07
    );
    expect(sequenciaAtual(h, marcados, "2026-08-03")).toBe(0);
  });
});

describe("melhorSequencia", () => {
  it("acha o maior trecho, mesmo já encerrado", () => {
    const h = habito({ started_on: "2026-07-20" });
    const marcados = feitos(
      ...intervalo("2026-07-20", 5), // 5 seguidos
      ...intervalo("2026-08-01", 2), // e depois 2
    );
    expect(melhorSequencia(h, marcados, "2026-08-03")).toBe(5);
    expect(sequenciaAtual(h, marcados, "2026-08-03")).toBe(2);
  });

  it("HOJE em aberto não derruba a melhor", () => {
    const h = habito({ started_on: "2026-08-01" });
    const marcados = feitos("2026-08-01", "2026-08-02");
    expect(melhorSequencia(h, marcados, "2026-08-03")).toBe(2);
  });
});

describe("resumirHabito", () => {
  it("⚠️ as FALHAS são exatas — derivadas da regra, não de linhas gravadas", () => {
    /*
      É o número que justifica o registro esparso. Nenhum processo precisa ter
      rodado à meia-noite: falha é "era esperado, já passou, e não tem marca".
    */
    const h = habito({ started_on: "2026-08-01" });
    const r = resumirHabito(h, feitos("2026-08-01"), "2026-08-01", "2026-08-05", "2026-08-05");
    // Esperados 01..05 = 5; feito 1; hoje (05) não conta como falha.
    expect(r.esperados).toBe(5);
    expect(r.cumpridos).toBe(1);
    expect(r.falhas).toBe(3);
  });

  it("HOJE nunca é falha — o dia ainda não acabou", () => {
    const h = habito({ started_on: "2026-08-03" });
    const r = resumirHabito(h, new Set(), "2026-08-03", "2026-08-03", "2026-08-03");
    expect(r.esperados).toBe(1);
    expect(r.falhas).toBe(0);
  });

  it("o intervalo é recortado por started_on", () => {
    const h = habito({ started_on: "2026-08-03" });
    const r = resumirHabito(h, new Set(), "2026-01-01", "2026-08-03", "2026-08-03");
    expect(r.esperados).toBe(1);
  });

  it("taxa é null quando nada era esperado — e não 0%", () => {
    // 0% afirmaria fracasso onde não houve nem oportunidade.
    const h = habito({ started_on: "2026-09-01" });
    const r = resumirHabito(h, new Set(), "2026-08-01", "2026-08-05", "2026-08-05");
    expect(r.esperados).toBe(0);
    expect(r.taxa).toBeNull();
  });

  it("hojeFeito é null quando hoje não era esperado", () => {
    // Distingue "não fiz" de "não era para fazer" — o checklist de hoje depende
    // disso para não listar o hábito de segunda numa terça.
    const h = habito({ schedule_kind: "weekdays", weekdays: [1] });
    expect(resumirHabito(h, new Set(), SEGUNDA, "2026-08-04", "2026-08-04").hojeFeito).toBeNull();
    expect(resumirHabito(h, new Set(), SEGUNDA, SEGUNDA, SEGUNDA).hojeFeito).toBe(false);
  });

  it("weekly_target conta SEMANAS como esperados", () => {
    const h = habito({
      schedule_kind: "weekly_target",
      weekly_target: 2,
      started_on: "2026-07-20",
    });
    const marcados = feitos("2026-07-20", "2026-07-22", "2026-07-27");
    // Semanas de 20/07 (2 ✓), 27/07 (1 ✗) e 03/08 (corrente).
    const r = resumirHabito(h, marcados, "2026-07-20", "2026-08-03", "2026-08-03");
    expect(r.esperados).toBe(3);
    expect(r.cumpridos).toBe(1);
    expect(r.falhas).toBe(1); // a corrente não conta
  });
});

describe("celulasDoPeriodo — o mapa de calor", () => {
  it("devolve TODOS os dias, inclusive os não esperados", () => {
    // O mapa precisa dos buracos para as colunas ficarem alinhadas por dia da
    // semana. Quem desenha decide o que fazer com `esperado: false`.
    const h = habito({ schedule_kind: "weekdays", weekdays: [1] });
    const c = celulasDoPeriodo(h, new Set(), "2026-08-07", 7);
    expect(c).toHaveLength(7);
    expect(c.filter((x) => x.esperado)).toHaveLength(1);
  });

  it("termina em HOJE, e em ordem crescente", () => {
    const c = celulasDoPeriodo(habito(), new Set(), "2026-08-07", 3);
    expect(c.map((x) => x.dia)).toEqual(["2026-08-05", "2026-08-06", "2026-08-07"]);
  });

  it("marca pausa separadamente de não-esperado", () => {
    const pausas: PausaHabito[] = [
      { habit_id: null, starts_on: "2026-08-06", ends_on: "2026-08-06" },
    ];
    const c = celulasDoPeriodo(habito(), new Set(), "2026-08-07", 3, pausas);
    expect(c[1]?.pausado).toBe(true);
    expect(c[1]?.esperado).toBe(false);
    expect(c[0]?.pausado).toBe(false);
  });
});

describe("resumirHabitos — o conjunto", () => {
  const h1 = habito({ id: "a", name: "Ler", started_on: "2026-08-01" });
  const h2 = habito({
    id: "b",
    name: "Correr",
    schedule_kind: "weekdays",
    weekdays: [1, 3, 5],
    started_on: "2026-08-01",
  });

  it("conta o de hoje separado do período", () => {
    const mapa = new Map([
      ["a", feitos("2026-08-03")],
      ["b", new Set<string>()],
    ]);
    const r = resumirHabitos([h1, h2], mapa, "2026-08-01", SEGUNDA, SEGUNDA);
    // Segunda: os dois são esperados; só "Ler" foi feito.
    expect(r.hojeEsperados).toBe(2);
    expect(r.hojeFeitos).toBe(1);
  });

  it("hábito ARQUIVADO fica de fora", () => {
    const arquivado = habito({ id: "z", archived_at: "2026-08-01T00:00:00Z" });
    const r = resumirHabitos([h1, arquivado], new Map(), "2026-08-01", SEGUNDA, SEGUNDA);
    expect(r.porHabito).toHaveLength(1);
  });

  it("sem hábito nenhum, taxa é null e nada explode", () => {
    const r = resumirHabitos([], new Map(), "2026-08-01", SEGUNDA, SEGUNDA);
    expect(r.taxa).toBeNull();
    expect(r.hojeEsperados).toBe(0);
  });
});
