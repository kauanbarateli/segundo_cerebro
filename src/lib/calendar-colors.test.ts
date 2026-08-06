import { describe, expect, it } from "vitest";
import { rotuloDaConta, tomDaConta } from "./calendar-colors";

describe("tomDaConta", () => {
  it("dá tons DIFERENTES aos dois slots", () => {
    // O ponto inteiro da função. Se um dia os dois voltarem a ser iguais, é
    // porque alguém "unificou" a paleta e apagou a distinção sem perceber.
    const a = tomDaConta(1);
    const b = tomDaConta(2);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a?.trilho).not.toBe(b?.trilho);
    expect(a?.ponto).not.toBe(b?.ponto);
  });

  it("slot fora de {1, 2} não ganha tom inventado", () => {
    // O banco já garante `check (slot in (1, 2))`. Devolver um tom aqui pintaria
    // de teal uma terceira conta que ninguém sabe que existe.
    expect(tomDaConta(3)).toBeNull();
    expect(tomDaConta(0)).toBeNull();
    expect(tomDaConta(null)).toBeNull();
    expect(tomDaConta(undefined)).toBeNull();
  });

  it("NUNCA usa vermelho nem âmbar", () => {
    /*
      As duas únicas cores literais do projeto, e as duas já significam outra
      coisa: vermelho é erro, âmbar é aviso. Uma conta pintada de vermelho faria
      toda reunião dela parecer um problema.
    */
    for (const slot of [1, 2] as const) {
      const tom = tomDaConta(slot)!;
      const tudo = `${tom.trilho} ${tom.ponto} ${tom.texto}`;
      expect(tudo).not.toMatch(/\b(red|amber|orange|rose)-/);
    }
  });

  it("as classes são literais e completas — o Tailwind não acha nome montado", () => {
    /*
      `bg-${categoria}` montado em tempo de execução não é encontrado pela
      varredura do Tailwind, e a cor simplesmente não existe no CSS final: sem
      erro, sem aviso, e só na build de produção. Esta asserção não prova a
      ausência de concatenação, mas trava a FORMA que a varredura precisa
      encontrar.

      ⚠️ A forma mudou na migração para o DS 1.0. Antes era paleta crua com
      degrau numérico (`bg-teal-500`); agora é token semântico (`bg-work`). O
      que continua sendo verificado é o mesmo: nome de classe inteiro, escrito
      à mão, sem interpolação.
    */
    for (const slot of [1, 2] as const) {
      const tom = tomDaConta(slot)!;
      expect(tom.ponto).toMatch(/^bg-(work|personal)$/);
      expect(tom.trilho).toMatch(/^border-l-2 border-l-(work|personal)$/);
      expect(tom.texto).toMatch(/^text-(work|personal)-ink$/);
    }
  });

  it("o texto usa o degrau -ink, que é o único que passa em AA", () => {
    /*
      Os dois papéis não são intercambiáveis. `--sb-work` é #20B8A5 e tem 2.48 de
      contraste sobre branco: serve de PREENCHIMENTO (o ponto, o trilho) e seria
      ilegível como texto. `--sb-work-ink` é #0F7568, com 5.11. Trocar um pelo
      outro não quebra nada visível de imediato — só torna a legenda ilegível
      para quem mais precisa dela. Ver globals.css.
    */
    for (const slot of [1, 2] as const) {
      expect(tomDaConta(slot)!.texto).toContain("-ink");
      expect(tomDaConta(slot)!.ponto).not.toContain("-ink");
    }
  });

  it("o tom acompanha o tema sem variante `dark:` escrita à mão", () => {
    /*
      Antes cada tom carregava um par (`bg-teal-500 dark:bg-teal-400`), porque a
      saturação que funciona sobre papel branco some sobre superfície escura.
      Agora quem troca é a VARIÁVEL CSS, em `.dark` — e por isso um `dark:` aqui
      seria um segundo lugar decidindo a mesma coisa, livre para divergir do
      primeiro. A ausência dele é a garantia de que existe uma fonte só.
    */
    for (const slot of [1, 2] as const) {
      const tom = tomDaConta(slot)!;
      expect(`${tom.trilho} ${tom.ponto} ${tom.texto}`).not.toContain("dark:");
    }
  });
});

describe("rotuloDaConta — a metade que a cor acompanha", () => {
  it("prefere o apelido", () => {
    expect(rotuloDaConta({ display_name: "Trabalho", slot: 2 })).toBe("Trabalho");
  });

  it("sem apelido, cai no número do slot — nunca em vazio", () => {
    // Um evento sem rótulo nenhum e com cor seria exatamente o caso que a regra
    // "nunca só por cor" proíbe.
    expect(rotuloDaConta({ display_name: null, slot: 1 })).toBe("Conta 1");
  });

  it("sem conta, não inventa rótulo", () => {
    expect(rotuloDaConta(null)).toBeUndefined();
    expect(rotuloDaConta(undefined)).toBeUndefined();
  });
});
