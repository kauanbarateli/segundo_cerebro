import { beforeEach, describe, expect, it } from "vitest";
import {
  bloqueioPorLimite,
  chaveDeUsuario,
  chavesEmMemoria,
  TETO_DE_CHAVES,
  verificarLimite,
  zerarLimites,
  type Limite,
} from "./rate-limit";

/**
 * O relógio é SEMPRE explícito nestes testes.
 *
 * Nenhum caso chama `Date.now()` nem `await sleep(...)`: "a janela expirou" é
 * uma soma de números. Isso é o que torna a suíte instantânea e determinística
 * — um teste de janela deslizante que dorme 60 s é um teste que ninguém roda, e
 * um que dorme 100 ms é um teste que falha sozinho na integração contínua no
 * dia em que a máquina estiver ocupada.
 *
 * `T0` é um instante arbitrário e redondo; o que importa são as diferenças.
 */
const T0 = 1_700_000_000_000;

/** Limite pequeno para os casos caberem na cabeça: 3 operações por segundo. */
const LIMITE: Limite = { maximo: 3, janelaMs: 1_000 };

beforeEach(() => {
  // O estado mora em módulo (é o Map do processo), então sem esta limpeza a
  // ordem dos casos passaria a importar.
  zerarLimites();
});

describe("verificarLimite", () => {
  it("dentro do limite, passa", () => {
    for (let i = 0; i < LIMITE.maximo; i++) {
      const r = verificarLimite("chave", LIMITE, T0 + i);
      expect(r.permitido).toBe(true);
      expect(r.esperarMs).toBe(0);
    }
  });

  it("acima do limite, bloqueia", () => {
    for (let i = 0; i < LIMITE.maximo; i++) verificarLimite("chave", LIMITE, T0);

    const r = verificarLimite("chave", LIMITE, T0);
    expect(r.permitido).toBe(false);
    expect(r.restantes).toBe(0);
  });

  it("depois da janela expirar, volta a passar", () => {
    for (let i = 0; i < LIMITE.maximo; i++) verificarLimite("chave", LIMITE, T0);
    expect(verificarLimite("chave", LIMITE, T0).permitido).toBe(false);

    // Um milissegundo DEPOIS da janela fechar sobre a marca mais antiga.
    expect(verificarLimite("chave", LIMITE, T0 + LIMITE.janelaMs + 1).permitido).toBe(true);
  });

  it("a janela DESLIZA: expira uma marca de cada vez, não o balde inteiro", () => {
    // Três operações espaçadas em 100 ms.
    verificarLimite("chave", LIMITE, T0);
    verificarLimite("chave", LIMITE, T0 + 100);
    verificarLimite("chave", LIMITE, T0 + 200);
    expect(verificarLimite("chave", LIMITE, T0 + 300).permitido).toBe(false);

    // Passou a janela da PRIMEIRA marca: abre exatamente UMA vaga.
    const t = T0 + LIMITE.janelaMs + 1;
    expect(verificarLimite("chave", LIMITE, t).permitido).toBe(true);
    // E só uma: as marcas de +100 e +200 ainda estão dentro da janela.
    expect(verificarLimite("chave", LIMITE, t).permitido).toBe(false);
  });

  it("`restantes` conta as vagas que sobraram", () => {
    expect(verificarLimite("chave", LIMITE, T0).restantes).toBe(2);
    expect(verificarLimite("chave", LIMITE, T0).restantes).toBe(1);
    expect(verificarLimite("chave", LIMITE, T0).restantes).toBe(0);
  });

  it("`esperarMs` diz quanto falta para a vaga mais próxima abrir", () => {
    for (let i = 0; i < LIMITE.maximo; i++) verificarLimite("chave", LIMITE, T0);

    // 300 ms depois, faltam 700 ms para a marca mais antiga sair da janela.
    const r = verificarLimite("chave", LIMITE, T0 + 300);
    expect(r.permitido).toBe(false);
    expect(r.esperarMs).toBe(700);
  });

  it("tentativa bloqueada NÃO empurra a janela para frente", () => {
    for (let i = 0; i < LIMITE.maximo; i++) verificarLimite("chave", LIMITE, T0);

    // Um laço martelando durante a janela inteira.
    for (let t = T0; t < T0 + LIMITE.janelaMs; t += 10) {
      expect(verificarLimite("chave", LIMITE, t).permitido).toBe(false);
    }

    // Se as tentativas recusadas tivessem sido registradas, o bloqueio seria
    // eterno enquanto o laço rodasse — e o dono ficaria preso junto.
    expect(verificarLimite("chave", LIMITE, T0 + LIMITE.janelaMs + 1).permitido).toBe(true);
  });

  it("chaves diferentes não dividem cota", () => {
    for (let i = 0; i < LIMITE.maximo; i++) verificarLimite("usuario-a", LIMITE, T0);
    expect(verificarLimite("usuario-a", LIMITE, T0).permitido).toBe(false);
    expect(verificarLimite("usuario-b", LIMITE, T0).permitido).toBe(true);
  });
});

describe("chaveDeUsuario", () => {
  it("separa a cota por ação, para um módulo não bloquear o outro", () => {
    const usuario = "0f8f...";
    const tarefa = chaveDeUsuario("tarefa:criar", usuario);
    const lancamento = chaveDeUsuario("financeiro:lancamento", usuario);
    expect(tarefa).not.toBe(lancamento);

    for (let i = 0; i < LIMITE.maximo; i++) verificarLimite(tarefa, LIMITE, T0);
    expect(verificarLimite(tarefa, LIMITE, T0).permitido).toBe(false);
    expect(verificarLimite(lancamento, LIMITE, T0).permitido).toBe(true);
  });
});

describe("bloqueioPorLimite", () => {
  it("devolve null enquanto pode seguir", () => {
    expect(bloqueioPorLimite("acao", "usuario", LIMITE, T0)).toBeNull();
  });

  it("devolve erro com o tempo de espera arredondado para cima", () => {
    for (let i = 0; i < LIMITE.maximo; i++) bloqueioPorLimite("acao", "usuario", LIMITE, T0);

    const bloqueio = bloqueioPorLimite("acao", "usuario", LIMITE, T0 + 300);
    expect(bloqueio).not.toBeNull();
    expect(bloqueio!.ok).toBe(false);
    // 700 ms viram "1s" — arredondar para baixo prometeria uma vaga que ainda
    // não existe e o usuário voltaria para o mesmo erro.
    expect(bloqueio!.error).toContain("1s");
  });
});

describe("limpeza preguiçosa (o vazamento de memória)", () => {
  /**
   * Uma chave a mais que o teto: é assim que se arma o gatilho POR TAMANHO da
   * varredura, que é o determinístico. O outro gatilho (a cada N chamadas)
   * também limparia, só que numa chamada futura qualquer — memória é reclamada
   * na próxima rajada, não no instante em que expira, e isso é o preço
   * combinado de não ter timer de fundo.
   */
  const CHAVES = TETO_DE_CHAVES + 1;

  it("varre e apaga as chaves cuja janela já expirou, sem timer nenhum", () => {
    // Chaves distintas — o cenário do laço automatizado, e também o do uso
    // normal ao longo de meses.
    for (let i = 0; i < CHAVES; i++) verificarLimite(`chave-${i}`, LIMITE, T0);
    expect(chavesEmMemoria()).toBe(CHAVES);

    // Muito depois, uma única chamada. A varredura amortizada roda DENTRO dela
    // e leva junto tudo que expirou.
    verificarLimite("chave-nova", LIMITE, T0 + 10 * LIMITE.janelaMs);

    // Sobra só a chave recém-usada: as velhas não têm mais marca viva.
    expect(chavesEmMemoria()).toBe(1);
  });

  it("a varredura NÃO apaga quem ainda está dentro da janela", () => {
    for (let i = 0; i < CHAVES; i++) verificarLimite(`chave-${i}`, LIMITE, T0);

    // Meia janela depois: todas as marcas continuam válidas.
    verificarLimite("chave-nova", LIMITE, T0 + LIMITE.janelaMs / 2);
    expect(chavesEmMemoria()).toBe(CHAVES + 1);

    // E o limite continua valendo para elas — varrer não pode virar perdoar.
    for (let i = 1; i < LIMITE.maximo; i++) {
      verificarLimite("chave-0", LIMITE, T0 + LIMITE.janelaMs / 2);
    }
    expect(verificarLimite("chave-0", LIMITE, T0 + LIMITE.janelaMs / 2).permitido).toBe(false);
  });
});
