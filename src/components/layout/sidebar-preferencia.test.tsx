// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AO_RECOLHER_OCULTA,
  AO_RECOLHER_SO_ICONE,
  aplicarRecolhidaNoDocumento,
  ATRIBUTO_SIDEBAR,
  CHAVE_SIDEBAR,
  guardarPreferenciaRecolhida,
  lerPreferenciaRecolhida,
  sidebarInitScript,
  VALOR_RECOLHIDA,
} from "./sidebar-preferencia";

/**
 * ============================================================================
 * POR QUE ESTE ARQUIVO EXISTE
 * ============================================================================
 * `sidebarInitScript` é CÓDIGO DENTRO DE UMA STRING. O TypeScript não o
 * compila, o ESLint não o lê e o Tailwind não o enxerga — é o único trecho do
 * recolhimento que nenhuma ferramenta confere. E ele é justamente o que impede
 * a barra de piscar de 16rem para 4rem a cada carregamento.
 *
 * Pior: quando esse script quebra, ele quebra EM SILÊNCIO. Não há exceção (está
 * todo dentro de um try), não há erro de compilação e a tela continua
 * funcionando — só volta a piscar. É o tipo de defeito que só é notado meses
 * depois, e sem pista nenhuma de quando começou.
 *
 * Os testes abaixo executam o script de verdade num DOM de verdade e comparam o
 * resultado com o do caminho de React, que é o outro jeito de escrever o mesmo
 * atributo. É esse PAREAMENTO que vale: dois caminhos escrevendo estados
 * diferentes é exatamente o defeito que produziria o pisca-pisca de volta.
 *
 * ============================================================================
 * ⚠️ POR QUE UM STORAGE FALSO, E NÃO O DO jsdom
 * ============================================================================
 * Neste ambiente `globalThis.localStorage` NÃO é o do jsdom: o Node 24 (ver
 * `engines` no package.json) traz um `localStorage` experimental próprio, que só
 * funciona com `--localstorage-file`, e ele já ocupa o global quando o jsdom se
 * instala. O que sobra é um objeto vazio — `localStorage.setItem` nem função é.
 *
 * O sintoma seria traiçoeiro: o script em teste guarda tudo dentro de um
 * try/catch, então engoliria a falha e os testes "passariam" afirmando sobre um
 * armazenamento que nunca gravou nada. Substituir o global por um Storage de
 * mentira resolve e ainda deixa o teste determinístico — é o mesmo caminho que
 * `src/lib/capture-draft.test.ts` já tinha escolhido, por razão parecida.
 */

function storageFalso(): Storage {
  const mapa = new Map<string, string>();
  return {
    get length() {
      return mapa.size;
    },
    key: (i: number) => [...mapa.keys()][i] ?? null,
    getItem: (k: string) => mapa.get(k) ?? null,
    setItem: (k: string, v: string) => void mapa.set(k, v),
    removeItem: (k: string) => void mapa.delete(k),
    clear: () => mapa.clear(),
  } as Storage;
}

/** Armazenamento bloqueado: modo privado do Safari, cookies de terceiros
 *  desligados. LANÇA em vez de devolver null — é a parte que costuma ser
 *  esquecida por quem só testa o caminho feliz. */
function storageQueLanca(): Storage {
  const lanca = () => {
    throw new Error("armazenamento bloqueado");
  };
  return { getItem: lanca, setItem: lanca, removeItem: lanca, clear: lanca } as unknown as Storage;
}

function instalarStorage(storage: Storage) {
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
}

function rodarScript() {
  // `new Function` avalia no escopo GLOBAL, que é onde `document` e
  // `localStorage` vivem — reproduzindo o que o navegador faz ao encontrar a
  // tag <script> inline.
  new Function(sidebarInitScript)();
}

beforeEach(() => {
  instalarStorage(storageFalso());
});

afterEach(() => {
  document.documentElement.removeAttribute(ATRIBUTO_SIDEBAR);
});

describe("script de inicialização da barra lateral", () => {
  it("marca o <html> quando a preferência guardada é recolhida", () => {
    localStorage.setItem(CHAVE_SIDEBAR, VALOR_RECOLHIDA);
    rodarScript();
    expect(document.documentElement.getAttribute(ATRIBUTO_SIDEBAR)).toBe(VALOR_RECOLHIDA);
  });

  it("não marca nada quando não há preferência guardada", () => {
    rodarScript();
    expect(document.documentElement.hasAttribute(ATRIBUTO_SIDEBAR)).toBe(false);
  });

  it("APAGA marca antiga quando a preferência voltou a ser expandida", () => {
    // O <html> sobrevive à navegação do lado do cliente. Sem o `else` que
    // remove o atributo, expandir a barra numa aba deixaria a outra recolhida
    // até o próximo recarregamento completo.
    document.documentElement.setAttribute(ATRIBUTO_SIDEBAR, VALOR_RECOLHIDA);
    guardarPreferenciaRecolhida(false);
    rodarScript();
    expect(document.documentElement.hasAttribute(ATRIBUTO_SIDEBAR)).toBe(false);
  });

  it("não propaga exceção quando o armazenamento está bloqueado", () => {
    // Uma exceção aqui interromperia o parser no meio do documento: a aplicação
    // inteira sumiria por causa de uma preferência de menu.
    instalarStorage(storageQueLanca());
    expect(() => rodarScript()).not.toThrow();
    expect(() => guardarPreferenciaRecolhida(true)).not.toThrow();
    expect(lerPreferenciaRecolhida()).toBe(false);
  });

  it("escreve exatamente o mesmo atributo que o caminho do React", () => {
    localStorage.setItem(CHAVE_SIDEBAR, VALOR_RECOLHIDA);
    rodarScript();
    const peloScript = document.documentElement.getAttribute(ATRIBUTO_SIDEBAR);

    document.documentElement.removeAttribute(ATRIBUTO_SIDEBAR);
    aplicarRecolhidaNoDocumento(lerPreferenciaRecolhida());
    expect(document.documentElement.getAttribute(ATRIBUTO_SIDEBAR)).toBe(peloScript);
  });

  it("a ida e a volta do par guardar/ler se fecham", () => {
    guardarPreferenciaRecolhida(true);
    expect(lerPreferenciaRecolhida()).toBe(true);
    guardarPreferenciaRecolhida(false);
    expect(lerPreferenciaRecolhida()).toBe(false);
  });
});

describe("classes do estado recolhido", () => {
  /**
   * O Tailwind não executa código: as classes precisam citar o valor
   * "recolhida" LITERALMENTE, então a constante e o seletor são duas cópias da
   * mesma palavra. Renomear a constante sem renomear as classes compilaria,
   * passaria no lint e deixaria a barra sem recolher nada.
   */
  it("apontam para o mesmo valor de atributo que o script grava", () => {
    const seletorEsperado = `[${ATRIBUTO_SIDEBAR}=${VALOR_RECOLHIDA}]`;
    expect(AO_RECOLHER_OCULTA).toContain(seletorEsperado);
    for (const classe of AO_RECOLHER_SO_ICONE.split(" ")) {
      expect(classe).toContain(seletorEsperado);
    }
  });
});
