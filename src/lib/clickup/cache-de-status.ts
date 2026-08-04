import type { StatusPossivel } from "@/lib/clickup/types";

/**
 * ============================================================================
 * CACHE DOS STATUS DE CADA LISTA — OBRIGATÓRIO, NÃO OTIMIZAÇÃO
 * ============================================================================
 * Classificar a fase pela posição do status exige conhecer os status da LISTA
 * de origem de cada tarefa (`GET /list/{id}`, operação 5 das 8 permitidas —
 * `capabilities.ts` não muda).
 *
 * ⚠️ SEM ESTE CACHE, a correção da coluna introduz um 429 que hoje não existe.
 * Abrir a aba com tarefas espalhadas por 12 listas passaria a custar 12
 * chamadas A CADA carregamento, somadas às até 5 páginas da listagem — e o
 * limite do ClickUp é da CONTA PESSOAL, dentro do workspace da empresa. Trocar
 * "a coluna está errada" por "a integração parou" seria um péssimo negócio.
 *
 * Com ele, o custo em regime é ZERO chamada extra. As N só acontecem no
 * primeiro carregamento depois de um cold start.
 *
 * ============================================================================
 * O QUE ISTO É: memória de PROCESSO — a mesma honestidade de `rate-limit.ts`
 * ============================================================================
 * O Map vive na instância. Na Vercel cada função serverless é um processo que
 * nasce, atende e morre, e várias existem em paralelo. Então:
 *
 *   - o cache é POR INSTÂNCIA. Quatro instâncias quentes podem buscar a mesma
 *     lista quatro vezes;
 *   - um cold start esvazia tudo.
 *
 * Isso é suficiente AQUI, e o motivo é o padrão de uso: quem abre a aba de
 * tarefas volta a ela várias vezes na mesma sessão, e é essa repetição que o
 * cache corta. Não é uma promessa de "no máximo N chamadas por hora".
 *
 * ============================================================================
 * POR QUE NÃO HÁ `setInterval` DE LIMPEZA
 * ============================================================================
 * Mesmo raciocínio de `rate-limit.ts`, e vale repetir: um timer em nível de
 * módulo segura o event loop (a suíte fica pendurada no fim), dispara em
 * momentos arbitrários em ambiente serverless, e dá EFEITO COLATERAL a um
 * `import`. A poda é preguiçosa, dentro da própria chamada.
 */

/**
 * Uma hora.
 *
 * Status de lista é configuração de processo — muda quando alguém redesenha o
 * fluxo do time, o que acontece algumas vezes por ano. Uma hora de defasagem no
 * pior caso significa, na prática, uma coluna errada durante uma tarde no dia
 * em que o fluxo mudou; e a tela mostra a base da classificação, então dá para
 * perceber.
 */
const VALIDADE_MS = 60 * 60 * 1000;

/**
 * Teto de listas DISTINTAS resolvidas por listagem.
 *
 * ⚠️ É a rede de segurança contra o laço de N chamadas sem limite. Um workspace
 * em que as 500 tarefas venham de 80 listas diferentes faria 80 requisições num
 * carregamento. Acima do teto, as listas que sobraram simplesmente não são
 * resolvidas e as tarefas delas caem no comportamento anterior (`faseDoStatus`)
 * — degrada, não quebra.
 *
 * 20 porque é folgado para uso real (quem tem tarefa em mais de 20 listas ao
 * mesmo tempo tem outro problema) e continua muito abaixo do limite de 100/min
 * da API, mesmo somado às 5 páginas da listagem.
 */
export const TETO_DE_LISTAS_POR_LISTAGEM = 20;

/** Acima disto, a entrada mais velha sai. Impede o Map de crescer sem fim. */
const TETO_DE_ENTRADAS = 200;

interface Entrada {
  statuses: StatusPossivel[];
  gravadoEm: number;
}

const cache = new Map<string, Entrada>();

export function lerStatusEmCache(
  listId: string,
  agora: number = Date.now(),
): StatusPossivel[] | null {
  const entrada = cache.get(listId);
  if (!entrada) return null;
  if (agora - entrada.gravadoEm >= VALIDADE_MS) {
    cache.delete(listId);
    return null;
  }
  return entrada.statuses;
}

/**
 * Guarda os status de uma lista.
 *
 * Exportado e chamado também de `detalharTarefaClickUp`, que já busca os status
 * daquela lista para popular o seletor: aproveitar a resposta que já veio deixa
 * o cache mais quente sem nenhuma chamada a mais.
 */
export function gravarStatusEmCache(
  listId: string,
  statuses: StatusPossivel[],
  agora: number = Date.now(),
): void {
  // Poda preguiçosa: só quando o Map passa do teto, e só do que já expirou.
  if (cache.size >= TETO_DE_ENTRADAS) {
    for (const [chave, entrada] of cache) {
      if (agora - entrada.gravadoEm >= VALIDADE_MS) cache.delete(chave);
    }
    // Ainda cheio depois de podar o expirado: sai a entrada mais antiga. `Map`
    // preserva a ordem de inserção, então a primeira chave é a mais velha.
    if (cache.size >= TETO_DE_ENTRADAS) {
      const maisVelha = cache.keys().next().value;
      if (maisVelha !== undefined) cache.delete(maisVelha);
    }
  }
  cache.set(listId, { statuses, gravadoEm: agora });
}

export interface ResolucaoDeListas {
  porLista: Map<string, StatusPossivel[]>;
  /** Listas que ficaram de fora por causa do teto. A tela não usa; o log, sim. */
  naoResolvidas: string[];
}

/**
 * Resolve os status de várias listas, usando o cache e respeitando o teto.
 *
 * `buscar` entra por parâmetro em vez de ser importado: é o que permite testar
 * a política inteira — cache, teto, falha parcial — contando chamadas, sem
 * `fetch` falso e sem tocar em `capabilities.ts`.
 *
 * ⚠️ `allSettled`, e não `all`. Uma lista que falha (apagada, sem permissão,
 * rede) não pode derrubar a listagem inteira: as tarefas dela caem no
 * comportamento anterior e as outras continuam classificadas. Falhar tudo por
 * causa de uma lista seria trocar um defeito visível por um apagão.
 */
export async function resolverStatusDasListas(
  listIds: string[],
  buscar: (listId: string) => Promise<StatusPossivel[]>,
  agora: number = Date.now(),
): Promise<ResolucaoDeListas> {
  const porLista = new Map<string, StatusPossivel[]>();
  const faltando: string[] = [];

  for (const id of new Set(listIds)) {
    const emCache = lerStatusEmCache(id, agora);
    if (emCache) porLista.set(id, emCache);
    else faltando.push(id);
  }

  // O que está em cache NÃO conta para o teto: não custa chamada nenhuma.
  const aBuscar = faltando.slice(0, TETO_DE_LISTAS_POR_LISTAGEM);
  const naoResolvidas = faltando.slice(TETO_DE_LISTAS_POR_LISTAGEM);

  const resultados = await Promise.allSettled(
    aBuscar.map(async (id) => ({ id, statuses: await buscar(id) })),
  );

  for (const r of resultados) {
    if (r.status !== "fulfilled") continue;
    // Lista sem status não é resposta útil e não vale ocupar o cache por uma
    // hora — na próxima vez tenta de novo.
    if (r.value.statuses.length === 0) continue;
    porLista.set(r.value.id, r.value.statuses);
    gravarStatusEmCache(r.value.id, r.value.statuses, agora);
  }

  return { porLista, naoResolvidas };
}

/** Apaga tudo. Existe para os testes começarem limpos. */
export function zerarCacheDeStatus(): void {
  cache.clear();
}

/** Quantas listas estão em memória. Serve ao teste que prova que a poda poda. */
export function listasEmCache(): number {
  return cache.size;
}
