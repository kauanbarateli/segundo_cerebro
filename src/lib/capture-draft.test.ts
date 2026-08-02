import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  apagarRascunho,
  chaveDoRascunho,
  gravarRascunho,
  lerRascunho,
  limparRascunhosDeCaptura,
  limparResiduoLegado,
} from "./capture-draft";

/**
 * O ambiente de teste é `node`, sem `window`. Um Storage falso é suficiente e
 * até preferível: ele deixa afirmar sobre o CONTEÚDO de cada storage
 * separadamente, que é justamente o que distingue as duas limpezas.
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

const UM = "11111111-1111-4111-8111-111111111111";
const OUTRO = "22222222-2222-4222-8222-222222222222";

let sessionStorage: Storage;
let localStorage: Storage;

beforeEach(() => {
  sessionStorage = storageFalso();
  localStorage = storageFalso();
  vi.stubGlobal("window", { sessionStorage, localStorage });
});

describe("chave do rascunho", () => {
  it("é namespaceada por usuário", () => {
    expect(chaveDoRascunho(UM)).toBe(`sb-capture-draft:${UM}`);
    expect(chaveDoRascunho(UM)).not.toBe(chaveDoRascunho(OUTRO));
  });
});

describe("onde o rascunho é gravado", () => {
  it("vai para sessionStorage, nunca para localStorage", () => {
    gravarRascunho(UM, '{"title":"segredo"}');
    expect(sessionStorage.getItem(chaveDoRascunho(UM))).toBe('{"title":"segredo"}');
    expect(localStorage.length).toBe(0);
  });

  it("uma conta não lê o rascunho da outra", () => {
    gravarRascunho(UM, "meu");
    expect(lerRascunho(OUTRO)).toBeNull();
    expect(lerRascunho(UM)).toBe("meu");
  });

  it("apagar remove só a chave do dono", () => {
    gravarRascunho(UM, "a");
    gravarRascunho(OUTRO, "b");
    apagarRascunho(UM);
    expect(lerRascunho(UM)).toBeNull();
    expect(lerRascunho(OUTRO)).toBe("b");
  });
});

describe("limparResiduoLegado (montagem do compositor)", () => {
  it("apaga a chave global antiga do localStorage", () => {
    // O estado real de quem usou a versão anterior: texto em claro, permanente.
    localStorage.setItem("sb-capture-draft", '{"content":"ideia antiga"}');
    limparResiduoLegado();
    expect(localStorage.getItem("sb-capture-draft")).toBeNull();
  });

  it("NÃO toca no rascunho da sessão — senão apagaria o que vai restaurar", () => {
    gravarRascunho(UM, "escrevendo agora");
    localStorage.setItem("sb-capture-draft", "lixo antigo");

    limparResiduoLegado();

    expect(localStorage.length).toBe(0);
    expect(lerRascunho(UM)).toBe("escrevendo agora");
  });

  it("varre também chaves namespaceadas que tenham ido parar no localStorage", () => {
    localStorage.setItem(chaveDoRascunho(UM), "x");
    localStorage.setItem(chaveDoRascunho(OUTRO), "y");
    localStorage.setItem("sb-theme", "dark");

    limparResiduoLegado();

    expect(localStorage.getItem(chaveDoRascunho(UM))).toBeNull();
    expect(localStorage.getItem(chaveDoRascunho(OUTRO))).toBeNull();
    // Chave de outro recurso permanece: a varredura é por prefixo, não um clear().
    expect(localStorage.getItem("sb-theme")).toBe("dark");
  });
});

describe("limparRascunhosDeCaptura (logout)", () => {
  it("apaga os dois storages, de todos os usuários", () => {
    gravarRascunho(UM, "a");
    gravarRascunho(OUTRO, "b");
    localStorage.setItem("sb-capture-draft", "antigo");
    localStorage.setItem("sb-theme", "dark");

    limparRascunhosDeCaptura();

    expect(sessionStorage.length).toBe(0);
    expect(localStorage.getItem("sb-capture-draft")).toBeNull();
    expect(localStorage.getItem("sb-theme")).toBe("dark");
  });

  it("remove TODAS as entradas mesmo com várias na fila", () => {
    // Regressão do laço: `Storage.key(i)` é indexado por posição, e remover
    // durante a varredura reindexa o que sobrou. Uma implementação que remove
    // dentro do laço deixa metade das chaves para trás.
    for (let i = 0; i < 10; i++) {
      sessionStorage.setItem(`sb-capture-draft:usuario-${i}`, "x");
    }
    expect(sessionStorage.length).toBe(10);

    limparRascunhosDeCaptura();

    expect(sessionStorage.length).toBe(0);
  });
});

describe("armazenamento indisponível", () => {
  it("não lança quando o navegador bloqueia o Storage", () => {
    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new Error("SecurityError: acesso negado");
      },
      get localStorage(): Storage {
        throw new Error("SecurityError: acesso negado");
      },
    });

    // Safari em navegação privada é o caso clássico. Derrubar a tela de captura
    // para salvar um rascunho seria trocar o recurso principal pelo acessório.
    expect(() => gravarRascunho(UM, "x")).not.toThrow();
    expect(lerRascunho(UM)).toBeNull();
    expect(() => limparRascunhosDeCaptura()).not.toThrow();
    expect(() => limparResiduoLegado()).not.toThrow();
  });
});
