import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isGoogleConfigured } from "@/lib/env";
import { verificarSegredoDeCron } from "@/lib/cron-auth";
import { syncCalendarAccount } from "@/lib/google/calendar";

export const dynamic = "force-dynamic";

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
 * O comentário anterior deste arquivo dizia que "um job futuro usaria o
 * CRON_SECRET". Ele agora usa — e a validação está em src/lib/cron-auth.ts,
 * com as duas armadilhas (comparação que vaza tempo, segredo vazio liberando
 * geral) explicadas lá.
 *
 * POR QUE A CREDENCIAL ERRADA NÃO CAI NO CAMINHO DA SESSÃO: quem manda
 * cabeçalho de cron está se declarando robô. Deixá-lo tentar a sessão depois
 * transformaria a rota num oráculo — daria para distinguir "segredo errado" de
 * "segredo certo, sessão ausente" pelo formato da resposta, e é assim que se
 * sonda um endpoint. Credencial apresentada e inválida morre em 401 na hora.
 *
 * PARA O CHAMADOR 2 EXISTIR DE VERDADE, duas coisas fora deste arquivo:
 *   - o middleware precisa deixar a requisição chegar aqui. Requisição de robô
 *     não tem cookie, e o portão de sessão a redirecionava para /login antes de
 *     qualquer validação. Ver SELF_AUTHENTICATED_PATHS em
 *     src/lib/supabase/middleware.ts;
 *   - o agendador precisa estar declarado. Ver vercel.json.
 */
export async function POST(request: NextRequest) {
  if (!isGoogleConfigured()) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 400 });
  }

  const cron = verificarSegredoDeCron(request);
  if (cron === "invalida") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let accountId: string | undefined;
  try {
    const body = (await request.json()) as { accountId?: string };
    accountId = body.accountId;
  } catch {
    /* no body -> sync all */
  }

  // O cliente administrativo IGNORA a RLS e é o que executa a sincronização em
  // si (ele precisa alcançar os tokens cifrados em google_oauth_credentials,
  // que nenhuma sessão enxerga). Quem decide QUAIS contas ele toca é o bloco
  // abaixo — e essa decisão é a fronteira de segurança desta rota.
  const admin = createAdminClient();

  let accounts: { id: string; user_id: string }[] = [];

  if (cron === "valida") {
    /*
      Caminho do agendador. Sem sessão não existe "minhas contas", então o
      alvo é toda conta conectada.

      `accountId` do corpo é IGNORADO aqui de propósito: aceitá-lo daria a
      quem tem o segredo um jeito de sincronizar uma conta arbitrária por id,
      o que não serve a nenhum job real e amplia o estrago de um segredo
      vazado. O job quer "tudo que está conectado", e é só isso que ele pede.
    */
    const { data } = await admin
      .from("calendar_accounts")
      .select("id, user_id")
      .eq("status", "connected");
    accounts = (data as { id: string; user_id: string }[] | null) ?? [];
  } else {
    // Caminho do usuário. A leitura é feita com o cliente da SESSÃO, e é a RLS
    // que garante o recorte por dono — não o `.eq()`. Um `accountId` de outra
    // pessoa simplesmente não volta da consulta.
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const query = supabase.from("calendar_accounts").select("id, user_id");
    const { data } = accountId
      ? await query.eq("id", accountId)
      : await query.eq("status", "connected");
    accounts = (data as { id: string; user_id: string }[] | null) ?? [];
  }

  if (accounts.length === 0) {
    return NextResponse.json({ ok: false, error: "no_accounts" }, { status: 404 });
  }

  const results: Record<string, unknown> = {};

  for (const acc of accounts) {
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
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  // Delegar ao POST em vez de duplicar o corpo: ele revalida o segredo (mesma
  // requisição, mesmo veredito "valida") e segue pelo ramo do agendador. O
  // `request.json()` de lá falha por não haver corpo num GET, o que o próprio
  // POST já trata como "sincronizar tudo" — que é justamente o que o job quer.
  return POST(request);
}
