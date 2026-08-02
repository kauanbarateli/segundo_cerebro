/**
 * Decisão pura da sincronização do Google Calendar: dado o payload de eventos
 * que o Google devolveu, o que fazer com cada um.
 *
 * POR QUE ESTE MÓDULO EXISTE SEPARADO DE calendar.ts
 *
 * `syncCalendarAccount` é I/O de ponta a ponta (token, fetch, Supabase) e por
 * isso não é testável sem banco nem rede. A REGRA, porém — "cancelado não se
 * apaga, se marca" — é justamente a parte que precisa de prova automatizada,
 * porque é dela que depende a sobrevivência dos vínculos criados na fase 3.
 * Então a regra mora aqui: sem `server-only`, sem `fetch`, sem Supabase, sem
 * `Date.now()`. Entra dado, sai plano.
 *
 * O QUE O TIPO GARANTE — E O QUE ELE NÃO GARANTE
 *
 * `SyncPlan` tem exatamente dois campos: `paraUpsert` e `paraCancelar`. Não
 * existe `paraApagar`, e não existe um campo de "ação" cujo valor pudesse um dia
 * ser "delete". Isso fecha um buraco: o PLANEJADOR não tem como pedir uma
 * exclusão, e mexer nisso exige editar esta interface, o que aparece na revisão.
 *
 * Mas seria falso dizer que a exclusão é "inexprimível". `paraCancelar: string[]`
 * é uma lista de `google_event_id`, e uma lista de ids serve a um
 * `.delete().in("google_event_id", ...)` exatamente tão bem quanto ao
 * `.update({status:'cancelled'}).in(...)` de hoje. A escolha entre apagar e
 * marcar mora no CONSUMIDOR (`calendar.ts`), fora do alcance deste tipo — e por
 * isso a prova dela também mora lá, em `calendar.test.ts`, que sincroniza contra
 * um cliente Supabase falso e falha se algum `.delete()` encostar em
 * `calendar_events`. Os testes deste arquivo cobrem só o particionamento; sem o
 * teste do consumidor, reintroduzir o `.delete()` deixaria a suíte inteira verde.
 */

/** Evento como o Google Calendar v3 devolve. Só o que a sincronização consome. */
export interface GoogleEvent {
  id: string;
  etag?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  organizer?: { email?: string; displayName?: string };
  attendees?: unknown[];
  conferenceData?: unknown;
  recurringEventId?: string;
  originalStartTime?: { dateTime?: string; date?: string };
  created?: string;
  updated?: string;
}

/** Linha de `public.calendar_events` pronta para o upsert. */
export interface CalendarEventRow {
  user_id: string;
  calendar_account_id: string;
  calendar_source_id: string;
  google_event_id: string;
  etag: string | null;
  status: string | null;
  summary: string | null;
  description: string | null;
  location: string | null;
  html_link: string | null;
  start_at: string | null;
  end_at: string | null;
  start_date: string | null;
  end_date: string | null;
  all_day: boolean;
  organizer: string | null;
  attendees: unknown[] | null;
  conference_data: unknown | null;
  recurring_event_id: string | null;
  original_start_time: string | null;
  created_at_google: string | null;
  updated_at_google: string | null;
}

/** Identificadores locais que a linha precisa carregar (não vêm do Google). */
export interface SyncIds {
  userId: string;
  accountId: string;
  sourceId: string;
}

/**
 * O plano de escrita de uma página de eventos.
 *
 * Repare no que NÃO existe aqui: nenhum campo de exclusão. As duas únicas
 * saídas de um evento são "gravar a linha" e "marcar como cancelado" — o soft
 * delete decidido na fase 3, que preserva a linha local e, com ela, os vínculos
 * de `task_event_links` / `capture_event_links` que apontam para o uuid dela.
 *
 * `paraCancelar` guarda `google_event_id`, não o uuid local: no momento do
 * planejamento ainda não se sabe (nem interessa saber) se o evento já tem linha
 * local. Quem resolve isso é o UPDATE, filtrando por
 * (calendar_source_id, google_event_id).
 */
export interface SyncPlan {
  readonly paraUpsert: CalendarEventRow[];
  readonly paraCancelar: string[];
}

/** Converte o evento do Google na linha do cache local. */
export function mapEventRow(ev: GoogleEvent, ids: SyncIds): CalendarEventRow {
  // Evento de dia inteiro chega com `start.date` e sem `start.dateTime`.
  const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
  return {
    user_id: ids.userId,
    calendar_account_id: ids.accountId,
    calendar_source_id: ids.sourceId,
    google_event_id: ev.id,
    etag: ev.etag ?? null,
    // O status vem do Google e é gravado como está. É o que faz a RESSURREIÇÃO
    // funcionar sozinha: um evento que foi cancelado (linha local com
    // status = 'cancelled') e depois reativado no Google volta no payload como
    // 'confirmed', entra em paraUpsert e o upsert por
    // (calendar_source_id, google_event_id) sobrescreve o status da linha que já
    // existe. Não há caminho de volta para escrever à mão — o caminho de ida e o
    // de volta são o mesmo upsert.
    status: ev.status ?? null,
    summary: ev.summary ?? null,
    description: ev.description ?? null,
    location: ev.location ?? null,
    html_link: ev.htmlLink ?? null,
    start_at: ev.start?.dateTime ?? null,
    end_at: ev.end?.dateTime ?? null,
    start_date: ev.start?.date ?? null,
    end_date: ev.end?.date ?? null,
    all_day: allDay,
    organizer: ev.organizer?.email ?? ev.organizer?.displayName ?? null,
    attendees: ev.attendees ?? null,
    conference_data: ev.conferenceData ?? null,
    recurring_event_id: ev.recurringEventId ?? null,
    original_start_time: ev.originalStartTime?.dateTime ?? null,
    created_at_google: ev.created ?? null,
    updated_at_google: ev.updated ?? null,
  };
}

/**
 * Particiona o payload em "gravar" e "marcar como cancelado".
 *
 * DUAS SUTILEZAS QUE PARECEM DETALHE E NÃO SÃO:
 *
 * 1. STATUS AUSENTE É EVENTO ATIVO. O Google omite `status` em parte dos
 *    eventos; só 'cancelled' significa cancelado. Em JavaScript
 *    `undefined !== "cancelled"` é `true`, então tratar ausente como ativo sai
 *    de graça — o oposto exato da armadilha do Postgres, onde
 *    `null <> 'cancelled'` avalia para NULL e some com a linha. Vale registrar o
 *    contraste porque quem lê o filtro SQL logo depois pode achar que os dois
 *    lados têm o mesmo comportamento.
 *
 * 2. DEDUPLICAÇÃO POR id, VENCENDO O ÚLTIMO. O `syncToken` do Google entrega as
 *    alterações em ordem CRONOLÓGICA de modificação, então o mesmo evento pode
 *    aparecer duas vezes na mesma coleta — criado e depois cancelado, por
 *    exemplo. O último estado é o estado atual, e é ele que vale.
 *
 *    Isso não é só semântica: sem deduplicar, o mesmo `google_event_id` iria
 *    duas vezes no mesmo `upsert`, e o Postgres RECUSA o comando inteiro com
 *    "ON CONFLICT DO UPDATE command cannot affect row a second time". A
 *    implementação anterior (dois `filter` independentes) tinha esse defeito
 *    latente e, pior, num caso confirmado→cancelado mandava a linha para o
 *    upsert E para a remoção ao mesmo tempo, com o resultado dependendo da ordem
 *    das duas chamadas.
 */
export function planejarSync(eventos: readonly GoogleEvent[], ids: SyncIds): SyncPlan {
  // Map preserva a ordem de inserção da CHAVE e substitui o VALOR quando ela
  // repete — exatamente "o último estado vence" sem embaralhar o resto.
  const estadoFinal = new Map<string, GoogleEvent>();
  for (const ev of eventos) {
    // Evento sem id não é endereçável: não há por onde fazer upsert nem por onde
    // filtrar o UPDATE. Descartar é a única ação segura. O tipo diz que `id` é
    // obrigatório, mas o payload é JSON de terceiro e não passa por validação.
    if (!ev || !ev.id) continue;
    estadoFinal.set(ev.id, ev);
  }

  const paraUpsert: CalendarEventRow[] = [];
  const paraCancelar: string[] = [];

  for (const [googleEventId, ev] of estadoFinal) {
    if (ev.status === "cancelled") {
      paraCancelar.push(googleEventId);
    } else {
      paraUpsert.push(mapEventRow(ev, ids));
    }
  }

  return { paraUpsert, paraCancelar };
}
