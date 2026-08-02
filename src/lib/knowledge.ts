import type {
  KnowledgePageNode,
  KnowledgePageSummary,
  ProseMirrorDoc,
} from "@/lib/database.types";

/**
 * Lógica PURA do módulo Conhecimento: montagem da árvore, caminho até a página
 * e cálculo de posição entre irmãs.
 *
 * Este arquivo NÃO importa `server-only` de propósito — o mesmo raciocínio de
 * `links.ts`. A árvore é desenhada no servidor mas manipulada no cliente
 * (arrastar, expandir, renomear em linha), então as duas metades precisam
 * enxergar a mesma regra. Se isso morasse em `data.ts`, que é server-only,
 * qualquer componente de cliente que importasse a função quebraria o build.
 *
 * Como é puro, é o único pedaço do módulo que dá para testar sem banco — e é
 * justamente onde moram os laços e as comparações que erram em silêncio.
 */

/**
 * Título mostrado quando a página não tem um.
 *
 * O banco tem o default `'Sem titulo'` (sem acento, como todo literal de 0011),
 * mas ele só entra em linha criada FORA da aplicação. `createPage` grava esta
 * constante, de forma que o rótulo na barra lateral, o `<title>` da aba e o
 * fallback de exibição digam exatamente a mesma coisa.
 */
export const TITULO_PADRAO = "Sem título";

/**
 * Documento vazio válido para o editor.
 *
 * Existe porque o default da coluna é `'{}'::jsonb`, que passa no CHECK
 * (`jsonb_typeof(content) = 'object'`) mas NÃO é um documento do ProseMirror —
 * não tem `type`. Um editor que recebesse `{}` quebraria ao montar o documento.
 * `createPage` grava este valor e `normalizarDocumento` conserta o que já
 * estiver gravado, para que o editor nunca precise se defender disso.
 */
export const DOCUMENTO_VAZIO: ProseMirrorDoc = { type: "doc", content: [] };

/** Profundidade máxima percorrida ao montar/subir a árvore. Ver `montarArvore`. */
const PROFUNDIDADE_MAXIMA = 256;

/**
 * Garante que o que chega ao editor é um documento montável.
 *
 * Devolve uma CÓPIA nova de `DOCUMENTO_VAZIO` no caso ruim, nunca a própria
 * constante: o editor trata o documento como estrutura viva e um objeto
 * compartilhado entre páginas viraria conteúdo vazando de uma para outra.
 */
export function normalizarDocumento(valor: unknown): ProseMirrorDoc {
  if (valor !== null && typeof valor === "object" && !Array.isArray(valor)) {
    const doc = valor as { type?: unknown };
    if (typeof doc.type === "string" && doc.type.length > 0) {
      return valor as ProseMirrorDoc;
    }
  }
  return { type: "doc", content: [] };
}

/** Rótulo de exibição: título em branco não pode virar item invisível na árvore. */
export function rotuloDaPagina(titulo: string | null | undefined): string {
  const limpo = (titulo ?? "").trim();
  return limpo.length > 0 ? limpo : TITULO_PADRAO;
}

/**
 * Monta a árvore a partir da lista CHAPADA de páginas do caderno.
 *
 * UMA passada para indexar por id, outra para pendurar cada nó na mãe. Nada de
 * "procurar os filhos de X varrendo a lista", que seria O(n²) e aparece na
 * primeira página com algumas centenas de nós.
 *
 * ÓRFÃO VIRA RAIZ, e esta é a decisão que mais importa aqui. Uma página cuja mãe
 * não está na lista (mãe com `deleted_at` preenchido, mãe em outro caderno por
 * um dado antigo, lista filtrada) simplesmente NÃO TERIA onde ser pendurada. A
 * implementação ingênua — pendurar só quem tem mãe conhecida — faria essa página
 * desaparecer da barra lateral sem erro nenhum, e o usuário concluiria que
 * perdeu o texto. Promovida ao topo ela continua alcançável, que é o que
 * interessa.
 *
 * A ordem entre irmãs é a que veio do banco (`order by position`), preservada
 * porque a inserção é feita na ordem da lista de entrada. Não há `sort` aqui: o
 * índice `knowledge_pages_notebook_tree_idx` já entrega a ordem, e reordenar em
 * memória só criaria uma segunda definição de "ordem" para divergir da primeira.
 */
export function montarArvore(paginas: KnowledgePageSummary[]): KnowledgePageNode[] {
  const porId = new Map<string, KnowledgePageNode>();
  for (const pagina of paginas) {
    porId.set(pagina.id, { ...pagina, children: [], depth: 0 });
  }

  /**
   * A página vai para o topo em vez de ser pendurada na mãe?
   *
   * Três casos, e os dois últimos são defesa contra dado inconsistente:
   *   - sem mãe: é raiz de verdade, o caso normal;
   *   - mãe FORA da lista: órfão (ver o comentário da função);
   *   - subir pela cadeia de mães volta à própria página: CICLO. Sem este teste,
   *     um par A→B→A não seria raiz de ninguém, ficaria pendurado só em si mesmo
   *     e as duas páginas sumiriam da barra lateral. O trigger
   *     `trg_knowledge_pages_no_cycle` impede que isso seja gravado pela
   *     aplicação, mas um restore ou uma escrita com service_role não passam por
   *     ele — e o preço de conferir é um laço curto sobre a altura da árvore.
   */
  const vaiParaOTopo = (pagina: KnowledgePageSummary): boolean => {
    if (!pagina.parent_id) return true;
    if (!porId.has(pagina.parent_id)) return true;

    let cursor = porId.get(pagina.parent_id);
    let guarda = 0;
    while (cursor && guarda < PROFUNDIDADE_MAXIMA) {
      if (cursor.id === pagina.id) return true;
      cursor = cursor.parent_id ? porId.get(cursor.parent_id) : undefined;
      guarda++;
    }
    // Saiu por `cursor` indefinido = chegou ao topo sem reencontrar a página:
    // pode pendurar. Saiu pelo guarda = cadeia funda ou circular demais para
    // confiar; vira raiz, que é o estado visível.
    return guarda >= PROFUNDIDADE_MAXIMA;
  };

  const raizes: KnowledgePageNode[] = [];
  for (const pagina of paginas) {
    const no = porId.get(pagina.id);
    if (!no) continue;
    const mae = vaiParaOTopo(pagina) ? undefined : porId.get(pagina.parent_id as string);
    if (mae) mae.children.push(no);
    else raizes.push(no);
  }

  // Com os ciclos já quebrados acima, o que sobrou é uma floresta de verdade —
  // cada nó tem no máximo uma mãe e nenhum ramo volta. `depth` sai de uma
  // travessia ITERATIVA mesmo assim: recursão sobre estrutura vinda do banco
  // estoura a pilha de chamadas no caso patológico e derruba a renderização
  // inteira, enquanto a pilha explícita cresce no heap.
  const pilha: { no: KnowledgePageNode; nivel: number }[] = raizes.map((no) => ({ no, nivel: 0 }));
  while (pilha.length > 0) {
    const atual = pilha.pop();
    if (!atual) break;
    atual.no.depth = atual.nivel;
    for (const filho of atual.no.children) pilha.push({ no: filho, nivel: atual.nivel + 1 });
  }

  return raizes;
}

/**
 * Caminho da raiz até a página, para o breadcrumb.
 *
 * Recebe a lista CHAPADA (não a árvore) porque subir por `parent_id` é O(altura)
 * enquanto procurar o nó dentro da árvore montada é O(n). O guarda de
 * profundidade é o mesmo do Drive: o trigger do banco já impede ciclos, mas um
 * laço infinito aqui derrubaria a página inteira.
 *
 * Devolve `[]` quando a página não está na lista — nunca um caminho pela metade.
 */
export function caminhoDaPagina(
  paginas: KnowledgePageSummary[],
  pageId: string,
): KnowledgePageSummary[] {
  const porId = new Map(paginas.map((p) => [p.id, p]));
  const caminho: KnowledgePageSummary[] = [];
  let cursor = porId.get(pageId);
  let guarda = 0;
  const vistos = new Set<string>();
  while (cursor && guarda < PROFUNDIDADE_MAXIMA && !vistos.has(cursor.id)) {
    vistos.add(cursor.id);
    caminho.unshift(cursor);
    cursor = cursor.parent_id ? porId.get(cursor.parent_id) : undefined;
    guarda++;
  }
  return caminho;
}

/**
 * Posição fracionária entre duas irmãs — o que `movePage` recebe ao arrastar.
 *
 * `anterior`/`proxima` são as posições dos vizinhos no DESTINO (null quando o
 * item vai para a ponta). Mover custa 1 UPDATE, e não uma renumeração da lista
 * inteira: é o mesmo esquema de `tasks.board_position` (0003).
 *
 * O DESGASTE DO FRACIONÁRIO: cada inserção no mesmo ponto divide o intervalo por
 * dois, e depois de ~50 inserções seguidas entre as MESMAS duas páginas os dois
 * valores ficam a uma distância que o `double` do JavaScript não consegue mais
 * partir — a média passa a ser igual a uma das pontas e a ordem trava. A coluna
 * no banco é `numeric` (precisão arbitrária) e aguentaria; o JavaScript não. Por
 * isso o caso é DETECTADO e devolvido como `null`, que a action interpreta como
 * "sem posição" (mantém a atual). Devolver a média empatada seria pior: a ordem
 * ficaria indeterminada e mudaria sozinha entre dois carregamentos.
 */
export function posicaoEntre(anterior: number | null, proxima: number | null): number | null {
  if (anterior === null && proxima === null) {
    // Lista vazia: mesmo valor que o default da coluna produziria (epoch em
    // segundos, fracionário), para que a página nova continue caindo no fim de
    // uma lista cujas posições vieram daquele default.
    return Date.now() / 1000;
  }
  if (anterior === null) return (proxima as number) - 1;
  if (proxima === null) return anterior + 1;

  const media = (anterior + proxima) / 2;
  if (media <= Math.min(anterior, proxima) || media >= Math.max(anterior, proxima)) return null;
  return media;
}

/* ----------------------------------------------------- árvore desenhada */

/**
 * Uma linha VISÍVEL da árvore, já com tudo que o `role="treeitem"` precisa
 * declarar.
 *
 * Os três campos de ARIA (`nivel`, `posicao`, `total`) saem daqui e não do JSX
 * porque um `role="tree"` mente com muita facilidade: o leitor de tela anuncia
 * "nível 2, item 3 de 5" a partir deles, e como o DOM é aninhado ninguém percebe
 * quando divergem da árvore real. Calculando na mesma passada que decide o que
 * aparece, os dois não têm como discordar.
 *
 * `nivel` e `posicao` são 1-BASED porque `aria-level` e `aria-posinset` são
 * definidos assim — `depth` do nó continua 0-based e não é usado na tela.
 */
export interface LinhaVisivel {
  no: KnowledgePageNode;
  /** `aria-level`: 1 nas páginas de topo. */
  nivel: number;
  /** `aria-posinset`: posição entre as IRMÃS, contando de 1. */
  posicao: number;
  /** `aria-setsize`: quantas irmãs existem neste ramo. */
  total: number;
  temFilhas: boolean;
  expandida: boolean;
  /**
   * Id da linha que a renderiza como filha — o destino da seta ESQUERDA.
   *
   * Não é o mesmo que `no.parent_id`: uma página órfã (mãe apagada) é promovida
   * ao topo por `montarArvore`, e ali `parent_id` aponta para uma linha que não
   * está na tela. Seguir `parent_id` mandaria o foco para lugar nenhum.
   */
  maeId: string | null;
}

/**
 * Achata a árvore na lista de linhas que estão REALMENTE visíveis.
 *
 * A navegação por setas de um `role="tree"` é sobre a ordem VISUAL, não sobre a
 * estrutura: seta para baixo vai para a próxima linha na tela, que pode ser a
 * filha (se o nó está aberto) ou a tia (se está fechado). Resolver isso lendo a
 * árvore aninhada a cada tecla seria uma travessia por tecla e um punhado de
 * casos de borda; com a lista achatada, "próxima" é `indice + 1`.
 *
 * DUAS GUARDAS, pelo mesmo motivo do guarda de 64 níveis do breadcrumb do Drive
 * (`getDriveListing`): o trigger `trg_knowledge_pages_no_cycle` impede ciclo no
 * banco, mas um laço aqui não faria uma lista errada — travaria a aba inteira,
 * porque isto roda durante a renderização.
 *   - `vistos`: um id que reaparece é ignorado. É a guarda EXATA (termina sempre,
 *     independentemente da forma dos dados) e custa um Set.
 *   - `PROFUNDIDADE_MAXIMA`: para de descer num nível absurdo. `montarArvore` já
 *     devolve uma floresta sem ciclos, então esta é a segunda linha de defesa
 *     para o caso de alguém passar uma árvore montada de outro jeito.
 */
export function achatarVisiveis(
  raizes: KnowledgePageNode[],
  expandidos: ReadonlySet<string>,
): LinhaVisivel[] {
  interface Pendente {
    no: KnowledgePageNode;
    nivel: number;
    posicao: number;
    total: number;
    maeId: string | null;
  }

  const linhas: LinhaVisivel[] = [];
  const vistos = new Set<string>();
  const pilha: Pendente[] = [];

  // Empilha ao contrário: a pilha devolve o último primeiro, e a ordem entre
  // irmãs (que veio do banco por `position`) precisa ser preservada na tela.
  const empilhar = (nos: KnowledgePageNode[], nivel: number, maeId: string | null) => {
    for (let i = nos.length - 1; i >= 0; i--) {
      pilha.push({ no: nos[i], nivel, posicao: i + 1, total: nos.length, maeId });
    }
  };

  empilhar(raizes, 1, null);

  while (pilha.length > 0) {
    const item = pilha.pop();
    if (!item) break;
    if (vistos.has(item.no.id)) continue;
    vistos.add(item.no.id);

    const temFilhas = item.no.children.length > 0;
    const expandida = temFilhas && expandidos.has(item.no.id);

    linhas.push({
      no: item.no,
      nivel: item.nivel,
      posicao: item.posicao,
      total: item.total,
      temFilhas,
      expandida,
      maeId: item.maeId,
    });

    if (expandida && item.nivel < PROFUNDIDADE_MAXIMA) {
      empilhar(item.no.children, item.nivel + 1, item.no.id);
    }
  }

  return linhas;
}

/**
 * Todos os descendentes de uma página, sem incluir ela mesma.
 *
 * Serve a dois pedidos da tela, e os dois importam:
 *   - o aviso da exclusão ("esta página e mais N subpáginas"), porque
 *     `deletePage` apaga a subárvore inteira e cascade silencioso é como se
 *     perde trabalho;
 *   - a lista de destinos ao MOVER, de onde a própria subárvore precisa sumir:
 *     o trigger anti-ciclo recusaria de qualquer forma, mas oferecer o destino
 *     para depois devolver erro é prometer o que não se cumpre.
 *
 * Índice de mãe→filhas primeiro, depois UMA descida. A alternativa ingênua —
 * varrer a lista procurando quem tem `parent_id` no conjunto, repetidamente até
 * parar de crescer — é O(n²) por nível.
 */
export function descendentesDe(
  paginas: KnowledgePageSummary[],
  pageId: string,
): Set<string> {
  const filhasPorMae = new Map<string, string[]>();
  for (const p of paginas) {
    if (!p.parent_id) continue;
    const irmas = filhasPorMae.get(p.parent_id);
    if (irmas) irmas.push(p.id);
    else filhasPorMae.set(p.parent_id, [p.id]);
  }

  const encontrados = new Set<string>();
  const pilha = [...(filhasPorMae.get(pageId) ?? [])];
  while (pilha.length > 0) {
    const id = pilha.pop();
    if (!id) break;
    // Um ciclo gravado (A mãe de B, B mãe de A) faria a pilha nunca esvaziar.
    // O `has` já é a condição de parada — não precisa de contador.
    if (id === pageId || encontrados.has(id)) continue;
    encontrados.add(id);
    for (const filha of filhasPorMae.get(id) ?? []) pilha.push(filha);
  }
  return encontrados;
}

/* --------------------------------------------- reconciliação com o servidor */

/**
 * Teto de nós comparados por `mesmoDocumento`.
 *
 * O documento já chega limitado a ~1 MB por `prosemirrorDocSchema`, então este
 * número nunca deveria ser alcançado. Ele existe para o caso em que alguma
 * escrita fora da aplicação tenha gravado algo maior: estourar o teto devolve
 * `false`, e `false` é o lado SEGURO — significa "não consegui provar que são
 * iguais", e quem chama trata isso como divergência (não adota nada).
 */
const LIMITE_DE_NOS_COMPARADOS = 200_000;

/**
 * Igualdade estrutural entre dois documentos do ProseMirror.
 *
 * POR QUE NÃO `JSON.stringify(a) === JSON.stringify(b)`: os dois lados desta
 * comparação vêm de serializadores DIFERENTES. Um é o `toJSON()` do ProseMirror
 * (ordem de inserção das chaves); o outro veio do `jsonb` do Postgres, que
 * REORDENA as chaves de todo objeto (por tamanho e depois por bytes) ao gravar.
 * Documentos idênticos sairiam com strings diferentes, a comparação diria
 * "mudou" e quem chama tomaria a decisão errada — em silêncio, que é o pior
 * modo.
 *
 * PILHA EXPLÍCITA e não recursão, pelo mesmo motivo de `profundidadeExcede` em
 * `validation.ts`: isto compara dado que veio do banco, e uma travessia
 * recursiva estouraria a pilha de chamadas justamente no documento patológico.
 */
export function mesmoDocumento(a: unknown, b: unknown): boolean {
  const pilha: { a: unknown; b: unknown }[] = [{ a, b }];
  let visitados = 0;

  while (pilha.length > 0) {
    if (++visitados > LIMITE_DE_NOS_COMPARADOS) return false;
    const par = pilha.pop();
    if (!par) break;

    const x = par.a;
    const y = par.b;
    // Cobre string, número, booleano, null e a identidade de objetos. Documento
    // vindo de JSON não tem NaN nem -0, então `===` basta para os escalares.
    if (x === y) continue;
    if (x === null || y === null || typeof x !== "object" || typeof y !== "object") return false;

    const xArray = Array.isArray(x);
    if (xArray !== Array.isArray(y)) return false;

    if (xArray) {
      const ax = x as unknown[];
      const ay = y as unknown[];
      if (ax.length !== ay.length) return false;
      for (let i = 0; i < ax.length; i++) pilha.push({ a: ax[i], b: ay[i] });
      continue;
    }

    const ox = x as Record<string, unknown>;
    const oy = y as Record<string, unknown>;
    const chaves = Object.keys(ox);
    // Contar as chaves dos dois lados é o que impede "b tem tudo que a tem, e
    // mais um campo" de passar como igual.
    if (chaves.length !== Object.keys(oy).length) return false;
    for (const chave of chaves) {
      if (!Object.prototype.hasOwnProperty.call(oy, chave)) return false;
      pilha.push({ a: ox[chave], b: oy[chave] });
    }
  }

  return true;
}

/** A foto da página que o servidor acabou de mandar (props do editor). */
export interface FotoDaPagina {
  /** `updated_at` da linha. */
  carimbo: string;
  titulo: string;
  conteudo: unknown;
}

/** O que o editor sabe neste instante. Ver `reconciliarPagina`. */
export interface EstadoDoEditor {
  /** Carimbo que a próxima gravação vai levar no WHERE. */
  carimbo: string;
  /** Título na tela (pode estar sendo digitado). */
  tituloAtual: string;
  /** Último título que o servidor confirmou ter gravado. */
  tituloSalvo: string;
  /** Conteúdo que o editor SABE estar gravado no servidor. */
  conteudoNoServidor: unknown;
}

/** O que adotar da foto nova. `null` em um campo = não mexer nele. */
export interface Reconciliacao {
  carimbo: string | null;
  titulo: string | null;
}

/**
 * DECIDE SE O EDITOR PODE ADOTAR O CARIMBO QUE O SERVIDOR ACABOU DE MANDAR.
 *
 * O problema que isto resolve: a BARRA LATERAL mexe na página aberta. Renomear
 * ou mover disparam o trigger `set_updated_at` (0001, incondicional) e em
 * seguida um `router.refresh()`. Como a página do editor é montada com
 * `key={pageId}` e o id não mudou, a instância NÃO remonta — ela continua com o
 * carimbo do primeiro carregamento. A gravação seguinte bate em zero linhas e
 * vira CONFLITO, dentro de uma aba só, com um usuário só, sem que ninguém tenha
 * editado nada em outro lugar. A saída oferecida ("Recarregar a página")
 * descarta o parágrafo recém-digitado.
 *
 * Adotar o carimbo novo em TODA mudança de prop seria a correção errada, e é o
 * que o comentário antigo do `atualizadoEm` proibia com razão: se o carimbo
 * subiu porque OUTRA aba gravou conteúdo, adotá-lo faz a gravação seguinte
 * passar e apagar aquele conteúdo. O conflito, ali, é o comportamento certo.
 *
 * O que separa os dois casos é o CONTEÚDO: comparar a foto nova com o conteúdo
 * que o editor sabe estar gravado responde exatamente "o servidor mudou o
 * documento ou só o rótulo?".
 *   - iguais  -> o carimbo subiu por título/posição/caderno. Adotar não perde
 *                nada, porque não há versão de conteúdo que o editor não tenha
 *                visto;
 *   - difere  -> alguém gravou CONTEÚDO em outro lugar. Nada é adotado, o
 *                carimbo velho continua valendo e o conflito acontece como deve.
 *
 * O carimbo só anda para FRENTE. Uma foto atrasada (renderização de servidor que
 * começou antes da última gravação) é ignorada em vez de fazer o editor voltar
 * no tempo e produzir o conflito falso que esta função existe para evitar.
 *
 * O TÍTULO é adotado junto, e sob condição própria: só quando não há edição
 * local pendente nele (`tituloAtual === tituloSalvo`). Sem isso, a tela mostra
 * dois títulos para a mesma página — o novo na barra lateral, o antigo no campo,
 * porque o estado do campo é inicializado uma vez e nunca reage à prop. Com
 * edição pendente, quem manda é quem está digitando.
 */
export function reconciliarPagina(
  local: EstadoDoEditor,
  servidor: FotoDaPagina,
): Reconciliacao {
  const nada: Reconciliacao = { carimbo: null, titulo: null };

  if (servidor.carimbo === local.carimbo) return nada;

  const agoraLocal = Date.parse(local.carimbo);
  const agoraServidor = Date.parse(servidor.carimbo);
  // Carimbo ilegível de qualquer um dos lados: não dá para saber quem é mais
  // novo, então não se mexe em nada.
  if (!Number.isFinite(agoraLocal) || !Number.isFinite(agoraServidor)) return nada;
  if (agoraServidor < agoraLocal) return nada;

  if (!mesmoDocumento(local.conteudoNoServidor, servidor.conteudo)) return nada;

  const titulo =
    local.tituloAtual === local.tituloSalvo && servidor.titulo !== local.tituloAtual
      ? servidor.titulo
      : null;

  return { carimbo: servidor.carimbo, titulo };
}

/* ------------------------------------------------------------------ texto */

/**
 * Minúsculas e SEM acento, para comparar o que o usuário digitou com o que está
 * na tela.
 *
 * `NFD` separa a letra do acento, e a faixa U+0300–U+036F (as marcas
 * combinantes) é removida em seguida — "Índice" e "indice" viram a mesma coisa.
 * A faixa vai escrita como escape `\u0300-\u036f` de propósito: colar os
 * caracteres combinantes crus no código-fonte produz um trecho que editor,
 * terminal e `git diff` desenham em cima da letra anterior, e a regex passa a
 * ser impossível de revisar.
 *
 * Isto é COMPARAÇÃO DE EXIBIÇÃO e nada mais: quem decide o que casa de verdade é
 * o `to_tsvector('portuguese', ...)` do banco, que tem regra própria (radicais,
 * palavras vazias) e não é replicável aqui.
 */
export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Pedaço de texto e se ele deve sair destacado. Ver `destacarOcorrencias`. */
export interface TrechoDestacado {
  texto: string;
  destaque: boolean;
}

/** Abaixo disto o destaque marca meia tela e deixa de informar qualquer coisa. */
const TAMANHO_MINIMO_DO_TERMO = 2;

/**
 * Parte um texto nos pedaços que casam com o termo buscado e nos que não casam.
 *
 * Devolve SEGMENTOS em vez de HTML com `<mark>`, e essa é a decisão que importa:
 * montar marcação aqui obrigaria a página a usar `dangerouslySetInnerHTML` para
 * exibi-la, e o título vem do banco — é texto que o usuário controla. Seria um
 * XSS armado por um recurso cosmético. Com segmentos, o React escapa cada pedaço
 * como sempre faz.
 *
 * O CASAMENTO É POR SUBSTRING, sem acento e sem caixa, e é deliberadamente mais
 * FROUXO que a busca do banco. Os dois nunca vão concordar: o Postgres compara
 * RADICAIS ("corrida" casa com "correndo") e ignora palavras vazias, coisas que
 * não dá para reproduzir em JavaScript sem embutir o dicionário do português.
 * Como consequência, um resultado legítimo pode aparecer sem nenhum destaque —
 * o texto sai inteiro, sem marca, que é o degradar correto. O contrário
 * (destacar o que não casou) é que seria mentira, e por isso a comparação é
 * literal em vez de heurística.
 *
 * Os operadores do `websearch_to_tsquery` são retirados do termo: aspas, a
 * palavra "or" e as palavras negadas com "-", que por definição NÃO estão no
 * resultado.
 */
export function destacarOcorrencias(texto: string, termo: string): TrechoDestacado[] {
  const inteiro: TrechoDestacado[] = [{ texto, destaque: false }];
  if (!texto || !termo) return inteiro;

  const palavras = semAcento(termo)
    .split(/\s+/)
    .map((p) => p.replace(/["']/g, ""))
    .filter((p) => p.length >= TAMANHO_MINIMO_DO_TERMO && !p.startsWith("-") && p !== "or");
  if (palavras.length === 0) return inteiro;

  /**
   * Versão sem acento do texto MAIS o mapa de volta para as posições originais.
   *
   * O mapa não é preciosismo: `"á".normalize("NFD")` tem DOIS caracteres e
   * `"á".normalize("NFD").replace(...)` tem UM, então normalizar a string
   * inteira de uma vez desloca todos os índices seguintes — o destaque sairia
   * deslocado uma casa por acento anterior a ele. Percorrendo por PONTO DE
   * CÓDIGO (`Array.from`, que não parte pares substitutos) e anotando de onde
   * veio cada caractere, o recorte volta para o texto original intacto.
   */
  const plano: string[] = [];
  const origem: number[] = [];
  let cursor = 0;
  for (const caractere of Array.from(texto)) {
    const convertido = semAcento(caractere);
    // O laço é por UNIDADE UTF-16, não por ponto de código, e a diferença não é
    // teórica: `indexOf` devolve índice em unidades UTF-16, então `origem`
    // precisa ter uma entrada por unidade para os dois falarem a mesma língua.
    // Percorrendo por ponto de código, um emoji (duas unidades, uma entrada)
    // desalinha tudo o que vem depois dele — o destaque sai uma letra adiante.
    for (let k = 0; k < convertido.length; k++) {
      plano.push(convertido[k]);
      origem.push(cursor);
    }
    cursor += caractere.length;
  }
  origem.push(texto.length); // sentinela: fim do último segmento
  const textoPlano = plano.join("");

  // Intervalos [inicio, fim) em coordenadas do texto ORIGINAL.
  const faixas: { inicio: number; fim: number }[] = [];
  for (const palavra of palavras) {
    let de = textoPlano.indexOf(palavra);
    while (de !== -1) {
      faixas.push({ inicio: origem[de], fim: origem[de + palavra.length] });
      de = textoPlano.indexOf(palavra, de + palavra.length);
    }
  }
  if (faixas.length === 0) return inteiro;

  // Ordena e funde o que se sobrepõe: duas palavras buscadas podem cair uma
  // dentro da outra ("caderno" e "cad") e sair como dois <mark> colados, com uma
  // borda visível no meio de uma palavra só.
  faixas.sort((a, b) => a.inicio - b.inicio || a.fim - b.fim);
  const fundidas: { inicio: number; fim: number }[] = [];
  for (const faixa of faixas) {
    const ultima = fundidas[fundidas.length - 1];
    if (ultima && faixa.inicio <= ultima.fim) ultima.fim = Math.max(ultima.fim, faixa.fim);
    else fundidas.push({ ...faixa });
  }

  const trechos: TrechoDestacado[] = [];
  let posicao = 0;
  for (const faixa of fundidas) {
    if (faixa.inicio > posicao) {
      trechos.push({ texto: texto.slice(posicao, faixa.inicio), destaque: false });
    }
    trechos.push({ texto: texto.slice(faixa.inicio, faixa.fim), destaque: true });
    posicao = faixa.fim;
  }
  if (posicao < texto.length) trechos.push({ texto: texto.slice(posicao), destaque: false });
  return trechos;
}
