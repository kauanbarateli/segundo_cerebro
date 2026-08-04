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
      `bg-teal-${n}` montado em tempo de execução não é encontrado pela varredura
      do Tailwind, e a cor simplesmente não existe no CSS final: sem erro, sem
      aviso, e só na build de produção. Esta asserção não prova a ausência de
      concatenação, mas trava a FORMA que a varredura precisa encontrar.
    */
    for (const slot of [1, 2] as const) {
      const tom = tomDaConta(slot)!;
      expect(tom.ponto).toMatch(/^bg-[a-z]+-\d{3} dark:bg-[a-z]+-\d{3}$/);
      expect(tom.trilho).toMatch(/^border-l-2 border-l-[a-z]+-\d{3} dark:border-l-[a-z]+-\d{3}$/);
    }
  });

  it("os dois têm variante dark — a cor de papel branco some em superfície escura", () => {
    expect(tomDaConta(1)?.ponto).toContain("dark:");
    expect(tomDaConta(2)?.ponto).toContain("dark:");
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
