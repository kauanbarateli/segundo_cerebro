import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type {
  Category,
  Task,
  Capture,
  UserPreferences,
  Profile,
  CalendarAccount,
  CalendarEvent,
  FinanceAccount,
  FinanceAccountBalance,
  FinanceCategory,
  FinanceTag,
  FinanceTransaction,
  FinanceBudget,
  DriveFolder,
  DriveFile,
  DriveUsage,
  Habit,
  HabitEntry,
  HabitPause,
  Project,
  KnowledgeNotebook,
  KnowledgePage,
  KnowledgePageNode,
  KnowledgePageSummary,
  KnowledgeSearchHit,
  SocialLink,
  ClickUpConnection,
} from "@/lib/database.types";
import { startOfDay, endOfDay, dayRangeInTimeZone, formatDayLabel, formatTime } from "@/lib/utils";
import { resolveEnabled } from "@/lib/modules";
import { lerConexao, lerConta } from "@/lib/clickup/credentials";
import { montarArvore, normalizarDocumento } from "@/lib/knowledge";
import type { RelatedItem, RelatedKind } from "@/lib/links";

// Reexportados para que as páginas peçam o carregador e o tipo do mesmo lugar.
// A definição continua em `links.ts`, que é puro — este arquivo é server-only e
// não pode ser importado por componente de cliente.
export type { RelatedItem, RelatedKind } from "@/lib/links";

export interface AppContext {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  profile: Profile | null;
  preferences: UserPreferences | null;
  enabledModules: Set<string>;
  organized: { done: number; total: number; percent: number };
}

/** URL assinada do avatar. O banco guarda o CAMINHO; a URL expira. */
async function signAvatar(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.storage.from("avatars").createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Contexto compartilhado do shell (identidade, prefs, módulos, progresso).
 *
 * Envolvido em `cache()` do React — correção C1, e a de maior impacto.
 *
 * O layout (`(app)/layout.tsx`) e a página chamam esta função na MESMA
 * navegação: o layout monta a barra lateral, e cada página de módulo passa por
 * `requireModule()`, que também precisa do contexto. Sem memoização isso
 * executava tudo duas vezes — incluindo dois `auth.getUser()`, que são idas e
 * voltas HTTP reais ao servidor de Auth, não uma leitura local do JWT.
 *
 * `cache()` memoiza por passe de render. Layout e página renderizam no mesmo
 * passe, então a segunda chamada devolve o resultado da primeira sem tocar a
 * rede. Corta metade do trabalho de servidor por navegação.
 */
export const getAppContext = cache(async (): Promise<AppContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: preferences }, { data: moduleRows }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("user_preferences").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("user_modules").select("module_key, enabled"),
  ]);

  const typedProfile = (profile as Profile | null) ?? null;

  const todayStart = startOfDay(new Date()).toISOString();
  const todayEnd = endOfDay(new Date()).toISOString();

  // A URL assinada do avatar depende do perfil, então não cabe no Promise.all
  // acima — mas roda em paralelo com a contagem de tarefas. Antes ela era
  // aguardada dentro do objeto de retorno, o que a colocava em série DEPOIS de
  // todo o resto: uma ida e volta HTTP inteira no fim da cadeia, por página.
  const [{ data: todayTasks }, avatarUrl] = await Promise.all([
    supabase
      .from("tasks")
      .select("status, due_at, scheduled_start_at")
      .neq("status", "archived")
      .or(
        `and(due_at.gte.${todayStart},due_at.lte.${todayEnd}),and(scheduled_start_at.gte.${todayStart},scheduled_start_at.lte.${todayEnd})`,
      ),
    signAvatar(typedProfile?.avatar_url ?? null),
  ]);

  const total = todayTasks?.length ?? 0;
  const done = (todayTasks ?? []).filter((t) => t.status === "done").length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  const displayName = typedProfile?.display_name || user.email?.split("@")[0] || "você";

  return {
    userId: user.id,
    email: user.email ?? "",
    displayName,
    avatarUrl,
    profile: typedProfile,
    preferences: (preferences as UserPreferences | null) ?? null,
    enabledModules: resolveEnabled(
      (moduleRows as { module_key: string; enabled: boolean }[] | null) ?? [],
    ),
    organized: { done, total, percent },
  };
});

/* ------------------------------------------------------------------ tarefas */

export async function getCategories(): Promise<Category[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("categories").select("*").order("name");
  return (data as Category[] | null) ?? [];
}

export async function getTasks(): Promise<Task[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tasks")
    .select("*")
    .neq("status", "archived")
    .order("board_position", { ascending: true, nullsFirst: false })
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  return (data as Task[] | null) ?? [];
}

export async function getCaptures(): Promise<Capture[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("captures")
    .select("*")
    .in("status", ["draft", "inbox"])
    .order("captured_at", { ascending: false });
  return (data as Capture[] | null) ?? [];
}

/* --------------------------------------------------------------- calendário */

export async function getCalendarAccounts(): Promise<CalendarAccount[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("calendar_accounts").select("*").order("slot");
  return (data as CalendarAccount[] | null) ?? [];
}

export async function getCalendarSources() {
  const supabase = await createClient();
  const { data } = await supabase.from("calendar_sources").select("*").order("summary");
  return data ?? [];
}

/**
 * Ordena como o banco ordenava: `order("start_at", { ascending: true })`.
 *
 * Só é usada quando `getEventsForCalendar` junta os resultados de consultas
 * diferentes: a ordem do banco vale dentro de cada lista, nunca entre elas.
 * (Enquanto há uma lista só, a ordenação continua sendo do banco.) O detalhe que
 * engana: no Postgres, `order by ... asc` é NULLS LAST, e evento de dia inteiro
 * tem `start_at` nulo (a data mora em `start_date`). Um comparador ingênuo
 * jogaria os dias inteiros para o começo e mudaria a tela sem ninguém pedir.
 */
function porInicio(a: CalendarEvent, b: CalendarEvent): number {
  if (a.start_at === b.start_at) return 0;
  if (a.start_at === null) return 1;
  if (b.start_at === null) return -1;
  return a.start_at < b.start_at ? -1 : 1;
}

/**
 * Eventos da agenda dentro de um intervalo.
 *
 * FILTRO DE CANCELADOS — a mudança desta fase. Com o soft delete, o evento
 * cancelado PERMANECE na tabela; sem filtrar, a agenda passaria a exibir
 * reunião cancelada para sempre.
 *
 * A ARMADILHA DO NULL: `status` é anulável e um `.neq("status", "cancelled")`
 * vira `status <> 'cancelled'`, que avalia para NULL — não para TRUE — quando o
 * status é nulo. O evento sumiria da agenda sem nenhum aviso. A forma correta é
 * `status is null or status <> 'cancelled'`, a mesma de getUpcomingEvents.
 *
 * A ARMADILHA DO POSTGREST: esta consulta JÁ usava `.or(...)` para o intervalo.
 * Encadear um segundo `.or(...)` acrescenta um SEGUNDO parâmetro `or=` na URL, e
 * aí o resultado depende de como o PostgREST combina parâmetros repetidos —
 * algo que ninguém consegue conferir lendo este arquivo. Em vez de apostar, a
 * conjunção está ESCRITA:
 *
 *   or=( and( or(intervalo), or(status) ) )
 *
 * Um `or` de um único membro é esse membro, então o que chega ao banco é
 * literalmente `(intervalo) AND (não cancelado)`, com os parênteses explícitos.
 * Nunca `(intervalo) OR (não cancelado)`, que traria a agenda inteira do
 * usuário por causa do segundo lado.
 *
 * EXCEÇÃO DELIBERADA: o cancelado que TEM VÍNCULO continua aparecendo. Filtrar
 * todos deixaria a tarefa com um vínculo apontando para o nada — o usuário veria
 * "nasceu de uma reunião" e nenhuma reunião. O CalendarEventCard já esmaece e
 * risca o cancelado (opacity-60 + line-through), então ele aparece visivelmente
 * como cancelado.
 *
 * DE ONDE VÊM OS VÍNCULOS: de `getRelatedItems("event")`, que é MEMOIZADO e é a
 * mesma chamada que a página do calendário já faz no seu próprio `Promise.all`.
 * Antes daqui saía um `getEventLinks(idsCancelados)`, e o resultado era ler
 * task_event_links e capture_event_links DUAS VEZES por render — uma filtrada
 * pelos cancelados, outra inteira — sendo que a segunda é um superconjunto
 * estrito da primeira. Pior: por depender dos ids, a leitura filtrada só podia
 * começar DEPOIS que a consulta dos cancelados voltasse, o que punha uma ida e
 * volta a mais em SÉRIE no caminho crítico da página. Chamando a versão
 * memoizada dentro do mesmo `Promise.all` das duas consultas de evento, as
 * tabelas de vínculo são lidas uma única vez por render e a leitura começa junto
 * com as outras, não atrás delas.
 */
export async function getEventsForCalendar(
  fromIso: string,
  toIso: string,
): Promise<CalendarEvent[]> {
  const supabase = await createClient();

  // Os dois membros do OR de intervalo: evento com hora (start_at) e evento de
  // dia inteiro (start_date, que é `date` e por isso compara com 'YYYY-MM-DD').
  const intervalo =
    `and(start_at.gte.${fromIso},start_at.lte.${toIso}),` +
    `and(start_date.gte.${fromIso.slice(0, 10)},start_date.lte.${toIso.slice(0, 10)})`;

  const [{ data: ativos }, { data: cancelados }, vinculos] = await Promise.all([
    supabase
      .from("calendar_events")
      .select("*")
      .or(`and(or(${intervalo}),or(status.is.null,status.neq.cancelled))`)
      .order("start_at", { ascending: true }),
    // Os cancelados do mesmo intervalo — só os IDS. A maioria não tem vínculo e
    // vai ser descartada; puxar `*` seria trazer o payload inteiro (descrição,
    // participantes, conference_data) de dezenas de reuniões mortas a cada
    // abertura da agenda, para jogar fora. As linhas completas vêm depois, e só
    // das que sobrarem.
    //
    // Aqui `status.eq.cancelled` é o lado SEGURO da armadilha do NULL: com
    // status nulo a comparação vira NULL, a linha não casa e fica de fora — que
    // é justamente o desejado, porque status nulo não é cancelamento.
    supabase.from("calendar_events").select("id").or(`and(or(${intervalo}),status.eq.cancelled)`),
    // Não depende dos ids dos cancelados, então roda LADO A LADO com as duas
    // consultas acima em vez de esperar por elas. E como é memoizada, a chamada
    // idêntica que a página do calendário faz no mesmo passe de render não custa
    // nenhuma consulta a mais: as duas compartilham a mesma promessa.
    getRelatedItems("event"),
  ]);

  const listaAtivos = (ativos as CalendarEvent[] | null) ?? [];
  const idsCancelados = ((cancelados as { id: string }[] | null) ?? []).map((e) => e.id);
  if (idsCancelados.length === 0) return listaAtivos;

  // O Map só tem entrada para quem TEM vínculo, então `has` já é a resposta.
  const idsVisiveis = idsCancelados.filter((id) => vinculos.has(id));
  if (idsVisiveis.length === 0) return listaAtivos;

  const { data: visiveis } = await supabase
    .from("calendar_events")
    .select("*")
    .in("id", idsVisiveis);

  // A ordem do banco vale dentro de cada lista, não entre elas: juntar as duas
  // exige reordenar. Ver `porInicio` sobre o NULLS LAST.
  return [...listaAtivos, ...((visiveis as CalendarEvent[] | null) ?? [])].sort(porInicio);
}

/**
 * Dia inteiro PRIMEIRO, depois os eventos com hora em ordem cronológica.
 *
 * Evento de dia inteiro não tem `start_at` (a data mora em `start_date`), então
 * o `order` do banco — que é NULLS LAST no ascendente — joga todos eles para o
 * fim da lista. Um feriado ou uma viagem apareceriam DEPOIS da última reunião do
 * dia, que é o oposto de como se lê uma agenda: o que vale para o dia todo é
 * contexto e vem antes do que acontece às 14h.
 */
function porDiaInteiroPrimeiro(a: CalendarEvent, b: CalendarEvent): number {
  if (a.all_day !== b.all_day) return a.all_day ? -1 : 1;
  return porInicio(a, b);
}

/**
 * Os eventos de HOJE — o bloco "Agenda" da tela inicial.
 *
 * Existe separada de `getUpcomingEvents` porque as duas respondem a perguntas
 * diferentes. `getUpcomingEvents(5)` devolve os próximos cinco eventos A PARTIR
 * DE AGORA, sem recorte de dia: numa terça sem compromissos ela mostra a reunião
 * de quinta, e o bloco passa a mentir sobre o que é. Aqui o recorte é o dia
 * civil, e um dia vazio aparece vazio.
 *
 * O FUSO É O PONTO DELICADO. Os limites saem de `dayRangeInTimeZone`, não de
 * `startOfDay`: esta função roda no servidor, o servidor da Vercel roda em UTC, e
 * `startOfDay` trabalha no fuso do processo. Ver o comentário dela em `utils.ts`
 * — o defeito só apareceria depois das 21h, quando o dia UTC já virou e o de São
 * Paulo não.
 *
 * DOIS TIPOS DE EVENTO, DUAS COMPARAÇÕES:
 *   - com hora: `start_at` é `timestamptz` e compara com instantes UTC. O fim é
 *     EXCLUSIVO (`lt`), então a meia-noite do dia seguinte não entra hoje.
 *   - dia inteiro: `start_date` é `date`, sem fuso, e compara com a chave do dia.
 *     `end_date` do Google é EXCLUSIVO — um evento só no dia 2 vem com
 *     `start_date = 02` e `end_date = 03` —, por isso a condição é
 *     `end_date > hoje` e não `>=`. Evento de vários dias cobre hoje quando
 *     começou hoje ou antes e termina depois de hoje. Quando `end_date` é nulo,
 *     sobra o caso de um único dia.
 *
 * A FORMA ANINHADA DO `or` repete a de `getEventsForCalendar`, e pelo mesmo
 * motivo: encadear dois `.or()` põe dois parâmetros `or=` na URL e o resultado
 * passa a depender de como o PostgREST combina parâmetros repetidos. Escrever
 * `or=(and(or(intervalo),or(status)))` deixa a conjunção explícita.
 *
 * CANCELADOS FICAM DE FORA, sem a exceção de vínculo que a agenda cheia faz.
 * Este bloco responde "o que eu tenho hoje"; reunião cancelada não é resposta
 * para isso, e a tela inicial não tem para onde abrir o detalhe que explicaria
 * o risco.
 */
export const getEventsForToday = cache(async (): Promise<CalendarEvent[]> => {
  const supabase = await createClient();
  const { dayKey, startIso, endIso } = dayRangeInTimeZone(new Date());

  const comHora = `and(start_at.gte.${startIso},start_at.lt.${endIso})`;
  const diaInteiro =
    `and(start_date.lte.${dayKey},end_date.gt.${dayKey}),` +
    `and(start_date.eq.${dayKey},end_date.is.null)`;

  const { data } = await supabase
    .from("calendar_events")
    .select("*")
    .or(`and(or(${comHora},${diaInteiro}),or(status.is.null,status.neq.cancelled))`)
    .order("start_at", { ascending: true });

  return ((data as CalendarEvent[] | null) ?? []).sort(porDiaInteiroPrimeiro);
});

/** Memoizado: o shell e a página Início pedem os próximos eventos no mesmo passe. */
export const getUpcomingEvents = cache(async (limit = 6): Promise<CalendarEvent[]> => {
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from("calendar_events")
    .select("*")
    // `status` é anulável. Um `neq` puro vira `status <> 'cancelled'`, que
    // avalia para NULL — e não TRUE — quando o status é nulo, sumindo com o
    // evento sem aviso. O `or` explícito cobre os dois casos.
    .or("status.is.null,status.neq.cancelled")
    .gte("start_at", nowIso)
    .order("start_at", { ascending: true })
    .limit(limit);
  return (data as CalendarEvent[] | null) ?? [];
});

/* ----------------------------------------------------------------- vínculos */

/**
 * Leitura EM LOTE dos vínculos (0009: task_capture_links, task_event_links,
 * capture_event_links).
 *
 * POR QUE EM LOTE, E NÃO DENTRO DO LAÇO DA TELA: uma lista de 60 tarefas que
 * pergunta "quais vínculos você tem?" por item faz 60 (ou 120) idas ao banco
 * para trazer, somadas, algumas dezenas de linhas. É o N+1 — o defeito de
 * desempenho mais comum neste tipo de tela e o mais fácil de introduzir sem
 * perceber, porque cada consulta isolada parece barata. Aqui é UMA consulta por
 * tabela de vínculo, com todos os ids de uma vez, e o agrupamento acontece na
 * memória do servidor.
 *
 * O Map devolvido tem entrada SOMENTE para quem tem vínculo. Isso é útil de
 * propósito: `mapa.has(id)` já responde "este item tem alguma origem?" sem
 * varrer array — a mesma propriedade que `getRelatedItems` mantém e que
 * `getEventsForCalendar` usa para decidir qual cancelado continua visível.
 */

export interface TaskLinkIds {
  captureIds: string[];
  eventIds: string[];
}

export interface CaptureLinkIds {
  taskIds: string[];
  eventIds: string[];
}

export interface EventLinkIds {
  taskIds: string[];
  captureIds: string[];
}

/**
 * Consulta uma tabela de vínculo e agrupa `colunaValor` por `colunaChave`.
 *
 * Os três argumentos de nome são LITERAIS do código, jamais entrada do usuário —
 * as tabelas de vínculo são três e estão fixas nas funções abaixo. A RLS filtra
 * por user_id sozinha, então não há `.eq("user_id", ...)` aqui.
 *
 * `ids === null` significa "sem filtro": traz todos os vínculos do usuário. Ver
 * a justificativa em `getRelatedItems` — em resumo, filtrar por id exige
 * conhecer os ids, e conhecê-los custa uma ida ao banco a mais, em série, para
 * trazer exatamente as mesmas linhas.
 */
async function agruparVinculos(
  tabela: string,
  colunaChave: string,
  colunaValor: string,
  ids: string[] | null,
): Promise<Map<string, string[]>> {
  const supabase = await createClient();
  const consulta = supabase.from(tabela).select(`${colunaChave}, ${colunaValor}`);
  const { data } = await (ids === null ? consulta : consulta.in(colunaChave, ids));

  const mapa = new Map<string, string[]>();
  for (const linha of (data as Record<string, string>[] | null) ?? []) {
    const chave = linha[colunaChave];
    const valor = linha[colunaValor];
    if (!chave || !valor) continue;
    const atual = mapa.get(chave);
    if (atual) atual.push(valor);
    else mapa.set(chave, [valor]);
  }
  return mapa;
}

/** Une os dois lados num Map só, com entrada apenas para quem tem vínculo. */
function chavesDe(...mapas: Map<string, string[]>[]): Set<string> {
  const chaves = new Set<string>();
  for (const mapa of mapas) for (const chave of mapa.keys()) chaves.add(chave);
  return chaves;
}

/** Capturas e eventos ligados a cada tarefa da lista. */
export async function getTaskLinks(taskIds: string[]): Promise<Map<string, TaskLinkIds>> {
  // Retorno cedo: `.in("task_id", [])` gera `task_id=in.()`, uma ida ao banco
  // que não pode trazer nada. Consulta garantidamente inútil não se faz.
  if (taskIds.length === 0) return new Map();

  const [porCaptura, porEvento] = await Promise.all([
    agruparVinculos("task_capture_links", "task_id", "capture_id", taskIds),
    agruparVinculos("task_event_links", "task_id", "calendar_event_id", taskIds),
  ]);

  const saida = new Map<string, TaskLinkIds>();
  for (const chave of chavesDe(porCaptura, porEvento)) {
    saida.set(chave, {
      captureIds: porCaptura.get(chave) ?? [],
      eventIds: porEvento.get(chave) ?? [],
    });
  }
  return saida;
}

/** Tarefas e eventos ligados a cada captura da lista. */
export async function getCaptureLinks(captureIds: string[]): Promise<Map<string, CaptureLinkIds>> {
  if (captureIds.length === 0) return new Map();

  const [porTarefa, porEvento] = await Promise.all([
    agruparVinculos("task_capture_links", "capture_id", "task_id", captureIds),
    agruparVinculos("capture_event_links", "capture_id", "calendar_event_id", captureIds),
  ]);

  const saida = new Map<string, CaptureLinkIds>();
  for (const chave of chavesDe(porTarefa, porEvento)) {
    saida.set(chave, {
      taskIds: porTarefa.get(chave) ?? [],
      eventIds: porEvento.get(chave) ?? [],
    });
  }
  return saida;
}

/**
 * Tarefas e capturas ligadas a cada evento da lista.
 *
 * Este é o sentido INVERSO das duas PKs compostas — filtra pela segunda coluna,
 * que o índice da chave primária não cobre. É exatamente para esta consulta que
 * a 0009 criou `task_event_links_event_idx` e `capture_event_links_event_idx`.
 */
export async function getEventLinks(eventIds: string[]): Promise<Map<string, EventLinkIds>> {
  if (eventIds.length === 0) return new Map();

  const [porTarefa, porCaptura] = await Promise.all([
    agruparVinculos("task_event_links", "calendar_event_id", "task_id", eventIds),
    agruparVinculos("capture_event_links", "calendar_event_id", "capture_id", eventIds),
  ]);

  const saida = new Map<string, EventLinkIds>();
  for (const chave of chavesDe(porTarefa, porCaptura)) {
    saida.set(chave, {
      taskIds: porTarefa.get(chave) ?? [],
      captureIds: porCaptura.get(chave) ?? [],
    });
  }
  return saida;
}

/* -------------------------------------------- vínculos prontos para a tela */

/**
 * A seção "Relacionado" precisa de duas coisas por página: os vínculos de cada
 * linha exibida (o selo do card e a lista dentro do modal) e o conjunto de
 * candidatos do autocomplete. As duas são carregadas EM LOTE aqui, no servidor,
 * junto com o resto da página. Nenhum componente busca nada — um `fetch` por
 * card seria N+1 disfarçado de "só uma consultinha".
 *
 * POR QUE `getRelatedItems` NÃO FILTRA POR ID: ele lê a tabela de vínculo
 * inteira do usuário. Parece desperdício e não é. Filtrar exigiria os ids da
 * lista, que só existem DEPOIS da consulta da lista — ou seja, custaria uma ida
 * e volta a mais ao banco em toda navegação, em série, fora do Promise.all da
 * página. E não economizaria nada em troca: estas telas mostram praticamente
 * todas as linhas do usuário, então o `in.(...)` traria as mesmas linhas com
 * uma URL de vários KB (36 caracteres por uuid). A RLS já restringe ao dono.
 *
 * Onde o filtro por id É o certo é em `resolverRotulos`, que busca linhas
 * específicas — e lá ele existe.
 */

const STATUS_TAREFA: Record<string, string> = {
  todo: "A fazer",
  in_progress: "Em andamento",
  done: "Concluída",
  archived: "Arquivada",
};

const TIPO_CAPTURA: Record<string, string> = {
  idea: "Ideia",
  task: "Tarefa",
  note: "Nota",
  reminder: "Lembrete",
};

/** Ordem de exibição dentro da seção "Relacionado". */
const ORDEM_TIPO: Record<RelatedKind, number> = { task: 0, capture: 1, event: 2 };

/** Janela e teto dos candidatos do autocomplete. Ver `getEventCandidates`. */
const LIMITE_CANDIDATOS = 200;
const DIAS_ATRAS = 90;
const DIAS_ADIANTE = 30;

/** Achata quebras de linha e corta no tamanho útil de um rótulo de lista. */
function resumir(texto: string, limite = 70): string {
  const limpo = texto.replace(/\s+/g, " ").trim();
  return limpo.length <= limite ? limpo : `${limpo.slice(0, limite - 1)}…`;
}

/** Junta as partes da linha secundária, devolvendo null quando não sobra nada. */
function dica(...partes: (string | null)[]): string | null {
  const texto = partes.filter((p) => p && p.length > 0).join(" · ");
  return texto.length > 0 ? texto : null;
}

interface LinhaTarefa {
  id: string;
  title: string;
  status: string;
  due_at: string | null;
}

interface LinhaCaptura {
  id: string;
  type: string;
  title: string | null;
  content: string | null;
  captured_at: string;
}

interface LinhaEvento {
  id: string;
  summary: string | null;
  status: string | null;
  start_at: string | null;
  start_date: string | null;
}

function itemDeTarefa(t: LinhaTarefa): RelatedItem {
  return {
    id: t.id,
    kind: "task",
    label: resumir(t.title),
    hint: dica(STATUS_TAREFA[t.status] ?? null, t.due_at ? formatDayLabel(t.due_at) : null),
  };
}

function itemDeCaptura(c: LinhaCaptura): RelatedItem {
  // Captura sem título é o caso comum (o compositor trata título como opcional),
  // então o começo do texto é o que identifica a nota. O corte acontece AQUI, no
  // servidor: o `content` pode ter 10.000 caracteres e nada disso precisa
  // atravessar a rede para virar um rótulo de 70.
  const texto = c.title?.trim() || c.content?.trim() || "";
  return {
    id: c.id,
    kind: "capture",
    label: texto.length > 0 ? resumir(texto) : "(sem título)",
    hint: dica(TIPO_CAPTURA[c.type] ?? null, formatDayLabel(c.captured_at)),
  };
}

function itemDeEvento(e: LinhaEvento): RelatedItem {
  // Evento de dia inteiro não tem `start_at` — a data mora em `start_date`, que
  // é `date` e não `timestamptz`. O "T12:00:00" é deliberado: `new Date("2026-08-02")`
  // é interpretado como MEIA-NOITE UTC e, formatado em São Paulo (UTC-3),
  // aparece como o dia anterior. Ancorar ao meio-dia local imuniza a conversão
  // contra qualquer fuso entre -12 e +12.
  const quando = e.start_at
    ? `${formatDayLabel(e.start_at)} ${formatTime(e.start_at)}`
    : e.start_date
      ? formatDayLabel(`${e.start_date}T12:00:00`)
      : null;
  return {
    id: e.id,
    kind: "event",
    label: resumir(e.summary ?? "(sem título)"),
    // O cancelado aparece na lista de vínculos (é a razão do soft delete), mas
    // precisa aparecer ROTULADO — senão o usuário lê "esta tarefa nasceu daquela
    // reunião" sem saber que a reunião foi desmarcada.
    hint: dica(quando, e.status === "cancelled" ? "Cancelado" : null),
  };
}

function porRotulo(a: RelatedItem, b: RelatedItem): number {
  if (a.kind !== b.kind) return ORDEM_TIPO[a.kind] - ORDEM_TIPO[b.kind];
  return a.label.localeCompare(b.label, "pt-BR");
}

/* ------------------------------------------- candidatos do autocomplete */

/**
 * `tasks.status` e `captures.status` são `not null` no banco (0001), então aqui
 * o `.neq` é seguro. A armadilha do NULL (`status <> 'x'` avalia para NULL, não
 * TRUE) vale para `calendar_events.status`, que É anulável — e por isso o filtro
 * de eventos, logo abaixo, usa a forma explícita com `status.is.null`.
 */
export async function getTaskCandidates(): Promise<RelatedItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tasks")
    .select("id, title, status, due_at")
    .neq("status", "archived")
    .order("created_at", { ascending: false })
    .limit(LIMITE_CANDIDATOS);
  return ((data as LinhaTarefa[] | null) ?? []).map(itemDeTarefa);
}

export async function getCaptureCandidates(): Promise<RelatedItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("captures")
    .select("id, type, title, content, captured_at")
    .in("status", ["draft", "inbox"])
    .order("captured_at", { ascending: false })
    .limit(LIMITE_CANDIDATOS);
  return ((data as LinhaCaptura[] | null) ?? []).map(itemDeCaptura);
}

/**
 * Eventos oferecidos no autocomplete: uma JANELA em volta de hoje, não a agenda
 * inteira. Uma conta antiga do Google tem milhares de eventos, e mandar todos
 * para o navegador por causa de um campo de busca seria megabytes de payload em
 * cada abertura de modal. A janela é assimétrica de propósito — o caso real é
 * "esta tarefa nasceu da reunião da semana passada", então olhar mais para trás
 * (DIAS_ATRAS) do que para a frente (DIAS_ADIANTE) é o que serve.
 *
 * A consulta repete a forma aninhada de `getEventsForCalendar` — `or=(and(or(intervalo),
 * or(status)))` — pelo mesmo motivo documentado lá: dois `.or()` encadeados
 * viram dois parâmetros `or=` na URL e o resultado passa a depender de como o
 * PostgREST combina parâmetros repetidos.
 *
 * `nullsFirst: false` no ORDER: no Postgres, `desc` é NULLS FIRST, e evento de
 * dia inteiro tem `start_at` nulo. Sem isso, aniversários e feriados viriam
 * primeiro e poderiam consumir sozinhos o limite de LIMITE_CANDIDATOS.
 */
export async function getEventCandidates(): Promise<RelatedItem[]> {
  const supabase = await createClient();
  const de = new Date(Date.now() - DIAS_ATRAS * 86_400_000).toISOString();
  const ate = new Date(Date.now() + DIAS_ADIANTE * 86_400_000).toISOString();
  const intervalo =
    `and(start_at.gte.${de},start_at.lte.${ate}),` +
    `and(start_date.gte.${de.slice(0, 10)},start_date.lte.${ate.slice(0, 10)})`;

  const { data } = await supabase
    .from("calendar_events")
    .select("id, summary, status, start_at, start_date")
    .or(`and(or(${intervalo}),or(status.is.null,status.neq.cancelled))`)
    .order("start_at", { ascending: false, nullsFirst: false })
    .limit(LIMITE_CANDIDATOS);
  return ((data as LinhaEvento[] | null) ?? []).map(itemDeEvento);
}

/* ------------------------------------------------ vínculos de cada entidade */

interface LadoDoVinculo {
  tabela: string;
  chave: string;
  valor: string;
  /** O tipo do que está do OUTRO lado — é ele que vira o rótulo. */
  tipo: RelatedKind;
}

const LADOS: Record<RelatedKind, readonly [LadoDoVinculo, LadoDoVinculo]> = {
  task: [
    { tabela: "task_capture_links", chave: "task_id", valor: "capture_id", tipo: "capture" },
    { tabela: "task_event_links", chave: "task_id", valor: "calendar_event_id", tipo: "event" },
  ],
  capture: [
    { tabela: "task_capture_links", chave: "capture_id", valor: "task_id", tipo: "task" },
    {
      tabela: "capture_event_links",
      chave: "capture_id",
      valor: "calendar_event_id",
      tipo: "event",
    },
  ],
  event: [
    { tabela: "task_event_links", chave: "calendar_event_id", valor: "task_id", tipo: "task" },
    {
      tabela: "capture_event_links",
      chave: "calendar_event_id",
      valor: "capture_id",
      tipo: "capture",
    },
  ],
};

/**
 * Busca os rótulos de ids específicos, uma consulta por tipo.
 *
 * SEM FILTRO DE STATUS, e isso é obrigatório: o outro lado de um vínculo pode
 * estar fora das listas normais da aplicação. A captura convertida em tarefa
 * fica em status 'organized' (e `getCaptures` só traz 'draft' e 'inbox') — e é
 * justamente ela que a 0009 vincula no backfill das conversões antigas. O mesmo
 * vale para tarefa arquivada e evento cancelado. Reaproveitar os carregadores de
 * lista aqui faria a maioria dos vínculos herdados aparecer sem nome.
 */
async function resolverRotulos(
  idsPorTipo: Map<RelatedKind, Set<string>>,
): Promise<Map<string, RelatedItem>> {
  const supabase = await createClient();
  const tarefas = [...(idsPorTipo.get("task") ?? [])];
  const capturas = [...(idsPorTipo.get("capture") ?? [])];
  const eventos = [...(idsPorTipo.get("event") ?? [])];

  const [rTarefas, rCapturas, rEventos] = await Promise.all([
    tarefas.length > 0
      ? supabase.from("tasks").select("id, title, status, due_at").in("id", tarefas)
      : null,
    capturas.length > 0
      ? supabase
          .from("captures")
          .select("id, type, title, content, captured_at")
          .in("id", capturas)
      : null,
    eventos.length > 0
      ? supabase
          .from("calendar_events")
          .select("id, summary, status, start_at, start_date")
          .in("id", eventos)
      : null,
  ]);

  const diretorio = new Map<string, RelatedItem>();
  for (const linha of (rTarefas?.data as LinhaTarefa[] | null) ?? []) {
    diretorio.set(linha.id, itemDeTarefa(linha));
  }
  for (const linha of (rCapturas?.data as LinhaCaptura[] | null) ?? []) {
    diretorio.set(linha.id, itemDeCaptura(linha));
  }
  for (const linha of (rEventos?.data as LinhaEvento[] | null) ?? []) {
    diretorio.set(linha.id, itemDeEvento(linha));
  }
  return diretorio;
}

/**
 * Vínculos de TODAS as entidades de um tipo, prontos para a tela: um Map de
 * `id da entidade` -> itens do outro lado, com rótulo.
 *
 * O Map tem entrada SOMENTE para quem tem vínculo, então `mapa.get(id) ?? []`
 * na tela responde as duas perguntas de uma vez: quantos selos mostrar no card e
 * o que listar dentro do modal.
 *
 * MEMOIZADO por `cache()` do React, pelo mesmo motivo de `getAppContext`: na
 * página do calendário há DOIS chamadores no mesmo passe de render — a própria
 * página e `getEventsForCalendar`, que precisa do mesmo Map para decidir qual
 * evento cancelado continua visível. Sem a memoização as duas tabelas de vínculo
 * eram lidas duas vezes por render. `cache()` guarda a promessa já na primeira
 * chamada, então o segundo chamador (mesmo simultâneo) aguarda a mesma execução
 * em vez de disparar outra.
 */
export const getRelatedItems = cache(async (
  kind: RelatedKind,
): Promise<Map<string, RelatedItem[]>> => {
  const [ladoA, ladoB] = LADOS[kind];

  const [mapaA, mapaB] = await Promise.all([
    agruparVinculos(ladoA.tabela, ladoA.chave, ladoA.valor, null),
    agruparVinculos(ladoB.tabela, ladoB.chave, ladoB.valor, null),
  ]);
  const lados = [
    { lado: ladoA, mapa: mapaA },
    { lado: ladoB, mapa: mapaB },
  ];

  const idsPorTipo = new Map<RelatedKind, Set<string>>();
  for (const { lado, mapa } of lados) {
    const conjunto = idsPorTipo.get(lado.tipo) ?? new Set<string>();
    for (const valores of mapa.values()) for (const valor of valores) conjunto.add(valor);
    idsPorTipo.set(lado.tipo, conjunto);
  }

  const diretorio = await resolverRotulos(idsPorTipo);

  const saida = new Map<string, RelatedItem[]>();
  for (const { lado, mapa } of lados) {
    for (const [chave, valores] of mapa) {
      const lista = saida.get(chave) ?? [];
      for (const valor of valores) {
        // O item pode não aparecer no diretório se a leitura falhar (RLS,
        // indisponibilidade). Excluído ele não pode estar: as duas FKs são
        // `on delete cascade`, então apagar a ponta apaga o vínculo junto. O
        // marcador serve para que o botão "Remover vínculo" continue existindo
        // em vez de a linha sumir em silêncio.
        lista.push(
          diretorio.get(valor) ?? {
            id: valor,
            kind: lado.tipo,
            label: "(item indisponível)",
            hint: null,
          },
        );
      }
      saida.set(chave, lista);
    }
  }
  for (const lista of saida.values()) lista.sort(porRotulo);
  return saida;
});

/* --------------------------------------------------------------- financeiro */

export interface FinanceSnapshot {
  accounts: FinanceAccount[];
  balances: FinanceAccountBalance[];
  categories: FinanceCategory[];
  tags: FinanceTag[];
  /** Lançamentos do mês exibido e do anterior, por `occurred_on`. */
  transactions: FinanceTransaction[];
  /**
   * Lançamentos de CARTÃO com data POSTERIOR à janela acima — na prática, as
   * parcelas ainda por vencer. É o "não faturado" de `limiteDisponivel()` e o
   * que alimenta a projeção das próximas faturas.
   *
   * DISJUNTO de `transactions` por construção (uma lista termina onde a outra
   * começa), então `[...transactions, ...futureCardTransactions]` pode ser
   * passado direto para `faturaDoCartao()` sem contar nada duas vezes. São dois
   * campos, e não um só, para que ninguém some `transactions` inteiro achando
   * que está somando "o mês" e leve junto três anos de parcelas futuras.
   */
  futureCardTransactions: FinanceTransaction[];
  budgets: FinanceBudget[];
  transactionTags: { transaction_id: string; tag_id: string }[];
}

/**
 * Carrega o mês corrente e o anterior numa tacada só — a comparação
 * mês a mês do dashboard precisa dos dois, e uma query cobre ambos.
 *
 * As colunas novas da 0010 (is_credit, debt_cents, available_cents na view;
 * credit_limit_cents e os dias do cartão em finance_accounts; installment_* e
 * statement_month nos lançamentos) vêm sozinhas nos `select("*")` que já
 * existiam. O que NÃO vinha, e é acrescentado aqui, são as parcelas futuras.
 */
export async function getFinanceSnapshot(monthIso: string): Promise<FinanceSnapshot> {
  const supabase = await createClient();

  const [y, m] = monthIso.split("-").map(Number);
  const start = new Date(Date.UTC(y!, (m ?? 1) - 1, 1));
  const prevStart = new Date(Date.UTC(y!, (m ?? 1) - 2, 1));
  const end = new Date(Date.UTC(y!, m ?? 1, 0));

  const fromDate = prevStart.toISOString().slice(0, 10);
  const toDate = end.toISOString().slice(0, 10);
  void start;

  const [
    { data: accounts },
    { data: balances },
    { data: categories },
    { data: tags },
    { data: transactions },
    { data: futureCardTransactions },
    { data: budgets },
  ] = await Promise.all([
    supabase.from("finance_accounts").select("*").is("archived_at", null).order("name"),
    supabase.from("finance_account_balances").select("*"),
    supabase.from("finance_categories").select("*").order("name"),
    supabase.from("finance_tags").select("*").order("name"),
    supabase
      .from("finance_transactions")
      .select("*")
      .gte("occurred_on", fromDate)
      .lte("occurred_on", toDate)
      .order("occurred_on", { ascending: false }),
    // As parcelas que ainda vão cair. Sem elas o cartão MENTE ao contrário do
    // erro que a 0010 corrigiu: a compra de 12x apareceria como se devesse
    // apenas a parcela do mês, e o "limite disponível" mostraria dinheiro que o
    // cartão não te dá — o resto da dívida existe, só está no futuro.
    //
    // UMA consulta para todos os cartões, e não uma por cartão: filtrar por
    // conta exigiria conhecer os ids, que só chegam com a consulta de contas —
    // seria uma ida ao banco por cartão, em série, atrás desta. O clássico N+1.
    //
    // `statement_month not null` é o recorte de "é linha de cartão" sem precisar
    // de join: só cartão preenche essa coluna (0010), e o índice parcial
    // finance_tx_statement_idx cobre exatamente essas linhas. Nada de `<>` aqui:
    // "statement_month <> null" avaliaria para NULL e devolveria lista vazia em
    // silêncio.
    supabase
      .from("finance_transactions")
      .select("*")
      .gt("occurred_on", toDate)
      .not("statement_month", "is", null)
      .order("occurred_on", { ascending: true }),
    supabase.from("finance_budgets").select("*").eq("month", monthIso),
  ]);

  // As etiquetas cobrem as duas listas: uma parcela futura etiquetada precisa
  // mostrar a etiqueta na projeção da fatura tanto quanto uma do mês corrente.
  // As listas são disjuntas, então concatenar não repete id — e ids repetidos
  // aqui só inflariam a URL do `in`, sem quebrar nada.
  const txIds = [
    ...((transactions as FinanceTransaction[] | null) ?? []),
    ...((futureCardTransactions as FinanceTransaction[] | null) ?? []),
  ].map((t) => t.id);
  let transactionTags: { transaction_id: string; tag_id: string }[] = [];
  if (txIds.length > 0) {
    const { data } = await supabase
      .from("finance_transaction_tags")
      .select("transaction_id, tag_id")
      .in("transaction_id", txIds);
    transactionTags = (data as { transaction_id: string; tag_id: string }[] | null) ?? [];
  }

  return {
    accounts: (accounts as FinanceAccount[] | null) ?? [],
    balances: (balances as FinanceAccountBalance[] | null) ?? [],
    categories: (categories as FinanceCategory[] | null) ?? [],
    tags: (tags as FinanceTag[] | null) ?? [],
    transactions: (transactions as FinanceTransaction[] | null) ?? [],
    futureCardTransactions: (futureCardTransactions as FinanceTransaction[] | null) ?? [],
    budgets: (budgets as FinanceBudget[] | null) ?? [],
    transactionTags,
  };
}

/* ------------------------------------------------------------- redes sociais */

/**
 * Links do perfil, na ordem escolhida pela pessoa.
 *
 * A ordem é `position`, que é exatamente o que o índice
 * `social_links_user_position_idx` (0012) entrega já ordenado — filtro por dono
 * e ordem no mesmo percurso, sem nó de Sort.
 *
 * O DESEMPATE POR `created_at` NÃO É ENFEITE. `position` não é única no banco de
 * propósito (ver o comentário da coluna em 0012), e o empate é fácil de produzir:
 * a criação usa `max(position) + 1`, mas basta um lote de reordenação parcial
 * para duas linhas ficarem com o mesmo número. Sem desempate, a ordem de duas
 * linhas empatadas muda entre carregamentos e, na tela, parece que a lista se
 * reorganiza sozinha. É a mesma correção que `getNotebookPages` faz com `id`.
 *
 * Sem `.eq("user_id", ...)`: a RLS já restringe ao dono, e a tabela tem no
 * máximo 8 linhas por pessoa — não há ganho de plano a extrair repetindo o
 * filtro, ao contrário de `searchKnowledge`, onde ele existe pelo planejador.
 */
export async function getSocialLinks(): Promise<SocialLink[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("social_links")
    .select("*")
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  return (data as SocialLink[] | null) ?? [];
}

/* -------------------------------------------------------------------- drive */

export interface DriveListing {
  folders: DriveFolder[];
  files: DriveFile[];
  breadcrumb: DriveFolder[];
  usage: DriveUsage | null;
  allFolders: DriveFolder[];
}

export async function getDriveListing(folderId: string | null): Promise<DriveListing> {
  const supabase = await createClient();

  const foldersQuery = supabase
    .from("drive_folders")
    .select("*")
    .is("deleted_at", null)
    .order("name");

  const filesQuery = supabase
    .from("drive_files")
    .select("*")
    .is("deleted_at", null)
    .order("name");

  const [{ data: allFolders }, { data: files }, { data: usage }] = await Promise.all([
    foldersQuery,
    folderId
      ? filesQuery.eq("folder_id", folderId)
      : filesQuery.is("folder_id", null),
    supabase.from("drive_usage").select("*").maybeSingle(),
  ]);

  const folderList = (allFolders as DriveFolder[] | null) ?? [];
  const current = folderList.filter((f) =>
    folderId ? f.parent_id === folderId : f.parent_id === null,
  );

  // Breadcrumb: sobe a cadeia de pais. O guard de 64 níveis é defensivo — o
  // trigger do banco já impede ciclos, mas um loop infinito aqui derrubaria a
  // renderização inteira.
  const breadcrumb: DriveFolder[] = [];
  if (folderId) {
    const byId = new Map(folderList.map((f) => [f.id, f]));
    let cursor = byId.get(folderId);
    let guard = 0;
    while (cursor && guard < 64) {
      breadcrumb.unshift(cursor);
      cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
      guard++;
    }
  }

  return {
    folders: current,
    files: (files as DriveFile[] | null) ?? [],
    breadcrumb,
    usage: (usage as DriveUsage | null) ?? null,
    allFolders: folderList,
  };
}

export async function getDriveTrash(): Promise<DriveFile[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("drive_files")
    .select("*")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  return (data as DriveFile[] | null) ?? [];
}

/* ------------------------------------------------------------- conhecimento */

/**
 * Cadernos do usuário, os não apagados.
 *
 * `.is("deleted_at", null)` em TODA leitura do módulo: o soft delete existe no
 * banco (0011) mas a v1 não tem lixeira, então o que está apagado precisa sumir
 * de todas as telas. Esquecer o filtro em UMA consulta faz o item apagado
 * reaparecer só naquele lugar — o pior tipo de incoerência, porque parece bug de
 * exclusão e não de leitura.
 */
export async function getNotebooks(): Promise<KnowledgeNotebook[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("knowledge_notebooks")
    .select("*")
    .is("deleted_at", null)
    .order("name");
  return (data as KnowledgeNotebook[] | null) ?? [];
}

/**
 * Lista CHAPADA das páginas do caderno. É a ÚNICA consulta de árvore do módulo.
 *
 * UMA ida ao banco traz o caderno inteiro; a hierarquia é montada em memória. A
 * alternativa óbvia — pedir os filhos de cada nó conforme a barra lateral
 * expande — é o N+1 clássico: 80 páginas viram 80 consultas para trazer,
 * somadas, 80 linhas. Aqui o índice `knowledge_pages_notebook_tree_idx` entrega
 * filtro e ordem de uma vez, sem sort.
 *
 * O `select` é NOMINAL e não `*`: `content` é o documento inteiro de cada
 * página, e um caderno com 200 páginas de texto seriam megabytes de jsonb
 * atravessando a rede para desenhar uma lista de títulos. `content_text` fica de
 * fora pelo mesmo motivo.
 *
 * A ordenação é `position` — o índice fracionário entre irmãs. O desempate por
 * `id` não é preciosismo: `position` pode empatar (duas páginas criadas no mesmo
 * microssegundo, ou uma renumeração malfeita), e sem desempate estável a ordem
 * de duas irmãs empatadas muda entre carregamentos, o que na tela parece a lista
 * se reorganizando sozinha.
 *
 * A forma CHAPADA é a exportada porque ela serve às duas necessidades da tela: a
 * árvore (`montarArvore`) e o caminho até a página (`caminhoDaPagina`, que sobe
 * por `parent_id` e ficaria O(n) se tivesse de procurar o nó dentro da árvore já
 * montada). Uma consulta, dois usos.
 */
export async function getNotebookPages(notebookId: string): Promise<KnowledgePageSummary[]> {
  if (!notebookId) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("knowledge_pages")
    .select("id, notebook_id, parent_id, title, position, updated_at")
    .eq("notebook_id", notebookId)
    .is("deleted_at", null)
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  return (data as KnowledgePageSummary[] | null) ?? [];
}

/**
 * Árvore pronta do caderno, para quem só precisa desenhar a barra lateral.
 *
 * Envelope de `getNotebookPages` + `montarArvore`, e não uma segunda consulta:
 * duas listas de colunas quase iguais divergem na primeira mudança, e a
 * divergência não dá erro de compilação — dá uma tela com dado faltando.
 */
export async function getPageTree(notebookId: string): Promise<KnowledgePageNode[]> {
  return montarArvore(await getNotebookPages(notebookId));
}

/**
 * Uma página com o conteúdo. É a única leitura do módulo que traz `content`.
 *
 * `maybeSingle` e não `single`: `single` trata "nenhuma linha" como ERRO, e
 * nenhuma linha é o caso esperado aqui (página apagada, id de outro usuário
 * barrado pela RLS, link velho). O chamador transforma o `null` em 404.
 *
 * O documento passa por `normalizarDocumento` antes de sair daqui: a coluna tem
 * default `'{}'::jsonb`, que satisfaz o CHECK do banco mas não é documento do
 * ProseMirror. Consertar na borda de leitura vale mais que espalhar defesa pelo
 * editor — o editor recebe a garantia de que `content.type` existe.
 */
export async function getPage(pageId: string): Promise<KnowledgePage | null> {
  if (!pageId) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("knowledge_pages")
    .select("*")
    .eq("id", pageId)
    .is("deleted_at", null)
    .maybeSingle();

  const linha = data as KnowledgePage | null;
  if (!linha) return null;
  return { ...linha, content: normalizarDocumento(linha.content) };
}

/** Teto de resultados da busca. Mesmo número documentado na seção 10 de 0011. */
const LIMITE_BUSCA = 30;

/**
 * Busca full-text nas páginas.
 *
 * O TERMO NUNCA É CONCATENADO EM STRING DE CONSULTA. Ele vai como PARÂMETRO de
 * `.textSearch(...)`, que o supabase-js codifica e o PostgREST entrega ao
 * `websearch_to_tsquery` como literal. Montar `\`search_vector @@ ...'${termo}'\``
 * à mão seria injeção esperando acontecer, e nem precisaria de má-fé: um
 * apóstrofo em "não é possível" já quebraria a consulta.
 *
 * RETORNO CEDO com termo vazio ou só espaços, antes de qualquer ida ao banco.
 * Não é economia de milissegundos: `websearch_to_tsquery('portuguese', '')`
 * produz um tsquery VAZIO, que não casa com nada — a tela mostraria "nenhum
 * resultado" para quem ainda não digitou. Sair antes deixa o chamador distinguir
 * "não busquei" de "busquei e não achei".
 *
 * As três partes que degradam EM SILÊNCIO se faltarem (seção 10 de 0011):
 *   - `{ config: "portuguese" }`: sem isso o PostgREST monta o tsquery com a
 *     configuração default do banco (em geral `english`) e os lexemas da
 *     consulta não batem com os do índice. Zero linhas, sem erro nenhum.
 *   - `.is("deleted_at", null)`: o índice GIN é PARCIAL nesse predicado; sem
 *     repeti-lo o planejador não pode usá-lo e cai em varredura sequencial.
 *   - `{ type: "websearch" }`: gera `websearch_to_tsquery`, que engole texto cru
 *     do usuário (aspas, `OR`, `-termo`) e nunca levanta erro de sintaxe.
 *     `to_tsquery` devolveria 500 no primeiro parêntese digitado.
 *
 * O `.eq("user_id", ...)` é redundante com a RLS em SEGURANÇA, mas não em PLANO:
 * ele dá ao planejador um predicado que casa com `knowledge_pages_user_idx`.
 */
export async function searchKnowledge(
  termo: string,
  notebookId?: string | null,
): Promise<KnowledgeSearchHit[]> {
  if (!termo || termo.trim().length === 0) return [];

  const ctx = await getAppContext();
  if (!ctx) return [];

  const supabase = await createClient();
  let consulta = supabase
    .from("knowledge_pages")
    .select("id, notebook_id, parent_id, title, updated_at")
    .eq("user_id", ctx.userId)
    .is("deleted_at", null);

  if (notebookId) consulta = consulta.eq("notebook_id", notebookId);

  const { data } = await consulta
    .textSearch("search_vector", termo, { config: "portuguese", type: "websearch" })
    .order("updated_at", { ascending: false })
    .limit(LIMITE_BUSCA);

  return (data as KnowledgeSearchHit[] | null) ?? [];
}

/* ------------------------------------------------------------------ ClickUp */

/**
 * Estado da conexão com o ClickUp — leitura BARATA, só no Postgres.
 *
 * ⚠️ NÃO faz chamada de rede ao ClickUp, e essa é a decisão de arquitetura mais
 * importante desta integração.
 *
 * `tarefas/page.tsx` roda um `Promise.all` com cinco leituras antes de
 * renderizar. Enfiar uma chamada à API externa ali faria A SUA LISTA PESSOAL
 * ESPERAR PELO CLICKUP — e num dia em que a API deles estiver lenta, `/tarefas`
 * inteira fica lenta, inclusive para quem só quer ver as tarefas locais.
 *
 * Aqui só se responde "a aba deve aparecer?", com uma consulta a uma linha
 * indexada por `user_id` (UNIQUE na 0016). Ela entra no `Promise.all` que já
 * existe, então não custa ida e volta a mais. As tarefas do ClickUp são
 * buscadas SOB DEMANDA, quando a aba é clicada — pior caso, uma aba dizendo
 * "não foi possível carregar", e a lista pessoal nunca sabe que houve problema.
 *
 * Memoizada porque a página de Tarefas e a de Configurações podem pedir no
 * mesmo passe de render.
 */
export const getClickUpConnection = cache(async (): Promise<ClickUpConnection | null> => {
  const ctx = await getAppContext();
  if (!ctx) return null;
  return lerConexao(ctx.userId);
});

/** `last_checked_at` para a tela de Configurações dizer "verificado hoje 14:32". */
export const getClickUpVerificadoEm = cache(async (): Promise<string | null> => {
  const ctx = await getAppContext();
  if (!ctx) return null;
  const conta = await lerConta(ctx.userId);
  return conta?.last_checked_at ?? null;
});

/* ------------------------------------------------------------- Hábitos --- */

/**
 * Os hábitos ATIVOS, na ordem da tela.
 *
 * ⚠️ `archived_at is null` é repetido aqui de propósito, e não é redundância
 * com o índice: `habits_ativos_idx` é PARCIAL, e o planejador só o usa quando o
 * predicado aparece na consulta. Sem esta linha o índice existe e não serve.
 */
export async function getHabits(): Promise<Habit[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("habits")
    .select("*")
    .is("archived_at", null)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  return (data as Habit[] | null) ?? [];
}

/* -------------------------------------------- imagens anexadas à captura --- */

/** Uma imagem anexada, com a URL já assinada e pronta para o `<img src>`. */
export interface ImagemDaCaptura {
  fileId: string;
  captureId: string;
  url: string;
}

/**
 * As imagens de TODAS as capturas da tela, em UM lote.
 *
 * ⚠️ EM LOTE, e não uma consulta por captura. A caixa de entrada lista dezenas
 * de capturas; buscar os anexos dentro do laço faria N+1 idas ao banco numa tela
 * que abre a cada visita ao app. É o mesmo motivo pelo qual `getRelatedItems`
 * recebe a lista inteira e devolve um Map.
 *
 * ⚠️ A URL É ASSINADA E EXPIRA. O bucket `drive` é privado (0007), então não
 * existe URL pública: `createSignedUrls` emite um endereço temporário, e uma
 * hora é o mesmo prazo que `signAvatar` já usa. Depois disso a imagem quebra até
 * a página ser recarregada — que é o comportamento certo para conteúdo privado,
 * e o oposto do que um bucket público daria (um link permanente, adivinhável e
 * fora do controle da RLS).
 */
export async function getImagensDasCapturas(
  captureIds: string[],
): Promise<Map<string, ImagemDaCaptura[]>> {
  const mapa = new Map<string, ImagemDaCaptura[]>();
  if (captureIds.length === 0) return mapa;

  const supabase = await createClient();

  // A RLS já filtra por dono nas duas tabelas; o `in` é só o recorte da tela.
  const { data: vinculos } = await supabase
    .from("capture_file_links")
    .select("capture_id, file_id, drive_files(storage_path)")
    .in("capture_id", captureIds);

  const linhas =
    (vinculos as
      | { capture_id: string; file_id: string; drive_files: { storage_path: string } | null }[]
      | null) ?? [];

  const caminhos = linhas.map((l) => l.drive_files?.storage_path).filter((p): p is string => !!p);
  if (caminhos.length === 0) return mapa;

  const { data: assinadas } = await supabase.storage
    .from("drive")
    .createSignedUrls(caminhos, 3600);

  // `createSignedUrls` devolve na MESMA ordem dos caminhos pedidos, mas casar
  // por índice quebraria em silêncio se um deles falhasse. O Map por caminho é
  // à prova disso.
  const urlPorCaminho = new Map(
    (assinadas ?? [])
      .filter((a) => a.signedUrl && a.path)
      .map((a) => [a.path as string, a.signedUrl]),
  );

  for (const linha of linhas) {
    const caminho = linha.drive_files?.storage_path;
    const url = caminho ? urlPorCaminho.get(caminho) : undefined;
    if (!url) continue;
    const atuais = mapa.get(linha.capture_id) ?? [];
    atuais.push({ fileId: linha.file_id, captureId: linha.capture_id, url });
    mapa.set(linha.capture_id, atuais);
  }

  return mapa;
}

/**
 * Os hábitos ARQUIVADOS — a antessala da exclusão.
 *
 * Consulta separada, e não um `getHabits()` que traz tudo e filtra na tela: os
 * ativos são lidos a cada carregamento da página e usam o índice parcial
 * (`habits_ativos_idx`); trazer os arquivados junto desperdiçaria o índice e
 * cresceria sem teto justamente na consulta mais quente do módulo.
 *
 * Ordem por `archived_at desc`: o que foi arquivado por último é o que alguém
 * pode querer desfazer, e o que foi arquivado há um ano é o que se vai excluir.
 */
export async function getArchivedHabits(): Promise<Habit[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("habits")
    .select("*")
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false });
  return (data as Habit[] | null) ?? [];
}

/**
 * As marcações desde `de` (inclusive).
 *
 * ⚠️ TRAZ AS LINHAS, NÃO UM AGREGADO — e a janela é o que mantém isso barato.
 * `melhorSequencia` precisa do histórico inteiro do hábito para achar o maior
 * trecho, mas a tela só mostra os últimos 90 dias; puxar tudo desde sempre
 * cresceria sem teto. O painel calcula a melhor sequência DENTRO da janela
 * carregada, e a janela é escolhida por quem chama.
 *
 * Registro esparso ajuda: são poucas linhas por hábito por período, e não uma
 * por dia. Noventa dias de cinco hábitos são no máximo 450 linhas.
 */
export async function getHabitEntries(de: string): Promise<HabitEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("habit_entries")
    .select("*")
    .gte("done_on", de)
    .order("done_on", { ascending: true });
  return (data as HabitEntry[] | null) ?? [];
}

/**
 * As pausas que ALCANÇAM a janela.
 *
 * A condição é "não terminou antes do começo da janela" — o que inclui as
 * pausas ainda em curso (`ends_on is null`). Filtrar por `starts_on >= de`
 * perderia justamente a pausa que começou no mês passado e continua valendo.
 */
export async function getHabitPauses(de: string): Promise<HabitPause[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("habit_pauses")
    .select("*")
    .or(`ends_on.is.null,ends_on.gte.${de}`)
    .order("starts_on", { ascending: true });
  return (data as HabitPause[] | null) ?? [];
}

/* ------------------------------------------------------------ Projetos --- */

/**
 * Os projetos VIVOS, na ordem da tela.
 *
 * ⚠️ `deleted_at is null` repetido aqui de propósito: `projects_ativos_idx` é
 * PARCIAL, e o planejador só o usa quando o predicado aparece na consulta.
 */
export async function getProjects(): Promise<Project[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("*")
    .is("deleted_at", null)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  return (data as Project[] | null) ?? [];
}

export async function getProject(id: string): Promise<Project | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as Project | null) ?? null;
}

/**
 * TUDO do projeto, numa onda só.
 *
 * ============================================================================
 * ⚠️ O CONHECIMENTO SAI DE GRAÇA — é o pagamento da decisão de modelo
 * ============================================================================
 * `knowledge_pages` NÃO tem `project_id`. "As páginas do projeto" são as
 * páginas dos CADERNOS do projeto: uma consulta pelos cadernos e outra pelas
 * páginas deles. Sem coluna nova, sem trigger de árvore, sem CTE recursiva — e
 * `createPage` e `movePage` não mudaram uma linha.
 *
 * O mesmo vale para os arquivos: `drive_files` não tem a coluna, e todo upload
 * dentro de uma pasta do projeto já nasce no projeto.
 *
 * ============================================================================
 * A AGENDA SAI DAS TAREFAS, NÃO DOS VÍNCULOS DA 0009
 * ============================================================================
 * O cabeçalho da 0009 define vínculo como PROCEDÊNCIA ("esta tarefa nasceu
 * daquela reunião"). Derivar a agenda dele transformaria procedência em
 * pertencimento: a 1:1 semanal ligada a tarefas de três projetos apareceria nas
 * três agendas, sem forma de tirá-la de uma sem apagar um vínculo que quer
 * dizer outra coisa. Aqui a agenda são os campos que as tarefas já têm.
 */
export interface ConteudoDoProjeto {
  tarefas: Task[];
  capturas: Capture[];
  cadernos: KnowledgeNotebook[];
  paginas: KnowledgePageSummary[];
  pastas: DriveFolder[];
}

export async function getProjectContents(projectId: string): Promise<ConteudoDoProjeto> {
  const supabase = await createClient();

  const [tarefas, capturas, cadernos, pastas] = await Promise.all([
    supabase
      .from("tasks")
      .select("*")
      .eq("project_id", projectId)
      .neq("status", "archived")
      .order("due_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("captures")
      .select("*")
      .eq("project_id", projectId)
      .neq("status", "archived")
      .order("created_at", { ascending: false }),
    supabase
      .from("knowledge_notebooks")
      .select("*")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("position", { ascending: true }),
    supabase
      .from("drive_folders")
      .select("*")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("name", { ascending: true }),
  ]);

  const listaDeCadernos = (cadernos.data as KnowledgeNotebook[] | null) ?? [];

  // As páginas vêm num SEGUNDO passo porque dependem dos ids dos cadernos. Com
  // zero cadernos a consulta é pulada: um `in ()` vazio é uma ida ao banco para
  // trazer nada.
  let paginas: KnowledgePageSummary[] = [];
  if (listaDeCadernos.length > 0) {
    const { data } = await supabase
      .from("knowledge_pages")
      .select("id, notebook_id, parent_id, title, position, updated_at")
      .in(
        "notebook_id",
        listaDeCadernos.map((c) => c.id),
      )
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(50);
    paginas = (data as KnowledgePageSummary[] | null) ?? [];
  }

  return {
    tarefas: (tarefas.data as Task[] | null) ?? [],
    capturas: (capturas.data as Capture[] | null) ?? [],
    cadernos: listaDeCadernos,
    paginas,
    pastas: (pastas.data as DriveFolder[] | null) ?? [],
  };
}
