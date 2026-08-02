import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isGoogleConfigured } from "@/lib/env";
import { verificarSegredoDeCron } from "@/lib/cron-auth";
import { syncCalendarAccount } from "@/lib/google/calendar";
import { calendarSyncBodySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Teto do corpo. Um `{ "accountId": "<uuid>" }` tem ~50 bytes. */
const MAX_BODY_BYTES = 1024;

type Conta = { id: string; user_id: string };

function erro(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

/**
 * Lê o corpo com TETO REAL, contando bytes conforme eles chegam.
 *
 * `await request.text()` seguido de `if (texto.length > teto)` não protege: para
 * medir, ele já materializou tudo na memória. A verificação só teria efeito
 * depois do gasto que deveria evitar. Aqui o laço cancela o fluxo no primeiro
 * pedaço que estoura, então nada além do teto é alocado.
 *
 * `Content-Length` não é conferido de propósito: é um cabeçalho que o cliente
 * escreve, e com `Transfer-Encoding: chunked` ele nem existe. Confiar nele
 * seria checar a declaração em vez do fato. A contagem abaixo mede o fato e
 * dispensa a declaração.
 *
 * Devolve `null` quando estourou.
 */
async function lerCorpoComTeto(request: NextRequest, teto: number): Promise<string | null> {
  const fluxo = request.body;
  if (!fluxo) return "";

  const leitor = fluxo.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      total += value.byteLength;
      if (total > teto) {
        await leitor.cancel();
        return null;
      }
      partes.push(value);
    }
  } finally {
    leitor.releaseLock();
  }

  const juntos = new Uint8Array(total);
  let posicao = 0;
  for (const parte of partes) {
    juntos.set(parte, posicao);
    posicao += parte.byteLength;
  }
  return new TextDecoder().decode(juntos);
}

type LeituraDoCorpo =
  | { ok: true; accountId?: string }
  | { ok: false; status: number; error: string };

/**
 * Só é chamada DEPOIS de a sessão estar confirmada. Ver o comentário do POST.
 */
async function lerCorpoDaSessao(request: NextRequest): Promise<LeituraDoCorpo> {
  const tipo = (request.headers.get("content-type") ?? "").toLowerCase();
  // `startsWith` e não igualdade: o cabeçalho legítimo costuma vir com
  // parâmetro ("application/json; charset=utf-8").
  if (!tipo.startsWith("application/json")) {
    return { ok: false, status: 415, error: "unsupported_media_type" };
  }

  const texto = await lerCorpoComTeto(request, MAX_BODY_BYTES);
  if (texto === null) return { ok: false, status: 413, error: "payload_too_large" };

  // Corpo vazio continua valendo "sincronizar todas as minhas contas" — era o
  // comportamento anterior e o `GET` do agendador depende dele.
  if (texto.trim() === "") return { ok: true };

  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return { ok: false, status: 400, error: "invalid_body" };
  }

  const parsed = calendarSyncBodySchema.safeParse(bruto);
  if (!parsed.success) return { ok: false, status: 400, error: "invalid_body" };
  return { ok: true, accountId: parsed.data.accountId };
}

/**
 * Sincronização do Google Agenda. Corpo: { accountId?: string }.
 *
 * DOIS CHAMADORES, DUAS AUTENTICAÇÕES — e a diferença importa:
 *
 *   1. O USUÁRIO clicando "Sincronizar agora". Autentica por sessão, e a
 *      leitura das contas passa pelo cliente com RLS: ele só alcança as contas
 *      dele. Sem `accountId`, sincroniza todas as contas conectadas DELE.
 *   2. Um AGENDADOR (cron), autenticando com `CRON_SECRET`. Não tem sessão —
 *      é um robô, não uma pessoa —, então lê as contas com o cliente
 *      administrativo e sincroniza as contas conectadas de TODO MUNDO. É o
 *      ponto todo de existir um job: manter a agenda em dia sem ninguém
 *      precisar abrir a aplicação.
 *
 * =============================================================================
 * A ORDEM DAS OPERAÇÕES É A CORREÇÃO (SB-SEC-011)
 * =============================================================================
 * Esta rota é ISENTA do portão de sessão do middleware — precisa ser, senão o
 * robô sem cookie levaria redirecionamento para /login antes de apresentar o
 * segredo. Isso a torna o único caminho da aplicação que um anônimo alcança de
 * fato, e é por isso que a ordem aqui é uma fronteira de segurança e não estilo.
 *
 * A versão anterior fazia `await request.json()` ANTES de checar a sessão.
 * Consequência: qualquer pessoa na internet, sem credencial nenhuma, fazia o
 * servidor desserializar um JSON arbitrário — trabalho de CPU e memória
 * concedido antes de qualquer autorização, que é o alicerce de um ataque de
 * exaustão. O 401 chegava, mas chegava depois do custo.
 *
 * Agora nenhum ramo toca no corpo sem autorização:
 *   - credencial de cron ERRADA morre em 401 antes de tudo;
 *   - o ramo do CRON nem lê o corpo — ver a nota sobre `accountId` ignorado;
 *   - o ramo da SESSÃO só lê depois de `getUser()` devolver usuário.
 *
 * `createAdminClient()` também fica depois da autorização: ele LANÇA quando a
 * chave de serviço não está configurada, e um 500 antes do 401 contaria a um
 * anônimo algo sobre a configuração do servidor.
 *
 * POR QUE A CREDENCIAL ERRADA NÃO CAI NO CAMINHO DA SESSÃO: quem manda
 * cabeçalho de cron está se declarando robô. Deixá-lo tentar a sessão depois
 * transformaria a rota num oráculo — daria para distinguir "segredo errado" de
 * "segredo certo, sessão ausente" pelo formato da resposta, e é assim que se
 * sonda um endpoint. Credencial apresentada e inválida morre em 401 na hora.
 *
 * PARA O CHAMADOR 2 EXISTIR DE VERDADE, duas coisas fora deste arquivo:
 *   - o middleware precisa deixar a requisição chegar aqui. Ver
 *     SELF_AUTHENTICATED_PATHS em src/lib/supabase/middleware.ts;
 *   - o agendador precisa estar declarado. Ver vercel.json.
 */
export async function POST(request: NextRequest) {
  if (!isGoogleConfigured()) {
    return erro(400, "not_configured");
  }

  const cron = verificarSegredoDeCron(request);
  if (cron === "invalida") {
    return erro(401, "unauthorized");
  }

  let contas: Conta[] = [];
  let admin: ReturnType<typeof createAdminClient>;

  if (cron === "valida") {
    /*
      Caminho do agendador. Sem sessão não existe "minhas contas", então o
      alvo é toda conta conectada.

      O CORPO NÃO É LIDO AQUI — nem para descartar. Aceitar `accountId` daria a
      quem tem o segredo um jeito de sincronizar uma conta arbitrária por id, o
      que não serve a nenhum job real e amplia o estrago de um segredo vazado.
      E como o `GET` do Vercel Cron delega para cá sem corpo nenhum, não ler é
      também o que faz o agendador funcionar sem tratamento especial.
    */
    admin = createAdminClient();
    const { data } = await admin
      .from("calendar_accounts")
      .select("id, user_id")
      .eq("status", "connected");
    contas = (data as Conta[] | null) ?? [];
  } else {
    // Caminho do usuário. PRIMEIRO a sessão.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return erro(401, "unauthorized");

    // Só agora o corpo. Um anônimo nunca chega nesta linha.
    const corpo = await lerCorpoDaSessao(request);
    if (!corpo.ok) return erro(corpo.status, corpo.error);

    admin = createAdminClient();

    // A leitura é feita com o cliente da SESSÃO, e é a RLS que garante o
    // recorte por dono — não o `.eq()`. Um `accountId` de outra pessoa
    // simplesmente não volta da consulta.
    const query = supabase.from("calendar_accounts").select("id, user_id");
    const { data } = corpo.accountId
      ? await query.eq("id", corpo.accountId)
      : await query.eq("status", "connected");
    contas = (data as Conta[] | null) ?? [];
  }

  if (contas.length === 0) {
    return erro(404, "no_accounts");
  }

  const results: Record<string, unknown> = {};

  for (const acc of contas) {
    try {
      results[acc.id] = await syncCalendarAccount(admin, {
        id: acc.id,
        user_id: acc.user_id,
      });
    } catch (err) {
      const message = String(err).slice(0, 300);
      const status = message.includes("invalid_grant") ? "expired" : "error";
      await admin.from("calendar_accounts").update({ status, last_error: message }).eq("id", acc.id);
      results[acc.id] = { error: message };
    }
  }

  return NextResponse.json({ ok: true, results });
}

/**
 * O Vercel Cron dispara GET — sempre, sem opção de configurar o método. Sem
 * este handler o job bateria em 405 e a rota continuaria sem agendador de fato,
 * mesmo com o middleware já deixando passar.
 *
 * GET AQUI É EXCLUSIVO DO ROBÔ, e a checagem é `!== "valida"` (não `===
 * "invalida"`): "ausente" também é recusado. Se GET caísse no caminho da
 * sessão, uma navegação qualquer do navegador do usuário — um clique em link,
 * um prefetch — dispararia sincronização, que escreve no banco. Efeito colateral
 * em GET é exatamente o que um CSRF explora. Quem não apresentou o segredo não
 * tem o que fazer aqui.
 */
export async function GET(request: NextRequest) {
  if (verificarSegredoDeCron(request) !== "valida") {
    return erro(401, "unauthorized");
  }
  // Delegar ao POST em vez de duplicar o corpo: ele revalida o segredo (mesma
  // requisição, mesmo veredito "valida") e segue pelo ramo do agendador, que
  // não toca no corpo — então a ausência de corpo num GET deixou de ser um caso
  // a tratar e passou a ser irrelevante.
  return POST(request);
}
