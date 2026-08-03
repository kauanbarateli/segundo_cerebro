import "server-only";

import { ErroClickUp } from "@/lib/clickup/erros";

/**
 * ============================================================================
 * ⭐ O COFRE — o ÚNICO módulo do projeto que fala com api.clickup.com
 * ============================================================================
 *
 * Existe um teste (`capabilities.test.ts`) que varre `src/` e falha se
 * `api.clickup.com` aparecer em qualquer outro arquivo. Isso não é burocracia:
 * é o que impede a erosão. Daqui a seis meses, quando alguém — ou um agente —
 * precisar de "só mais um endpoint", a suíte quebra e a conversa acontece antes
 * do commit, em vez de o poder do aplicativo crescer sem ninguém decidir.
 *
 * ============================================================================
 * O QUE ESTE ARQUIVO PROTEGE, E POR QUE ELE PRECISA EXISTIR
 * ============================================================================
 * O token pessoal do ClickUp NÃO TEM ESCOPO. Ele é a chave da conta inteira no
 * workspace da empresa: apagar tarefa, apagar lista, apagar Space, tirar
 * colegas de tarefas, criar o que quiser. Não existe "token só de leitura".
 *
 * Portanto a limitação não pode vir do token — ela tem que vir do CÓDIGO. Este
 * arquivo é essa limitação, e a forma dela é uma tabela fechada de operações.
 *
 * ============================================================================
 * ⚠️ A ARMADILHA CENTRAL: PUT /task/{id} NÃO É "MUDAR STATUS"
 * ============================================================================
 * É o endpoint de ALTERAR TAREFA, e o que ele faz depende do corpo:
 *
 *     { "status": "in progress" }        → o que queremos
 *     { "name": "outro nome" }           → renomeia
 *     { "description": "..." }           → reescreve
 *     { "due_date": 1754092800000 }      → muda prazo
 *     { "assignees": { "rem": [12345] }} → TIRA UM COLEGA DA TAREFA
 *     { "archived": true }               → arquiva
 *     { "parent": "outro_id" }           → move
 *
 * Um allowlist por ROTA deixaria tudo isso passar. Por isso a tabela abaixo
 * controla o método e o caminho, e `client.ts` controla o CORPO — construindo-o
 * do zero em vez de filtrar um objeto recebido. As duas metades são
 * necessárias; nenhuma sozinha resolve.
 *
 * ============================================================================
 * `DELETE` NÃO APARECE AQUI
 * ============================================================================
 * Não por omissão: por decisão. Apagar tarefa não é algo que este aplicativo
 * deva ser capaz de fazer nem por engano, nem sob requisição forjada, nem daqui
 * a dois anos quando ninguém lembrar por quê. Como `chamar()` só aceita chaves
 * desta tabela, `DELETE` não é sequer EXPRESSÁVEL no código — não há string a
 * passar que produza uma requisição de exclusão.
 */

const BASE = "https://api.clickup.com/api/v2";

/** Teto do tempo de espera. Ver o requisito 4, abaixo. */
const TIMEOUT_MS = 10_000;

interface ParametrosDeRota {
  teamId?: string;
  taskId?: string;
  listId?: string;
}

interface Definicao {
  readonly metodo: "GET" | "PUT" | "POST";
  readonly rota: (p: ParametrosDeRota) => string;
}

/**
 * As oito operações que existem. Não é configuração — é a definição do que o
 * aplicativo é CAPAZ de fazer.
 *
 * Acrescentar uma linha aqui amplia o poder do token sobre o workspace da
 * empresa. A mudança tem que ser conspícua, e é: não há como ampliar sem editar
 * esta tabela, e há um teste que compara as chaves com uma lista literal.
 */
const OPERACOES = {
  /** 1. Quem sou eu no ClickUp. */
  identificar: { metodo: "GET", rota: () => `/user` },
  /** 2. Meus workspaces. */
  workspaces: { metodo: "GET", rota: () => `/team` },
  /** 3. Tarefas ONDE SOU RESPONSÁVEL (o filtro vai na query, em client.ts). */
  minhasTarefas: { metodo: "GET", rota: (p) => `/team/${p.teamId}/task` },
  /** 4. Uma tarefa específica. */
  umaTarefa: { metodo: "GET", rota: (p) => `/task/${p.taskId}` },
  /** 5. Os status válidos de uma lista. */
  statusDaLista: { metodo: "GET", rota: (p) => `/list/${p.listId}` },
  /** 6. Comentários de uma tarefa. */
  lerComentarios: { metodo: "GET", rota: (p) => `/task/${p.taskId}/comment` },
  /** 7. Mudar o status. Corpo montado em client.ts, com UMA chave. */
  mudarStatus: { metodo: "PUT", rota: (p) => `/task/${p.taskId}` },
  /** 8. Comentar. */
  comentar: { metodo: "POST", rota: (p) => `/task/${p.taskId}/comment` },
} as const satisfies Record<string, Definicao>;

export type Operacao = keyof typeof OPERACOES;

/** Exportada só para o teste da Fase 6.2 poder afirmar sobre ela. */
export const OPERACOES_DISPONIVEIS = Object.keys(OPERACOES) as Operacao[];
export { OPERACOES };

/**
 * Ids do ClickUp são opacos e alfanuméricos (`901234567890`, `abc123`).
 *
 * ⚠️ ESTA REGEX É PARTE DA FRONTEIRA, não uma validação de conveniência. O id
 * chega pela rede (Server Action é endpoint HTTP) e vai DIRETO para dentro da
 * URL. Sem ela, um id como `../../team/123/task` viaja o path e alcança uma
 * rota que não está na tabela de operações — a tabela teria sido contornada por
 * uma string, sem nunca ser editada.
 *
 * Também barra `%2e%2e`, barra, interrogação e cerquilha, que são os outros
 * jeitos de sair da rota pretendida.
 */
const ID_VALIDO = /^[A-Za-z0-9_-]+$/;

function exigirId(valor: string | undefined, campo: string): string {
  if (typeof valor !== "string" || valor.length === 0 || valor.length > 64) {
    throw new ErroClickUp("falhou", `Identificador ausente (${campo}).`);
  }
  if (!ID_VALIDO.test(valor)) {
    throw new ErroClickUp("falhou", `Identificador inválido (${campo}).`);
  }
  return valor;
}

/** Valida os parâmetros que a rota escolhida realmente usa. */
function validarParametros(op: Operacao, p: ParametrosDeRota): void {
  if (op === "minhasTarefas") exigirId(p.teamId, "teamId");
  if (op === "umaTarefa" || op === "lerComentarios" || op === "mudarStatus" || op === "comentar") {
    exigirId(p.taskId, "taskId");
  }
  if (op === "statusDaLista") exigirId(p.listId, "listId");
}

function traduzirStatus(status: number, corpo: string): ErroClickUp {
  if (status === 401 || status === 403) {
    return new ErroClickUp("token_invalido", "Token recusado pelo ClickUp.", status);
  }
  if (status === 429) {
    return new ErroClickUp("limite_de_taxa", "Limite de requisições do ClickUp.", status);
  }
  if (status === 404) {
    return new ErroClickUp("nao_encontrado", "Recurso não encontrado no ClickUp.", status);
  }
  // O corpo do ClickUp costuma trazer `{ err, ECODE }`. Guardamos um recorte
  // curto para diagnóstico — nunca o token, que não aparece no corpo.
  return new ErroClickUp("falhou", `ClickUp respondeu ${status}: ${corpo.slice(0, 200)}`, status);
}

export interface OpcoesDeChamada {
  /** Query string. Montada por `client.ts`, nunca repassada de fora. */
  query?: Record<string, string | string[]>;
  /** Corpo. CONSTRUÍDO por `client.ts`; ver a armadilha no topo. */
  corpo?: Record<string, unknown>;
}

/**
 * A única função que faz `fetch` para o ClickUp.
 *
 * Requisitos que estão implementados aqui e o porquê de cada um:
 *
 *  1. ASSINATURA FECHADA — `op` é uma chave de `OPERACOES`. TypeScript recusa
 *     qualquer outra coisa em compilação, e a checagem logo abaixo recusa o que
 *     vier pela rede (onde tipo não existe).
 *  2. IDS VALIDADOS POR REGEX antes de entrarem na URL. Ver `ID_VALIDO`.
 *  3. HEADER CRU: `Authorization: <token>`, SEM `Bearer`. O ClickUp responde
 *     401 com `Bearer`, e um 401 leva direto à conclusão errada ("meu token
 *     está errado") quando o problema é o prefixo.
 *  4. TIMEOUT de 10 s. Sem ele, ClickUp lento segura a função serverless até o
 *     teto da plataforma — e o usuário fica olhando um esqueleto de carregamento
 *     que nunca resolve.
 *  5. O TOKEN NUNCA É LOGADO. Nenhum `console.error(erro)` cru aqui: o objeto de
 *     erro do fetch pode carregar a requisição inteira, headers inclusive.
 *  6. 429 VIRA ERRO TIPADO, para a tela distinguir "espere" de "deu erro".
 *  7. SEM RETRY EM PUT/POST. Retry de escrita é como o mesmo comentário aparece
 *     duas vezes na tarefa de um colega. GET pode retentar uma vez, porque é
 *     idempotente.
 */
export async function chamar<T>(
  op: Operacao,
  token: string,
  parametros: ParametrosDeRota,
  opcoes: OpcoesDeChamada = {},
): Promise<T> {
  // Requisito 1, metade de runtime. `op` pode chegar de um caminho sem tipo.
  if (!Object.prototype.hasOwnProperty.call(OPERACOES, op)) {
    throw new ErroClickUp("falhou", "Operação não permitida.");
  }
  const definicao: Definicao = OPERACOES[op];

  // Requisito 2.
  validarParametros(op, parametros);

  const url = new URL(`${BASE}${definicao.rota(parametros)}`);
  for (const [chave, valor] of Object.entries(opcoes.query ?? {})) {
    if (Array.isArray(valor)) valor.forEach((v) => url.searchParams.append(chave, v));
    else url.searchParams.set(chave, valor);
  }

  const ehEscrita = definicao.metodo !== "GET";
  const tentativas = ehEscrita ? 1 : 2; // requisito 7

  let ultimoErro: unknown;

  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    let resposta: Response;
    try {
      resposta = await fetch(url, {
        method: definicao.metodo,
        headers: {
          // Requisito 3: sem "Bearer".
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
        // Requisito 4.
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      // Requisito 5: a exceção original NÃO é propagada nem registrada — ela
      // pode carregar a requisição, e a requisição carrega o token.
      ultimoErro = new ErroClickUp(
        "indisponivel",
        e instanceof Error && e.name === "TimeoutError"
          ? "O ClickUp demorou demais para responder."
          : "Não foi possível alcançar o ClickUp.",
      );
      if (tentativa < tentativas) continue;
      throw ultimoErro;
    }

    if (resposta.ok) {
      // 204 e afins não têm corpo; `mudarStatus` cai aqui.
      const texto = await resposta.text();
      return (texto.length > 0 ? JSON.parse(texto) : null) as T;
    }

    const erro = traduzirStatus(resposta.status, await resposta.text().catch(() => ""));
    // Só 5xx merece a segunda tentativa: 4xx é resposta definitiva, e repetir
    // um 429 é gastar cota para receber o mesmo 429.
    const valeRetentar = resposta.status >= 500 && tentativa < tentativas;
    if (!valeRetentar) throw erro;
    ultimoErro = erro;
  }

  throw ultimoErro ?? new ErroClickUp("falhou", "Falha desconhecida ao chamar o ClickUp.");
}
