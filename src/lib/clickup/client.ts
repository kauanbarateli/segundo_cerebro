import "server-only";

import { chamar } from "@/lib/clickup/capabilities";
import { ErroClickUp } from "@/lib/clickup/erros";
import { mapearStatus } from "@/lib/clickup/mapper";
import type {
  ComentarioCru,
  PerfilClickUp,
  StatusCru,
  StatusPossivel,
  TarefaCrua,
  UsuarioCru,
} from "@/lib/clickup/types";

/**
 * As oito funções — uma por operação.
 *
 * ============================================================================
 * ⚠️ A REGRA QUE VALE PARA TODAS: O CORPO É CONSTRUÍDO, NUNCA REPASSADO
 * ============================================================================
 * Nenhuma função aqui recebe um objeto e o encaminha. Cada uma recebe valores
 * escalares e MONTA o corpo, literal, no ponto de chamada.
 *
 * A diferença não é estilística. Comparando:
 *
 *     // ERRADO — filtrar. Campo novo do ClickUp passa até alguém lembrar de
 *     // bloquear, e "lembrar" não é um mecanismo.
 *     async function alterar(id, campos) {
 *       return chamar("mudarStatus", token, { taskId: id }, { corpo: pick(campos, ["status"]) });
 *     }
 *
 *     // CERTO — construir. O corpo tem exatamente uma chave porque foi escrito
 *     // assim. Não existe parâmetro por onde entrar outra coisa.
 *     async function mudarStatus(token, taskId, status: string) {
 *       return chamar("mudarStatus", token, { taskId }, { corpo: { status } });
 *     }
 *
 * No segundo, `archived: true` não tem por onde chegar: `status` é uma string,
 * e strings não carregam chaves extras. A limitação é estrutural, não uma lista
 * de bloqueio a manter.
 */

/** Teto rígido de páginas. Ver `listarMinhasTarefas`. */
const MAX_PAGINAS = 5;
const POR_PAGINA = 100;

/* ----------------------------------------------------------------- leitura */

/** 1. Quem sou eu. */
export async function identificar(
  token: string,
): Promise<{ id: string; username: string | null; email: string | null }> {
  const r = await chamar<{ user: UsuarioCru }>("identificar", token, {});
  const u = r?.user;
  if (!u?.id) throw new ErroClickUp("falhou", "O ClickUp não devolveu o usuário.");
  return {
    id: String(u.id),
    username: u.username ?? null,
    email: u.email ?? null,
  };
}

/** 2. Meus workspaces (a API chama de "team"). */
export async function listarWorkspaces(
  token: string,
): Promise<{ id: string; name: string | null }[]> {
  const r = await chamar<{ teams?: { id: string; name?: string | null }[] }>(
    "workspaces",
    token,
    {},
  );
  return (r?.teams ?? []).map((t) => ({ id: String(t.id), name: t.name ?? null }));
}

/**
 * 3. Tarefas ONDE SOU RESPONSÁVEL.
 *
 * `assignees[]` NÃO é parâmetro opcional, e essa é a decisão de projeto mais
 * importante desta função: sem o filtro, `GET /team/{id}/task` devolve o
 * workspace INTEIRO — todas as tarefas de todos os colegas. A assinatura exige
 * `meuId` para que "minhas tarefas" seja garantia, não intenção.
 *
 * TETO DE PÁGINAS: 5 × 100 = 500 tarefas. Um workspace grande com o filtro mal
 * aplicado (ou um dia em que a API ignore o filtro) viraria um laço consumindo
 * a cota de requisições da conta. O teto transforma o pior caso em "a tela diz
 * que há mais" em vez de "a integração parou de funcionar por excesso de uso".
 */
export async function listarMinhasTarefas(
  token: string,
  entrada: { teamId: string; meuId: string; spaceIds?: string[] },
): Promise<{ tarefas: TarefaCrua[]; truncado: boolean }> {
  const tarefas: TarefaCrua[] = [];
  let truncado = false;

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const query: Record<string, string | string[]> = {
      page: String(pagina),
      "assignees[]": [entrada.meuId],
      include_closed: "false",
      subtasks: "true",
      order_by: "due_date",
    };
    if (entrada.spaceIds && entrada.spaceIds.length > 0) {
      query["space_ids[]"] = entrada.spaceIds;
    }

    const r = await chamar<{ tasks?: TarefaCrua[]; last_page?: boolean }>(
      "minhasTarefas",
      token,
      { teamId: entrada.teamId },
      { query },
    );

    const lote = r?.tasks ?? [];
    tarefas.push(...lote);

    // `last_page` é o sinal oficial; o tamanho do lote é a rede de segurança
    // para o caso de a API não mandá-lo.
    if (r?.last_page === true || lote.length < POR_PAGINA) return { tarefas, truncado: false };

    if (pagina === MAX_PAGINAS - 1) truncado = true;
  }

  return { tarefas, truncado };
}

/** 4. Uma tarefa. */
export async function obterTarefa(token: string, taskId: string): Promise<TarefaCrua> {
  const r = await chamar<TarefaCrua>("umaTarefa", token, { taskId });
  if (!r?.id) throw new ErroClickUp("nao_encontrado", "Tarefa não encontrada.");
  return r;
}

/**
 * 5. Status válidos da lista.
 *
 * Cada Space do ClickUp define os seus, então não existe dropdown fixo: o
 * seletor de status precisa ser populado pela lista DAQUELA tarefa.
 */
export async function statusDaLista(token: string, listId: string): Promise<StatusPossivel[]> {
  const r = await chamar<{ statuses?: StatusCru[] }>("statusDaLista", token, { listId });
  return (r?.statuses ?? [])
    .map(mapearStatus)
    .sort((a, b) => a.ordem - b.ordem);
}

/** 6. Comentários. */
export async function lerComentarios(token: string, taskId: string): Promise<ComentarioCru[]> {
  const r = await chamar<{ comments?: ComentarioCru[] }>("lerComentarios", token, { taskId });
  return r?.comments ?? [];
}

/* ------------------------------------------------------------------ escrita */

/**
 * 7. Mudar o status — e SÓ o status.
 *
 * O corpo é `{ status }` e tem exatamente uma chave. `status` é uma string, não
 * um objeto: não há como um `archived`, um `assignees` ou um `name` entrar por
 * aqui, nem por engano nem por requisição forjada. Ver o cabeçalho.
 */
export async function mudarStatus(token: string, taskId: string, status: string): Promise<void> {
  await chamar<unknown>("mudarStatus", token, { taskId }, { corpo: { status } });
}

/**
 * 7b. Mudar o PRAZO — e só o prazo.
 *
 * =============================================================================
 * ⚠️ `due_date_time` NÃO É OPCIONAL, e ignorá-lo repete o defeito da Etapa 1
 * =============================================================================
 * O ClickUp guarda o prazo como um instante em milissegundos e usa um segundo
 * campo para dizer se a HORA foi escolhida por alguém:
 *
 *   due_date_time: true   → "vence dia 7 às 14h"
 *   due_date_time: false  → "vence dia 7", sem hora
 *
 * Mandar só `due_date` faz o ClickUp assumir `false`, e toda tarefa com hora
 * marcada passa a exibir 00:00 — o que a interface dele mostra como VENCIDA
 * desde a meia-noite. É exatamente o mesmo erro que o formulário de tarefas
 * interno cometia ao tratar data e hora como a mesma coisa, em outro módulo.
 *
 * =============================================================================
 * ⚠️ O CORPO É MONTADO DO ZERO — a defesa não é a rota, é isto
 * =============================================================================
 * `PUT /task/{id}` é o endpoint de ALTERAR TAREFA: o mesmo que remove colegas,
 * arquiva e move, dependendo do que vai no corpo. A tabela de `capabilities.ts`
 * controla método e rota; quem controla o PODER é esta função, construindo um
 * objeto com exatamente duas chaves.
 *
 * Por isso a assinatura recebe `instanteMs: number | null` e `comHora: boolean`
 * — tipos primitivos, não um objeto. Não existe forma de um `archived` ou um
 * `assignees` entrar por aqui, nem por engano nem por requisição forjada, porque
 * não há nenhum caminho pelo qual um objeto vindo da UI chegue ao corpo.
 *
 * `null` LIMPA o prazo: é o que o ClickUp entende, e é uma operação que o
 * usuário precisa ter ("tirei a data dessa tarefa").
 */
export async function mudarPrazo(
  token: string,
  taskId: string,
  instanteMs: number | null,
  comHora: boolean,
): Promise<void> {
  await chamar<unknown>(
    "mudarPrazo",
    token,
    { taskId },
    { corpo: { due_date: instanteMs, due_date_time: comHora } },
  );
}

/**
 * 8. Comentar.
 *
 * `notify_all: false` é deliberado: comentário criado por uma ferramenta
 * pessoal não deve disparar notificação para o time inteiro. Quem lê a tarefa
 * vê; quem não estava olhando não é interrompido por causa de um aplicativo que
 * só o autor usa.
 */
export async function comentar(
  token: string,
  taskId: string,
  texto: string,
): Promise<{ id: string }> {
  const r = await chamar<{ id?: string }>(
    "comentar",
    token,
    { taskId },
    { corpo: { comment_text: texto, notify_all: false } },
  );
  return { id: String(r?.id ?? "") };
}

/* ------------------------------------------------------------- composição */

/**
 * Identifica e escolhe o workspace — as duas leituras que `conectarClickUp`
 * precisa, numa função só.
 *
 * Fica aqui e não na action porque é a única composição de duas operações do
 * ClickUp; deixá-la na action espalharia conhecimento da API para fora de
 * `lib/clickup`.
 *
 * Quando há mais de um workspace, pega o PRIMEIRO e informa o total. Escolher
 * na interface exigiria uma segunda etapa no fluxo de conexão para um caso que
 * provavelmente não existe (uma pessoa, um trabalho); informar o total deixa a
 * tela dizer qual foi, e isso basta para perceber se pegou o errado.
 */
export async function identificarEEscolherWorkspace(token: string): Promise<PerfilClickUp> {
  const eu = await identificar(token);
  const workspaces = await listarWorkspaces(token);

  const primeiro = workspaces[0];
  if (!primeiro) {
    throw new ErroClickUp("falhou", "Nenhum workspace encontrado para esta conta do ClickUp.");
  }

  return {
    clickupUserId: eu.id,
    username: eu.username,
    email: eu.email,
    workspaceId: primeiro.id,
    workspaceName: primeiro.name,
    totalDeWorkspaces: workspaces.length,
  };
}
