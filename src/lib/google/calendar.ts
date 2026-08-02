import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptRefreshToken, fromPgHex } from "@/lib/crypto/tokens";
import { refreshAccessToken } from "@/lib/google/oauth";
import { planejarSync, type GoogleEvent } from "@/lib/google/sync-plan";

/**
 * Google Calendar read-only sync. Uses the service_role admin client to read
 * encrypted credentials (never exposed to the browser) and to upsert the local
 * event cache. Implements full + incremental (syncToken) sync with 410 reset.
 *
 * A DECISÃO sobre cada evento (gravar ou marcar como cancelado) mora em
 * `@/lib/google/sync-plan`, que é puro e testado. Aqui ficou só o I/O — que
 * TAMBÉM tem prova: `calendar.test.ts` roda esta função contra um cliente
 * Supabase falso e quebra se o cancelamento voltar a ser um `.delete()`. O tipo
 * do plano sozinho não garante isso: `paraCancelar: string[]` alimenta um
 * `.delete().in(...)` exatamente tão bem quanto o `.update().in(...)` de hoje.
 */

const CALENDAR_LIST_ENDPOINT = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const EVENTS_ENDPOINT = (calId: string) =>
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`;

/**
 * Teto de `google_event_id` por PATCH de cancelamento.
 *
 * O `.in()` do PostgREST viaja na QUERY STRING (`google_event_id=in.(g1,g2,…)`),
 * não no corpo — ao contrário do payload do upsert, que vai no body e por isso
 * não precisa de lote. Aqui o tamanho da LISTA vira tamanho de URL: cada id do
 * Google tem ~30-45 caracteres e, com `singleEvents=true`, uma série recorrente
 * diária cancelada gera uma instância cancelada POR OCORRÊNCIA. Uma coleta
 * completa (janela de 210 dias com `showDeleted=true`, que é o que acontece na
 * primeira conexão e a cada reset por 410) junta centenas de ids num array só, a
 * URL passa de 8 KB e o gateway responde 414 antes de a consulta chegar ao
 * Postgres. Com 100 ids o pior caso fica na casa de 5 KB.
 */
const IDS_POR_LOTE_DE_CANCELAMENTO = 100;

interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  description?: string;
  timeZone?: string;
  accessRole?: string;
  backgroundColor?: string;
  primary?: boolean;
}

/** Reads + decrypts the refresh token for an account and returns a fresh access token. */
async function getAccessToken(admin: SupabaseClient, calendarAccountId: string): Promise<string> {
  // `crypto_version` e `key_id` entram no SELECT porque a LEITURA se orienta por
  // eles: a versão decide se há AAD, o key_id escolhe a chave. Antes da E9 as
  // duas colunas eram gravadas e nunca consultadas.
  const { data, error } = await admin
    .from("google_oauth_credentials")
    .select("refresh_token_ciphertext, refresh_token_iv, crypto_version, key_id")
    .eq("calendar_account_id", calendarAccountId)
    .single();

  if (error || !data) throw new Error("Credenciais não encontradas para a conta");

  const refreshToken = decryptRefreshToken({
    ciphertext: fromPgHex(data.refresh_token_ciphertext as string),
    iv: fromPgHex(data.refresh_token_iv as string),
    cryptoVersion: (data.crypto_version as number | null) ?? null,
    keyId: (data.key_id as string | null) ?? null,
    calendarAccountId,
  });
  const tokens = await refreshAccessToken(refreshToken);
  return tokens.access_token;
}

async function googleGet<T>(url: string, accessToken: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 410) throw new Error("SYNC_TOKEN_GONE");
  if (!res.ok) throw new Error(`Google API ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function listCalendars(accessToken: string): Promise<GoogleCalendarListEntry[]> {
  const items: GoogleCalendarListEntry[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(CALENDAR_LIST_ENDPOINT);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const data = await googleGet<{ items?: GoogleCalendarListEntry[]; nextPageToken?: string }>(
      url.toString(),
      accessToken,
    );
    items.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}

interface EventsPage {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

/** Lists events for a calendar. Incremental if syncToken is provided; otherwise full. */
async function listEvents(
  accessToken: string,
  calendarId: string,
  opts: { syncToken?: string | null },
): Promise<{ events: GoogleEvent[]; nextSyncToken: string | null }> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;

  do {
    const url = new URL(EVENTS_ENDPOINT(calendarId));
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("showDeleted", "true");
    if (opts.syncToken) {
      url.searchParams.set("syncToken", opts.syncToken);
    } else {
      // Full sync window: 30 days back to 180 days forward.
      const timeMin = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const timeMax = new Date(Date.now() + 180 * 86_400_000).toISOString();
      url.searchParams.set("timeMin", timeMin);
      url.searchParams.set("timeMax", timeMax);
      url.searchParams.set("orderBy", "startTime");
    }
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const data = await googleGet<EventsPage>(url.toString(), accessToken);
    events.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
    if (data.nextSyncToken) nextSyncToken = data.nextSyncToken;
  } while (pageToken);

  return { events, nextSyncToken };
}

export interface SyncResult {
  calendarsSynced: number;
  eventsUpserted: number;
  /**
   * Renomeado de `eventsDeleted` quando o cancelamento virou soft delete. O
   * nome antigo passou a mentir no instante em que nada mais é apagado, e nome
   * que mente é dívida: quem lê o relatório da sincronização concluiria que a
   * linha (e, por cascade, os vínculos) sumiu.
   *
   * Conta as linhas REALMENTE afetadas pelo UPDATE — isto é, os cancelamentos
   * NOVOS —, não o tamanho da lista de cancelados que o Google mandou. Os dois
   * números divergem de propósito: o payload inclui cancelados que não têm
   * linha local e cancelados que já estavam marcados. Ver o comentário no ponto
   * do UPDATE.
   */
  eventsCancelled: number;
}

/** Full sync orchestration for one connected account. */
export async function syncCalendarAccount(
  admin: SupabaseClient,
  account: { id: string; user_id: string },
): Promise<SyncResult> {
  const accessToken = await getAccessToken(admin, account.id);

  // 1. Upsert calendar sources from Google's calendar list.
  const calendars = await listCalendars(accessToken);
  const sourceRows = calendars.map((c) => ({
    user_id: account.user_id,
    calendar_account_id: account.id,
    google_calendar_id: c.id,
    summary: c.summary ?? null,
    description: c.description ?? null,
    timezone: c.timeZone ?? null,
    access_role: c.accessRole ?? null,
    background_color: c.backgroundColor ?? null,
    is_primary: c.primary ?? false,
  }));
  if (sourceRows.length > 0) {
    await admin
      .from("calendar_sources")
      .upsert(sourceRows, { onConflict: "calendar_account_id,google_calendar_id" });
  }

  const { data: sources } = await admin
    .from("calendar_sources")
    .select("id, google_calendar_id, next_sync_token, is_enabled")
    .eq("calendar_account_id", account.id);

  let eventsUpserted = 0;
  let eventsCancelled = 0;

  for (const source of sources ?? []) {
    if (source.is_enabled === false) continue;

    let result: { events: GoogleEvent[]; nextSyncToken: string | null };
    try {
      result = await listEvents(accessToken, source.google_calendar_id as string, {
        syncToken: source.next_sync_token as string | null,
      });
    } catch (err) {
      if (err instanceof Error && err.message === "SYNC_TOKEN_GONE") {
        // 410 Gone: drop the stale token and do a fresh full sync.
        await admin
          .from("calendar_sources")
          .update({ next_sync_token: null })
          .eq("id", source.id as string);
        result = await listEvents(accessToken, source.google_calendar_id as string, {
          syncToken: null,
        });
      } else {
        throw err;
      }
    }

    const plano = planejarSync(result.events, {
      userId: account.user_id,
      accountId: account.id,
      sourceId: source.id as string,
    });

    if (plano.paraUpsert.length > 0) {
      // O upsert por (calendar_source_id, google_event_id) reescreve TODAS as
      // colunas da linha existente, `status` inclusive. É por isso que a
      // ressurreição funciona sem código próprio: um evento que estava com
      // status = 'cancelled' localmente e voltou a valer no Google chega aqui
      // como 'confirmed' e sai do estado cancelado sozinho — mesmo caminho da
      // ida. E como o uuid local (`calendar_events.id`) é preservado pelo
      // upsert, os vínculos que apontam para ele continuam válidos nos dois
      // sentidos. Ver o comentário de `status` em mapEventRow.
      //
      // O `error` NÃO pode ser descartado. Logo abaixo o `next_sync_token`
      // avança, e a coleta incremental só devolve o que mudou DESDE o token: o
      // evento cuja escrita falhou não volta no payload seguinte, porque nada
      // mudou nele no Google. Engolir o erro aqui grava uma divergência
      // PERMANENTE com relatório de sucesso. Lançar aborta antes do token —
      // quem chama (rota de sync e callback do OAuth) marca a conta com
      // status 'error' e a próxima rodada reprocessa a mesma janela.
      const { error: erroUpsert } = await admin
        .from("calendar_events")
        .upsert(plano.paraUpsert, { onConflict: "calendar_source_id,google_event_id" });
      if (erroUpsert) throw new Error(`Falha ao gravar eventos: ${erroUpsert.message}`);
      eventsUpserted += plano.paraUpsert.length;
    }

    // Lote a lote — ver IDS_POR_LOTE_DE_CANCELAMENTO. Com a lista vazia o laço
    // simplesmente não executa nenhuma volta, que é o retorno cedo de graça.
    for (let i = 0; i < plano.paraCancelar.length; i += IDS_POR_LOTE_DE_CANCELAMENTO) {
      const lote = plano.paraCancelar.slice(i, i + IDS_POR_LOTE_DE_CANCELAMENTO);
      // SOFT DELETE. Antes isto era `.delete()`, e com as tabelas de vínculo da
      // 0009 (`on delete cascade`) apagar a linha levaria junto, em silêncio,
      // todo "esta tarefa nasceu daquela reunião". Marcar preserva o histórico;
      // a faxina periódica documentada no fim da 0009 é que remove o cancelado
      // ANTIGO e SEM VÍNCULO.
      //
      // `.select("id")` não é enfeite: sem ele o PostgREST devolve
      // `error: null` e nenhuma informação sobre quantas linhas mudaram, e a
      // contagem viraria chute. E as duas contagens divergem MESMO, sem que
      // isso seja erro: um evento criado e cancelado ENTRE duas sincronizações
      // chega no payload como cancelado sem nunca ter tido linha local, então o
      // UPDATE não casa nada. Contar o tamanho da lista de entrada reportaria
      // um cancelamento que não aconteceu no banco.
      //
      // O `.or(...)` exclui quem JÁ está cancelado, por dois motivos. Primeiro,
      // custo: a coleta completa (sem syncToken) usa showDeleted=true e traz os
      // cancelados da janela A CADA RODADA — sem o filtro, cada sincronização
      // reescreveria as mesmas linhas na tabela de escrita mais pesada do
      // projeto. Segundo, semântica: o trigger set_updated_at toca `updated_at`
      // em toda escrita, e a faxina da 0009 usa esse campo como carência de 180
      // dias. Reescrever o já-cancelado adiaria a faxina para sempre.
      //
      // A forma do filtro é a NULL-SAFE, e não um `.neq("status","cancelled")`:
      // `status` é anulável e `status <> 'cancelled'` avalia para NULL — não
      // para TRUE — na linha de status nulo, que então NÃO seria atualizada.
      // Seria o pior caso possível: o evento cancelado no Google ficaria
      // eternamente visível na agenda, e em silêncio.
      //
      // E o `error` é obrigatório pelo mesmo motivo do upsert acima: sem ele,
      // um PATCH que falhou (414, timeout, PostgREST momentaneamente fora)
      // devolve `canceladas` nulo, soma zero e deixa o fluxo seguir até gravar
      // o `next_sync_token`. Como a coleta incremental só traz o que mudou
      // desde o token, aquele cancelamento NUNCA MAIS aparece no payload: a
      // reunião desmarcada no Google fica 'confirmed' na tabela local para
      // sempre, visível na agenda e em getUpcomingEvents, com o relatório da
      // sincronização informando sucesso e zero cancelamentos.
      const { data: canceladas, error: erroCancelamento } = await admin
        .from("calendar_events")
        .update({ status: "cancelled" })
        .eq("calendar_source_id", source.id as string)
        .in("google_event_id", lote)
        .or("status.is.null,status.neq.cancelled")
        .select("id");
      if (erroCancelamento) {
        throw new Error(`Falha ao cancelar eventos: ${erroCancelamento.message}`);
      }
      eventsCancelled += canceladas?.length ?? 0;
    }

    // Só se chega aqui com TODAS as escritas desta fonte confirmadas: os dois
    // `throw` acima existem para que o token nunca avance sobre uma alteração
    // que não entrou no banco. O erro deste UPDATE, por outro lado, é inócuo —
    // o token velho continua valendo e a próxima rodada reprocessa a janela.
    if (result.nextSyncToken) {
      await admin
        .from("calendar_sources")
        .update({ next_sync_token: result.nextSyncToken })
        .eq("id", source.id as string);
    }
  }

  await admin
    .from("calendar_accounts")
    .update({ last_synced_at: new Date().toISOString(), status: "connected", last_error: null })
    .eq("id", account.id);

  return { calendarsSynced: (sources ?? []).length, eventsUpserted, eventsCancelled };
}
