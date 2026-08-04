import type {
  ComentarioClickUp,
  ComentarioCru,
  FaseClickUp,
  PrioridadeClickUp,
  ResponsavelClickUp,
  StatusCru,
  StatusPossivel,
  TarefaClickUp,
  TarefaCrua,
  UsuarioCru,
} from "@/lib/clickup/types";
import { semAcento } from "@/lib/knowledge";

/**
 * Resposta crua do ClickUp → modelo da interface.
 *
 * PURO, sem I/O, e por isso testável sem rede. Existe separado do `client.ts`
 * porque as duas coisas erram de jeitos diferentes: o cliente erra em quem
 * chama e com quê; o mapper erra em interpretar o que voltou. Misturar os dois
 * faria todo teste de conversão precisar de um `fetch` falso.
 *
 * ============================================================================
 * A ARMADILHA DAS DATAS
 * ============================================================================
 * O ClickUp manda data como STRING DE MILISSEGUNDOS: `"1754092800000"`. Não é
 * ISO, não é número, e `new Date("1754092800000")` devolve **Invalid Date** —
 * o construtor trata string como formato de data, não como epoch.
 *
 * O caminho certo é `Number(...)` antes. E o `Number.isFinite` não é
 * paranoia: `Number("")` é 0 (vira 1970) e `Number("abc")` é NaN (vira
 * RangeError no `toISOString`). Os dois casos aparecem — tarefa sem prazo às
 * vezes vem com string vazia em vez de null.
 */
export function msParaIso(valor: string | number | null | undefined): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const ms = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const data = new Date(ms);
  // Fora do intervalo representável, `toISOString` lança. Melhor devolver null
  // do que derrubar a listagem inteira por causa de uma data absurda.
  const tempo = data.getTime();
  if (!Number.isFinite(tempo)) return null;
  return data.toISOString();
}

/**
 * Prioridade: o ClickUp usa 1..4 (1 = urgente) e também manda o rótulo em
 * inglês. Lemos o RÓTULO, porque o número já mudou de significado entre
 * versões da API e o rótulo não.
 */
export function traduzirPrioridade(
  bruta: TarefaCrua["priority"],
): PrioridadeClickUp {
  const rotulo = bruta?.priority?.toLowerCase() ?? null;
  switch (rotulo) {
    case "urgent":
      return "urgente";
    case "high":
      return "alta";
    case "normal":
      return "normal";
    case "low":
      return "baixa";
    default:
      return null;
  }
}

/** `closed` e `done` significam a mesma coisa aqui — ver `faseDoStatus`. */
function ehTipoFinal(tipo: string | null | undefined): boolean {
  const t = tipo?.toLowerCase();
  return t === "closed" || t === "done";
}

/**
 * `status.type` → fase. O CAMINHO DE RESERVA, quando a lista de origem não pôde
 * ser resolvida. A classificação boa é `faseNaLista`, logo abaixo.
 *
 * ⚠️ O `default` já foi "andamento", e essa era a causa raiz de um bug real: o
 * ClickUp marca como `open` APENAS O PRIMEIRO status de cada lista, e chama de
 * `custom` todos os intermediários. Numa lista
 * `backlog(open) → a fazer(custom) → fazendo(custom) → concluído(closed)`, o
 * "a fazer" é `custom` e caía em "Em andamento" — a coluna errada, para toda
 * tarefa que não estivesse no primeiro status.
 *
 * Agora o padrão é "a fazer", e o motivo é qual afirmação erra menos: com
 * `include_closed=false` a tarefa comprovadamente NÃO está concluída, e "está
 * na fila" é a afirmação menos comprometedora que sobra. Dizer "em andamento"
 * sobre algo que ninguém começou é pior — inventa trabalho.
 *
 * `done` está aqui por precaução, não por observação: a documentação usa
 * `closed` e alguns workspaces relatam `done`. Tratar os dois como concluído
 * erra para o lado seguro.
 */
export function faseDoStatus(tipo: string | null | undefined): FaseClickUp {
  if (ehTipoFinal(tipo)) return "concluido";
  return "afazer";
}

/**
 * ============================================================================
 * VOCABULÁRIO DE FILA — e por que a comparação é por IGUALDADE
 * ============================================================================
 * Estes nomes marcam status que ainda são "não comecei". Servem para achar até
 * onde vai a fila quando a lista tem mais de um status inicial.
 *
 * ⚠️ IGUALDADE NORMALIZADA, NUNCA `includes`. Com substring, "pendente de
 * deploy" — que é trabalho em andamento esperando alguém — voltaria para a
 * fila, e "backlog técnico" também. O erro seria justamente na direção que
 * este conserto veio corrigir.
 *
 * Acrescentar um nome aqui é uma AFIRMAÇÃO sobre o seu workspace, não um ajuste
 * estético. Cada entrada diz "um status com este nome exato nunca é trabalho em
 * curso".
 */
const VOCABULARIO_DE_FILA = new Set([
  "a fazer",
  "afazer",
  "to do",
  "todo",
  "backlog",
  "pendente",
  "pendentes",
  "aberto",
  "aberta",
  "aguardando",
  "open",
  "nao iniciado",
  "nao iniciada",
]);

/** A base da classificação, para a tela poder mostrá-la. */
export interface ClassificacaoDeFase {
  fase: FaseClickUp;
  /** 1-based dentro dos status da lista. */
  posicao: number;
  total: number;
}

/**
 * ============================================================================
 * A FASE PELA POSIÇÃO DO STATUS DENTRO DA LISTA DELE
 * ============================================================================
 * `status.type` sozinho não classifica porque o ClickUp só marca UM status como
 * `open` por lista. O que resta de confiável é a ORDEM: os status de uma lista
 * vêm ordenados por `orderindex`, do começo do fluxo para o fim.
 *
 * A regra, nesta ordem:
 *
 *   1. tipo final (`closed`/`done`) → concluído. Direto, sem heurística;
 *   2. o PRIMEIRO status é sempre "a fazer" — é o `open` do ClickUp;
 *   3. a fila pode ir além do primeiro: caminha-se para frente enquanto o nome
 *      bater EXATAMENTE com o vocabulário de fila. O último que bate é a
 *      fronteira;
 *   4. tudo depois da fronteira é "em andamento".
 *
 * O passo 3 é a única parte heurística, e é contígua de propósito: um "a fazer"
 * perdido no meio de status de execução não puxa a fronteira até lá.
 *
 * ⚠️ DEVOLVE `null` QUANDO NÃO SABE — status não encontrado na lista, ou lista
 * vazia. Quem chama cai em `faseDoStatus`. Um palpite silencioso aqui seria
 * indistinguível de uma classificação apurada, e a tela não teria como avisar.
 *
 * ⚠️ E NÃO FOI VERIFICADA CONTRA A API REAL. A afirmação "só o primeiro status
 * vem como `open`" é consistente com o bug observado e com os comentários do
 * módulo, mas ninguém colou aqui o JSON de um `GET /list/{id}` de verdade. Ver
 * o roteiro em docs/clickup.md — é o passo que falta.
 */
export function faseNaLista(
  statusDaTarefa: string | null,
  statusesDaLista: StatusPossivel[] | undefined,
): ClassificacaoDeFase | null {
  if (!statusDaTarefa || !statusesDaLista || statusesDaLista.length === 0) return null;

  const alvo = normalizar(statusDaTarefa);
  const indice = statusesDaLista.findIndex((s) => normalizar(s.status) === alvo);
  if (indice < 0) return null;

  const total = statusesDaLista.length;
  const posicao = indice + 1;

  if (ehTipoFinal(statusesDaLista[indice]?.type)) {
    return { fase: "concluido", posicao, total };
  }

  // Onde a fila termina. Começa em 0 porque o primeiro status é sempre fila.
  let fronteira = 0;
  for (let i = 1; i < total; i++) {
    const s = statusesDaLista[i];
    if (!s || ehTipoFinal(s.type)) break;
    if (!VOCABULARIO_DE_FILA.has(normalizar(s.status))) break;
    fronteira = i;
  }

  return { fase: indice <= fronteira ? "afazer" : "andamento", posicao, total };
}

/**
 * Minúsculas, sem acento, sem espaço nas pontas.
 *
 * `semAcento` vem do módulo Conhecimento porque é lá que essa função pura mora
 * desde que a busca precisou dela — o mesmo caminho que `TasksView` já usa. Uma
 * segunda implementação de "normalizar texto" é como duas telas passam a achar
 * coisas diferentes com o mesmo termo.
 */
function normalizar(texto: string): string {
  return semAcento(texto.trim());
}

/**
 * Aplica a classificação por lista a uma tarefa já mapeada.
 *
 * Segundo passo, e não parâmetro de `mapearTarefa`, por uma razão de ordem: os
 * status da lista só podem ser buscados DEPOIS de saber quais listas apareceram
 * no lote, e isso só se sabe depois de ter as tarefas. Enfiar isso no mapper
 * obrigaria a mapear duas vezes ou a passar um mapa que ainda não existe.
 */
export function classificarPelaLista(
  tarefa: TarefaClickUp,
  statusesDaLista: StatusPossivel[] | undefined,
): TarefaClickUp {
  const c = faseNaLista(tarefa.status, statusesDaLista);
  if (!c) return tarefa;
  return { ...tarefa, fase: c.fase, statusPosicao: c.posicao, statusTotal: c.total };
}

/**
 * `assignees` → responsáveis, com "você" marcado.
 *
 * O id do ClickUp chega ora como número, ora como string, dependendo da rota —
 * daí o `String()` dos dois lados da comparação. É o mesmo cuidado que
 * `guard.ts` toma para a invariante I3, e pelo mesmo motivo: `1 === "1"` é
 * falso, e aqui o preço seria só um destaque errado, mas lá seria recusar a
 * própria tarefa.
 *
 * `meuId` é OPCIONAL para o mapper continuar puro e testável sem credencial.
 * Sem ele ninguém é "você" — o que é honesto: não há como saber.
 */
export function mapearResponsaveis(
  brutos: UsuarioCru[] | null | undefined,
  meuId?: string | number | null,
): ResponsavelClickUp[] {
  if (!Array.isArray(brutos)) return [];
  const meu = meuId == null ? null : String(meuId);
  return brutos.map((u) => ({
    id: String(u.id),
    // Sem username, o id é o que sobra — melhor que "(sem nome)" repetido em
    // toda linha, porque pelo menos distingue duas pessoas.
    nome: u.username?.trim() || `#${String(u.id)}`,
    souEu: meu !== null && String(u.id) === meu,
  }));
}

export function mapearTarefa(crua: TarefaCrua, meuId?: string | number | null): TarefaClickUp {
  return {
    id: crua.id,
    nome: crua.name ?? "(sem nome)",
    // `description` é markdown; `text_content` é o mesmo em texto puro. A tela
    // mostra texto, então preferimos o segundo e caímos no primeiro.
    descricao: crua.text_content ?? crua.description ?? null,
    status: crua.status?.status ?? null,
    statusCor: crua.status?.color ?? null,
    // Fase de RESERVA. `listarTarefasClickUp` reclassifica com os status da
    // lista de origem logo depois — ver `classificarPelaLista`.
    fase: faseDoStatus(crua.status?.type),
    statusOrdem: typeof crua.status?.orderindex === "number" ? crua.status.orderindex : null,
    statusPosicao: null,
    statusTotal: null,
    prazo: msParaIso(crua.due_date),
    prioridade: traduzirPrioridade(crua.priority),
    listaId: crua.list?.id ?? null,
    listaNome: crua.list?.name ?? null,
    url: crua.url ?? null,
    responsaveis: mapearResponsaveis(crua.assignees, meuId),
    paiId: crua.parent ? String(crua.parent) : null,
  };
}

export function mapearComentario(cru: ComentarioCru): ComentarioClickUp {
  return {
    id: cru.id,
    texto: cru.comment_text ?? "",
    autor: cru.user?.username ?? null,
    quando: msParaIso(cru.date),
  };
}

export function mapearStatus(cru: StatusCru, indice: number): StatusPossivel {
  return {
    status: cru.status,
    cor: cru.color ?? null,
    ordem: typeof cru.orderindex === "number" ? cru.orderindex : indice,
    // Deixou de ser descartado: `faseNaLista` precisa saber qual status é o
    // final da lista, e o `<select>` do detalhe ganha de brinde a informação de
    // que aquele status conclui a tarefa.
    type: cru.type ?? null,
  };
}

/**
 * Ordenação padrão da aba: VENCIDOS PRIMEIRO, depois por prazo, e o que não tem
 * prazo por último.
 *
 * "Sem prazo por último" é a decisão que importa. O comparador ingênuo trataria
 * `null` como menor que tudo e jogaria as tarefas sem data para o topo — que é
 * exatamente onde elas não ajudam. Quem abre a aba quer ver o que está
 * atrasado.
 */
export function porPrazo(a: TarefaClickUp, b: TarefaClickUp): number {
  if (a.prazo === b.prazo) return 0;
  if (a.prazo === null) return 1;
  if (b.prazo === null) return -1;
  return a.prazo < b.prazo ? -1 : 1;
}

/** Uma linha da lista já aninhada. Ver `aninharTarefas`. */
export interface LinhaClickUp {
  tarefa: TarefaClickUp;
  /** 0 = topo da lista exibida. Vira recuo na tela. */
  nivel: number;
  /** É subtarefa, mas o pai não veio no lote. */
  orfa: boolean;
}

/** Proteção contra recursão: 5 níveis é muito mais do que qualquer uso real. */
const PROFUNDIDADE_MAXIMA = 5;

/**
 * Aninha as subtarefas sob as suas mães, achatando numa lista com `nivel`.
 *
 * ============================================================================
 * ⚠️ A ÓRFÃ É O CASO NORMAL AQUI, NÃO A EXCEÇÃO
 * ============================================================================
 * A API aplica o filtro `assignees[]` TAMBÉM às subtasks. Então o lote traz as
 * subtarefas em que você é responsável — e a mãe delas, se for de um colega,
 * simplesmente não vem. Uma subtarefa cujo `paiId` aponta para fora do lote não
 * é dado corrompido: é o resultado esperado de "só as minhas".
 *
 * Órfã sobe para o topo (senão sumiria da tela) mas continua MARCADA como
 * subtarefa. Esconder que ela faz parte de algo maior seria perder a única
 * informação que a distingue.
 *
 * O mesmo vale ao filtrar: filtrar por "Vencidas" pode tirar a mãe e deixar a
 * filha. A filha vira órfã pela mesma regra, sem caso especial.
 *
 * ============================================================================
 * NADA PODE SUMIR
 * ============================================================================
 * A varredura final devolve ao topo qualquer tarefa que a travessia não tenha
 * alcançado — o que só acontece com um ciclo no `parent`. É a diferença entre
 * "o quadro está estranho" e "a tarefa desapareceu do aplicativo".
 */
export function aninharTarefas(tarefas: TarefaClickUp[]): LinhaClickUp[] {
  const porId = new Map(tarefas.map((t) => [t.id, t]));
  const filhas = new Map<string, TarefaClickUp[]>();

  for (const t of tarefas) {
    // Só conta como filha se a MÃE ESTIVER NO LOTE. É o que separa aninhar de
    // esconder.
    if (t.paiId !== null && porId.has(t.paiId)) {
      const lista = filhas.get(t.paiId);
      if (lista) lista.push(t);
      else filhas.set(t.paiId, [t]);
    }
  }

  const linhas: LinhaClickUp[] = [];
  const visitadas = new Set<string>();

  function descer(tarefa: TarefaClickUp, nivel: number, orfa: boolean) {
    if (visitadas.has(tarefa.id)) return;
    visitadas.add(tarefa.id);
    linhas.push({ tarefa, nivel, orfa });
    if (nivel + 1 >= PROFUNDIDADE_MAXIMA) return;
    for (const filha of filhas.get(tarefa.id) ?? []) descer(filha, nivel + 1, false);
  }

  // A ordem de entrada é preservada no topo: quem chama já ordenou por prazo.
  for (const t of tarefas) {
    const temMaeNoLote = t.paiId !== null && porId.has(t.paiId);
    if (temMaeNoLote) continue;
    descer(t, 0, t.paiId !== null);
  }

  for (const t of tarefas) {
    if (!visitadas.has(t.id)) linhas.push({ tarefa: t, nivel: 0, orfa: t.paiId !== null });
  }

  return linhas;
}

/** As três fases, na ordem do fluxo. É a ordem das colunas do quadro. */
export const FASES: FaseClickUp[] = ["afazer", "andamento", "concluido"];

/**
 * Agrupa para o quadro. Ver `ClickUpQuadro.tsx` para o porquê da fase.
 *
 * Devolve as TRÊS chaves sempre, mesmo vazias: a coluna que some quando fica
 * sem cartão faz o quadro mudar de largura conforme o trabalho anda, e o
 * "Concluído" vazio precisa aparecer para poder explicar por que está vazio.
 *
 * Dentro da coluna, o mesmo critério da lista (`porPrazo`).
 * `status.orderindex` NÃO serve: ele ordena os status DENTRO de uma lista, e
 * estas tarefas vêm de listas diferentes — o índice 1 de uma nada tem a ver com
 * o 1 da outra.
 */
export function agruparPorFase(
  tarefas: TarefaClickUp[],
): Map<FaseClickUp, TarefaClickUp[]> {
  const mapa = new Map<FaseClickUp, TarefaClickUp[]>();
  for (const fase of FASES) mapa.set(fase, []);
  for (const t of tarefas) mapa.get(t.fase)?.push(t);
  for (const lista of mapa.values()) lista.sort(porPrazo);
  return mapa;
}
