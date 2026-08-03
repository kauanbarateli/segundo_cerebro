import type {
  ComentarioClickUp,
  ComentarioCru,
  PrioridadeClickUp,
  StatusCru,
  StatusPossivel,
  TarefaClickUp,
  TarefaCrua,
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

export function mapearTarefa(crua: TarefaCrua): TarefaClickUp {
  return {
    id: crua.id,
    nome: crua.name ?? "(sem nome)",
    // `description` é markdown; `text_content` é o mesmo em texto puro. A tela
    // mostra texto, então preferimos o segundo e caímos no primeiro.
    descricao: crua.text_content ?? crua.description ?? null,
    status: crua.status?.status ?? null,
    statusCor: crua.status?.color ?? null,
    prazo: msParaIso(crua.due_date),
    prioridade: traduzirPrioridade(crua.priority),
    listaId: crua.list?.id ?? null,
    listaNome: crua.list?.name ?? null,
    url: crua.url ?? null,
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
