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

/**
 * `status.type` → fase.
 *
 * O `default` cobrindo "andamento" não é descuido: é a leitura certa do
 * conjunto. `open` é sempre o primeiro status da lista e `closed`/`done` são os
 * finais; TUDO o que fica no meio o ClickUp chama de `custom`, e é justamente
 * "em andamento". Um tipo novo que aparecesse amanhã também estaria no meio.
 *
 * ⚠️ `done` está aqui por precaução, não por observação. A integração nunca
 * falou com a API real; a documentação usa `closed`, e alguns workspaces
 * relatam `done`. Tratar os dois como concluído erra para o lado seguro — o
 * contrário jogaria tarefa concluída na coluna "em andamento".
 */
export function faseDoStatus(tipo: string | null | undefined): FaseClickUp {
  switch (tipo?.toLowerCase()) {
    case "open":
      return "afazer";
    case "closed":
    case "done":
      return "concluido";
    default:
      return "andamento";
  }
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
    fase: faseDoStatus(crua.status?.type),
    statusOrdem: typeof crua.status?.orderindex === "number" ? crua.status.orderindex : null,
    prazo: msParaIso(crua.due_date),
    prioridade: traduzirPrioridade(crua.priority),
    listaId: crua.list?.id ?? null,
    listaNome: crua.list?.name ?? null,
    url: crua.url ?? null,
    responsaveis: mapearResponsaveis(crua.assignees, meuId),
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
