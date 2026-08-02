/**
 * Peças PURAS dos vínculos entre tarefa, captura e evento (migration 0009):
 * os tipos que atravessam a fronteira servidor -> cliente e a regra que traduz
 * um par de entidades nos argumentos da action.
 *
 * Mora aqui, e não em `data.ts`, porque `data.ts` começa com `import
 * "server-only"`: um componente de cliente que importasse os tipos de lá
 * funcionaria hoje (o `import type` some na compilação) e explodiria no dia em
 * que alguém apagasse a palavra `type` num refactor, com uma mensagem de build
 * que não explica nada. E não mora em `validation.ts` porque aquele arquivo
 * carrega o zod — desnecessário no pacote do navegador só para ter três strings.
 */
import type { LinkKind } from "@/lib/validation";

/**
 * As três coisas que podem ser vinculadas. Note que "event" aqui é sempre uma
 * linha de `calendar_events` (o evento local, não o do Google): o vínculo aponta
 * para o uuid local, que sobrevive ao cancelamento no Google graças ao soft
 * delete da 0009.
 */
export type RelatedKind = "task" | "capture" | "event";

export const RELATED_KIND_LABEL: Record<RelatedKind, string> = {
  task: "Tarefa",
  capture: "Captura",
  event: "Evento",
};

/**
 * Um item do outro lado do vínculo, com o texto JÁ PRONTO.
 *
 * `label` e `hint` são formatados no servidor de propósito. A alternativa —
 * mandar a linha crua e formatar no componente — arrastaria para o navegador o
 * `content` inteiro de cada captura (o schema permite 10.000 caracteres) e o
 * payload de cada evento, para exibir 70 caracteres.
 */
export interface RelatedItem {
  id: string;
  kind: RelatedKind;
  /** Texto principal do item. */
  label: string;
  /** Linha secundária (status, tipo, data). Nulo quando não há nada útil. */
  hint: string | null;
}

/** A entidade que está aberta na tela. */
export interface RelatedEntity {
  kind: RelatedKind;
  id: string;
}

export interface LinkCall {
  tipo: LinkKind;
  aId: string;
  bId: string;
}

/**
 * Traduz (entidade da tela, item do outro lado) nos três argumentos de
 * `createLink`/`removeLink`.
 *
 * A ORDEM DAS PONTAS NÃO É SIMÉTRICA e é aqui que ela é decidida, uma vez só. Em
 * 'task-capture' o `aId` é SEMPRE a tarefa e o `bId` SEMPRE a captura, porque a
 * action grava `aId` na coluna `task_id`. Inverter não dá erro de compilação
 * (são dois uuids) e nem aparece como bug de programação na tela: o banco recusa
 * com foreign_key_violation e a action, de propósito, devolve isso como "Item
 * não encontrado." — a mesma mensagem de um item de outro usuário, para não
 * virar oráculo de existência. Ou seja, trocar a ordem se manifestaria como um
 * vínculo que "simplesmente não salva". Por isso as combinações estão escritas,
 * e não deduzidas da ordem em que os argumentos chegaram.
 *
 * Devolve `null` quando os dois lados são do mesmo tipo: não existe tabela para
 * tarefa-tarefa, e escolher uma ordem qualquer aqui esconderia o engano de quem
 * montou a lista de candidatos.
 */
export function pairForLink(atual: RelatedEntity, outro: RelatedEntity): LinkCall | null {
  if (atual.kind === outro.kind) return null;

  const tarefa = atual.kind === "task" ? atual.id : outro.kind === "task" ? outro.id : null;
  const captura = atual.kind === "capture" ? atual.id : outro.kind === "capture" ? outro.id : null;
  const evento = atual.kind === "event" ? atual.id : outro.kind === "event" ? outro.id : null;

  if (tarefa && captura) return { tipo: "task-capture", aId: tarefa, bId: captura };
  if (tarefa && evento) return { tipo: "task-event", aId: tarefa, bId: evento };
  if (captura && evento) return { tipo: "capture-event", aId: captura, bId: evento };
  return null;
}
