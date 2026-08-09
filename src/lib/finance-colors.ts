/**
 * A COR DE CATEGORIA, ETIQUETA E CONTA NO FINANCEIRO.
 *
 * ============================================================================
 * A COLUNA JÁ EXISTIA, E ESTAVA SEM USO DESDE A PRIMEIRA MIGRATION DO MÓDULO
 * ============================================================================
 * `finance_categories.color_key`, `finance_tags.color_key` e
 * `finance_accounts.color_key` existem desde a 0005, todas `not null default
 * 'stone'`. Nenhuma migration nova foi necessária: o que faltava era o TRADUTOR
 * de chave para classe — este arquivo — e uma tela para escolher.
 *
 * (Registrando porque é fácil concluir o contrário: `finance_accounts` TEM a
 * coluna. Ela está lá na 0005:33, junto das outras duas, e `upsertAccount` já a
 * gravava — com `'stone'` fixo, porque não havia seletor.)
 *
 * ============================================================================
 * ⚠️ AS CLASSES SÃO LITERAIS, E ISSO NÃO É ESTILO — É O QUE FAZ A COR EXISTIR
 * ============================================================================
 * O Tailwind varre o código-fonte procurando nomes de classe INTEIROS.
 * `bg-cat-${chave}` montado em tempo de execução não é encontrado, a regra não
 * entra no CSS final, e a cor some — sem erro, sem aviso, e só na build de
 * produção, onde o CSS é podado.
 *
 * É a mesma armadilha que `calendar-colors.ts` documenta. Por isso o mapa abaixo
 * escreve cada classe por extenso, e é por isso que ele é FECHADO: acrescentar
 * uma cor exige uma linha aqui, e essa linha é a que o Tailwind lê.
 *
 * ============================================================================
 * A COR NUNCA VEM SOZINHA
 * ============================================================================
 * Toda legenda deste módulo traz nome, valor e percentual em texto. A cor
 * distingue mais rápido; ela não é o dado. Quem não separa terracota de violeta
 * continua lendo "Mercado — R$ 812,40 — 31%".
 *
 * O contraste de cada tom contra os quatro fundos de cada tema está medido no
 * bloco das categóricas em `globals.css` (piso de 3:1, WCAG 1.4.11).
 */

export const CHAVES_DE_COR = [
  "stone",
  "indigo",
  "ciano",
  "teal",
  "oliva",
  "terracota",
  "rosa",
  "violeta",
] as const;

export type ChaveDeCor = (typeof CHAVES_DE_COR)[number];

export interface TomDaCategoria {
  /** Ponto da legenda, faixa do cartão de conta, barra. */
  fundo: string;
  /**
   * Fundo TINGIDO, para quando há texto por cima.
   *
   * ⚠️ Existe por acessibilidade, não por estética. Texto branco sobre o tom
   * cheio dá 3.62:1 no pior caso do tema claro (teal), abaixo dos 4.5:1 de AA —
   * e no tema escuro, onde os tons são CLAROS, branco por cima seria ilegível
   * (oliva claro contra branco: 1.6:1). Com 15% de opacidade o fundo fica
   * praticamente a superfície, o texto usa `text-ink` normal, e a cor continua
   * identificando a conta pela moldura e pelo tingimento.
   */
  fundoSuave: string;
  /** Arco da rosca (SVG). É `stroke-*` e não `fill-*`: a rosca é um CÍRCULO
   *  traçado com `stroke-dasharray`, não um caminho preenchido. */
  traco: string;
  /** Moldura do botão de escolha, quando ele está selecionado. */
  borda: string;
}

const TONS: Record<ChaveDeCor, TomDaCategoria> = {
  stone: {
    fundo: "bg-cat-stone",
    fundoSuave: "bg-cat-stone/15",
    traco: "stroke-cat-stone",
    borda: "border-cat-stone",
  },
  indigo: {
    fundo: "bg-cat-indigo",
    fundoSuave: "bg-cat-indigo/15",
    traco: "stroke-cat-indigo",
    borda: "border-cat-indigo",
  },
  ciano: {
    fundo: "bg-cat-ciano",
    fundoSuave: "bg-cat-ciano/15",
    traco: "stroke-cat-ciano",
    borda: "border-cat-ciano",
  },
  teal: {
    fundo: "bg-cat-teal",
    fundoSuave: "bg-cat-teal/15",
    traco: "stroke-cat-teal",
    borda: "border-cat-teal",
  },
  oliva: {
    fundo: "bg-cat-oliva",
    fundoSuave: "bg-cat-oliva/15",
    traco: "stroke-cat-oliva",
    borda: "border-cat-oliva",
  },
  terracota: {
    fundo: "bg-cat-terracota",
    fundoSuave: "bg-cat-terracota/15",
    traco: "stroke-cat-terracota",
    borda: "border-cat-terracota",
  },
  rosa: {
    fundo: "bg-cat-rosa",
    fundoSuave: "bg-cat-rosa/15",
    traco: "stroke-cat-rosa",
    borda: "border-cat-rosa",
  },
  violeta: {
    fundo: "bg-cat-violeta",
    fundoSuave: "bg-cat-violeta/15",
    traco: "stroke-cat-violeta",
    borda: "border-cat-violeta",
  },
};

/** O nome da cor em português, para o `aria-label` do seletor. */
export const NOME_DA_COR: Record<ChaveDeCor, string> = {
  stone: "Cinza",
  indigo: "Índigo",
  ciano: "Ciano",
  teal: "Verde-azulado",
  oliva: "Oliva",
  terracota: "Terracota",
  rosa: "Rosa",
  violeta: "Violeta",
};

export function ehChaveDeCor(valor: string | null | undefined): valor is ChaveDeCor {
  return valor != null && (CHAVES_DE_COR as readonly string[]).includes(valor);
}

/**
 * O tom de uma `color_key` vinda do banco.
 *
 * A coluna é `text` livre — o banco aceita qualquer string, e existe dado
 * gravado por outras telas (`'graphite'` do calendário, por exemplo). Chave
 * desconhecida cai em `stone`, que é o default da própria coluna: nunca uma
 * classe inventada, que sumiria do CSS, e nunca uma exceção, que derrubaria um
 * gráfico inteiro por causa de uma linha.
 */
export function tomDaCor(chave: string | null | undefined): TomDaCategoria {
  return TONS[ehChaveDeCor(chave) ? chave : "stone"];
}

/**
 * Uma cor para cada item de uma lista, quando NINGUÉM escolheu ainda.
 *
 * O default da coluna é `'stone'` para todo mundo, então um gráfico recém-aberto
 * teria oito fatias cinzas — tecnicamente correto e visualmente inútil. Aqui a
 * posição na lista (já ordenada por valor) escolhe a cor, e `stone` fica de fora
 * do rodízio para continuar significando "sem cor escolhida".
 *
 * ⚠️ A cor derivada é ESTÁVEL dentro de um gráfico e NÃO entre gráficos: a mesma
 * categoria pode aparecer índigo num mês e ciano no outro, porque a ordem por
 * valor muda. É o preço de não inventar cor no banco — e é por isso que a
 * legenda com nome fica ao lado, sempre. Quem quiser cor fixa escolhe uma, e aí
 * `color_key` deixa de ser `'stone'` e esta função sai do caminho.
 */
export function corDaPosicao(chave: string | null | undefined, posicao: number): TomDaCategoria {
  if (ehChaveDeCor(chave) && chave !== "stone") return TONS[chave];
  const rodizio = CHAVES_DE_COR.filter((c) => c !== "stone");
  return TONS[rodizio[posicao % rodizio.length]!];
}
