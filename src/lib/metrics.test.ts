import { describe, expect, it } from "vitest";
import {
  CONTAGENS_ZERADAS,
  assuntoDoEmail,
  corpoDoEmail,
  montarResumo,
  semanaAnterior,
} from "./metrics";

/** 2026-08-03 é uma SEGUNDA-feira. É o dia em que o e-mail sai. */
const SEGUNDA = new Date("2026-08-03T14:00:00.000Z");

describe("semanaAnterior", () => {
  it("numa segunda, resume a semana que ACABOU de fechar", () => {
    // A semana corrente tem horas de vida numa segunda de manhã: um resumo dela
    // diria "0 tarefas concluídas" toda segunda.
    const j = semanaAnterior(SEGUNDA);
    expect(j.inicio).toBe("2026-07-27"); // segunda anterior
    expect(j.fim).toBe("2026-08-02"); // domingo anterior
  });

  it("sempre vai de segunda a domingo, seja qual for o dia da chamada", () => {
    for (const dia of ["03", "04", "05", "06", "07", "08", "09"]) {
      const j = semanaAnterior(new Date(`2026-08-${dia}T14:00:00.000Z`));
      expect(j.inicio).toBe("2026-07-27");
      expect(j.fim).toBe("2026-08-02");
    }
  });

  it("⚠️ DOMINGO pertence à semana que começou na segunda anterior", () => {
    /*
      O erro clássico: `getDay()` devolve 0 para domingo, e um recuo ingênuo de
      `dia - 1` mandaria o domingo para a segunda do dia seguinte. Aqui o
      domingo 2026-08-09 tem que enxergar a semana 27/07–02/08 como anterior, e
      não a de 03/08.
    */
    const j = semanaAnterior(new Date("2026-08-09T14:00:00.000Z"));
    expect(j.inicio).toBe("2026-07-27");
    expect(j.fim).toBe("2026-08-02");
  });

  it("⚠️ às 23h de São Paulo NÃO pula para a semana seguinte", () => {
    /*
      23h em São Paulo é 02:00 UTC do dia seguinte. Um cálculo feito no fuso do
      processo (a Vercel roda em UTC) trataria isso como o dia seguinte e, na
      virada domingo→segunda, resumiria a semana errada.

      Domingo 2026-08-02, 23h em São Paulo = 2026-08-03T02:00Z.
    */
    const j = semanaAnterior(new Date("2026-08-03T02:00:00.000Z"));
    expect(j.fim).toBe("2026-07-26");
    expect(j.inicio).toBe("2026-07-20");
  });

  it("a janela de instantes é fechada no início e ABERTA no fim", () => {
    const j = semanaAnterior(SEGUNDA);
    // Segunda 00:00 em São Paulo = 03:00 UTC (UTC-3).
    expect(j.inicioIso).toBe("2026-07-27T03:00:00.000Z");
    // Fim EXCLUSIVO: 00:00 da segunda seguinte. Um `23:59:59.999` inclusivo
    // deixaria escapar o que acontecesse no último milissegundo.
    expect(j.fimIso).toBe("2026-08-03T03:00:00.000Z");
    expect(j.fimIso > j.inicioIso).toBe(true);
  });

  it("o rótulo é dia/mês, para caber no assunto", () => {
    expect(semanaAnterior(SEGUNDA).rotulo).toBe("27/07 a 02/08");
  });

  it("atravessa a virada de mês e de ano sem inventar dia", () => {
    const j = semanaAnterior(new Date("2027-01-04T14:00:00.000Z")); // segunda
    expect(j.inicio).toBe("2026-12-28");
    expect(j.fim).toBe("2027-01-03");
  });
});

describe("montarResumo", () => {
  const janela = semanaAnterior(SEGUNDA);

  it("linha zerada é OMITIDA — menos as que dizem algo zeradas", () => {
    // Oito linhas dizendo "0" ensinam a não abrir o e-mail. Mas "concluídas: 0"
    // é justamente o número que se quer ver quando a semana não andou.
    const r = montarResumo(janela, CONTAGENS_ZERADAS);
    expect(r.linhas.map((l) => l.rotulo)).toEqual(["Tarefas concluídas"]);
    expect(r.vazio).toBe(true);
  });

  it("uma semana com movimento não é vazia", () => {
    const r = montarResumo(janela, { ...CONTAGENS_ZERADAS, paginasEditadas: 3 });
    expect(r.vazio).toBe(false);
    expect(r.linhas.some((l) => l.rotulo === "Páginas editadas")).toBe(true);
  });

  it("'atrasadas' diz que é foto do AGORA, não da semana", () => {
    // Sem o detalhe, o número seria lido como "atrasei 4 tarefas nesta semana",
    // que é outra coisa.
    const r = montarResumo(janela, { ...CONTAGENS_ZERADAS, tarefasAtrasadas: 4 });
    const linha = r.linhas.find((l) => l.rotulo === "Tarefas atrasadas");
    expect(linha?.detalhe).toContain("agora");
  });

  it("financeiro mostra o SALDO e abre entradas e saídas", () => {
    const r = montarResumo(janela, {
      ...CONTAGENS_ZERADAS,
      financeiroEntradas: 500_00,
      financeiroSaidas: 120_50,
    });
    const linha = r.linhas.find((l) => l.rotulo === "Financeiro");
    expect(linha?.valor).toContain("379,50");
    expect(linha?.detalhe).toContain("120,50");
  });

  it("linhas extras entram no fim e contam como movimento", () => {
    // É por aqui que Hábitos entra quando o módulo existir, sem que este
    // arquivo precise conhecê-lo.
    const r = montarResumo(janela, CONTAGENS_ZERADAS, [
      { rotulo: "Hábitos", valor: "12 de 14" },
    ]);
    expect(r.linhas.at(-1)?.rotulo).toBe("Hábitos");
    expect(r.vazio).toBe(false);
  });
});

describe("o e-mail", () => {
  const janela = semanaAnterior(SEGUNDA);

  it("o assunto leva a semana — é o que distingue um e-mail do da semana passada", () => {
    expect(assuntoDoEmail(montarResumo(janela, CONTAGENS_ZERADAS))).toBe(
      "Segundo Cérebro · semana de 27/07 a 02/08",
    );
  });

  it("gera as DUAS versões, e a de texto não é vazia", () => {
    /*
      O `text` não é formalidade: cliente com imagens bloqueadas, leitor de tela
      e a pré-visualização da caixa de entrada usam essa parte — e um remetente
      novo que só manda HTML é classificado pior pelos filtros de spam.
    */
    const c = corpoDoEmail(montarResumo(janela, { ...CONTAGENS_ZERADAS, tarefasConcluidas: 7 }));
    expect(c.texto).toContain("Tarefas concluídas: 7");
    expect(c.html).toContain("Tarefas concluídas");
    expect(c.texto.trim().length).toBeGreaterThan(0);
  });

  it("⚠️ o HTML é INLINE — Gmail e Outlook removem <style> do <head>", () => {
    const c = corpoDoEmail(montarResumo(janela, { ...CONTAGENS_ZERADAS, tarefasConcluidas: 1 }));
    expect(c.html).not.toContain("<style");
    expect(c.html).toContain("style=");
  });

  it("escapa o que vai para o HTML", () => {
    // Os rótulos são gerados aqui hoje, mas um rótulo vindo de dado do usuário
    // (nome de hábito, por exemplo) chega por `extras`.
    const c = corpoDoEmail(
      montarResumo(janela, CONTAGENS_ZERADAS, [
        { rotulo: '<script>alert("x")</script>', valor: "1" },
      ]),
    );
    expect(c.html).not.toContain("<script>");
    expect(c.html).toContain("&lt;script&gt;");
  });

  it("semana sem movimento tem corpo próprio, e ele explica o vazio", () => {
    const c = corpoDoEmail(montarResumo(janela, CONTAGENS_ZERADAS));
    expect(c.texto).toContain("Nenhum movimento");
  });
});
