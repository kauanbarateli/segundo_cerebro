/**
 * Tipos da API do ClickUp — REDUZIDOS ao que a tela usa.
 *
 * A resposta real de `/task` tem dezenas de campos (custom fields, watchers,
 * checklists, dependências, tempo apontado…). Declarar todos seria transcrever
 * a documentação deles para cá e assumir a manutenção disso; declarar só o que
 * é lido deixa explícito o quanto desta integração é superfície de verdade.
 *
 * Campos marcados opcionais são os que a API omite em algumas rotas — a
 * listagem por `team` devolve menos que `GET /task/{id}`.
 */

export interface UsuarioCru {
  id: number | string;
  username?: string | null;
  email?: string | null;
}

export interface StatusCru {
  status: string;
  color?: string | null;
  orderindex?: number | null;
  type?: string | null;
}

export interface TarefaCrua {
  id: string;
  name: string;
  /** Só vem em `GET /task/{id}`; a listagem não traz. */
  description?: string | null;
  text_content?: string | null;
  status?: StatusCru | null;
  /** Datas do ClickUp são STRING DE MILISSEGUNDOS: "1754092800000". */
  due_date?: string | null;
  start_date?: string | null;
  date_created?: string | null;
  date_updated?: string | null;
  /** `null` = sem prioridade. `priority.priority` é "urgent"|"high"|… */
  priority?: { priority?: string | null; color?: string | null } | null;
  assignees?: UsuarioCru[] | null;
  list?: { id: string; name?: string | null } | null;
  folder?: { id: string; name?: string | null } | null;
  space?: { id: string } | null;
  url?: string | null;
  archived?: boolean | null;
  /**
   * Id da tarefa PAI, ou `null` na tarefa de topo.
   *
   * `subtasks=true` já era mandado na listagem, mas sem este campo as subtasks
   * chegavam ACHATADAS — indistinguíveis das tarefas de topo, e sem nada por
   * onde aninhar.
   *
   * ⚠️ Só voltam as subtasks em que VOCÊ é responsável: a API aplica o
   * `assignees[]` também a elas. Então o pai de uma subtarefa sua pode não estar
   * no lote (é de um colega), e o contrário também — daí o tratamento de órfã em
   * `aninharTarefas`.
   *
   * `top_level_parent` NÃO é declarado, apesar de a API mandá-lo. Ele daria o id
   * da raiz, e id sem nome não desenha nada; declarar campo que ninguém lê
   * contraria o critério do topo deste arquivo.
   */
  parent?: string | null;
}

export interface ComentarioCru {
  id: string;
  /** Texto puro. O ClickUp também manda `comment` (rich), que não usamos. */
  comment_text?: string | null;
  user?: UsuarioCru | null;
  date?: string | null;
}

/* --------------------------------------------------- modelo da interface --- */

export type PrioridadeClickUp = "urgente" | "alta" | "normal" | "baixa" | null;

/**
 * FASE da tarefa — o único agrupamento estável entre listas diferentes.
 *
 * As tarefas vêm de VÁRIAS listas e cada Space do ClickUp define a própria
 * paleta de status: "in progress" da lista A e "em andamento" da lista B são
 * strings distintas para a mesma ideia, e "revisão" existe só numa delas. Não
 * há coluna canônica no status literal.
 *
 * `status.type` é o que existe de canônico: conjunto fechado, idêntico em todo
 * workspace, e é FASE (onde a tarefa está no fluxo) e não procedência (de qual
 * lista ela veio). É por isso que o quadro agrupa por aqui e o cartão continua
 * mostrando o status literal com a cor do Space — nada se perde e nenhuma
 * equivalência falsa é afirmada.
 */
export type FaseClickUp = "afazer" | "andamento" | "concluido";

/**
 * Quem mais está na tarefa.
 *
 * ⚠️ SEM `email`, de propósito. Este projeto tem postura declarada de não trazer
 * dado pessoal de terceiros para dentro de um banco que ninguém mais audita, e
 * o e-mail de um colega não responde nenhuma pergunta que a tela faça. Nome
 * responde "quem está comigo nisto"; e-mail só serviria para contatar fora
 * daqui, o que não é função deste aplicativo.
 *
 * NADA AQUI É PERSISTIDO. Os nomes trafegam no payload da Server Action, são
 * desenhados e morrem quando a aba fecha — mesmo tratamento dado aos
 * comentários.
 */
export interface ResponsavelClickUp {
  id: string;
  nome: string;
  /** Quem conectou o token. A tela escreve "você" em vez do nome. */
  souEu: boolean;
}

/**
 * O que atravessa a fronteira servidor→cliente.
 *
 * Deliberadamente diferente de `TarefaCrua`: datas já convertidas, prioridade
 * já traduzida, e NENHUM campo que a tela não desenhe. Cada campo a mais aqui
 * viaja no payload de toda resposta de Server Action.
 */
export interface TarefaClickUp {
  id: string;
  nome: string;
  descricao: string | null;
  status: string | null;
  statusCor: string | null;
  /**
   * A fase derivada de `status.type`. Ver `FaseClickUp`.
   *
   * Chega DE GRAÇA: `status.type` já vem na listagem que a aba faz, e estava
   * sendo descartado no mapper. É o que torna o quadro possível sem nenhuma
   * chamada de rede a mais e sem nenhuma operação nova em `capabilities.ts`.
   */
  fase: FaseClickUp;
  /** `status.orderindex` — a ordem do status DENTRO da lista de origem. */
  statusOrdem: number | null;
  /** ISO 8601, ou null. A conversão de milissegundos mora em `mapper.ts`. */
  prazo: string | null;
  prioridade: PrioridadeClickUp;
  listaId: string | null;
  listaNome: string | null;
  url: string | null;
  responsaveis: ResponsavelClickUp[];
  /** Id da tarefa pai, quando esta é uma subtarefa. Ver `TarefaCrua.parent`. */
  paiId: string | null;
}

export interface ComentarioClickUp {
  id: string;
  texto: string;
  autor: string | null;
  quando: string | null;
}

export interface StatusPossivel {
  status: string;
  cor: string | null;
  ordem: number;
}

/** Perfil devolvido por `identificar` + o workspace escolhido. */
export interface PerfilClickUp {
  clickupUserId: string;
  username: string | null;
  email: string | null;
  workspaceId: string;
  workspaceName: string | null;
  /** Quantos workspaces existem — a tela avisa quando há mais de um. */
  totalDeWorkspaces: number;
}
