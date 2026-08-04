import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verificarSegredoDeCron } from "@/lib/cron-auth";
import { enviarEmail, resendConfigurado } from "@/lib/email/resend";
import {
  CONTAGENS_ZERADAS,
  assuntoDoEmail,
  corpoDoEmail,
  montarResumo,
  semanaAnterior,
  type ContagensDaSemana,
  type JanelaSemanal,
  type LinhaDoResumo,
} from "@/lib/metrics";
import { resumirHabitos, type Habito, type PausaHabito } from "@/lib/habits";

export const dynamic = "force-dynamic";

/**
 * =============================================================================
 * E-MAIL SEMANAL DE MÉTRICAS
 * =============================================================================
 * Roda pelo agendador da Vercel, segunda às 11h (ver `vercel.json`), e resume a
 * semana ANTERIOR — de segunda a domingo. A semana corrente, numa segunda de
 * manhã, tem horas de vida.
 *
 * =============================================================================
 * ⚠️ ESTA ROTA NÃO TEM CAMINHO DE SESSÃO. Só cron.
 * =============================================================================
 * A rota de sync do calendário aceita os dois (o usuário clica "Sincronizar
 * agora"). Aqui não existe botão equivalente: "mande o e-mail da semana
 * passada" não é um gesto que alguém faça na interface, e sustentar um segundo
 * caminho de autenticação por causa de um gesto que não existe é superfície de
 * graça.
 *
 * Consequência: credencial AUSENTE é recusada igual a credencial errada. Quem
 * chega aqui sem segredo é um anônimo, e a resposta é 401 nos dois casos.
 *
 * =============================================================================
 * ⚠️ A ORDEM DAS OPERAÇÕES É FRONTEIRA DE SEGURANÇA
 * =============================================================================
 * A rota é isenta do portão de sessão do middleware — precisa ser, senão o robô
 * sem cookie levaria redirecionamento para /login antes de apresentar o
 * segredo. Isso a torna alcançável por qualquer um na internet.
 *
 * Por isso a autorização vem PRIMEIRO, antes de `createAdminClient()` (que
 * LANÇA quando a chave de serviço falta — um 500 antes do 401 contaria a um
 * anônimo que a chave não está configurada) e antes de qualquer consulta.
 *
 * O corpo NUNCA é lido: esta rota não tem parâmetro nenhum. Não há
 * `request.json()` em lugar algum, então não existe o custo de desserializar
 * conteúdo de desconhecido antes de autorizar.
 */

function erro(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

/** Uma contagem, com `head: true` — traz o número sem trazer as linhas. */
async function contar(
  consulta: PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number> {
  const { count } = await consulta;
  return count ?? 0;
}

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Colhe os números da janela para UM usuário.
 *
 * Tudo em paralelo: são consultas independentes, e em série a execução
 * agendada pagaria a soma das latências por nada.
 *
 * ⚠️ `is_paid` e transferências no financeiro: `kind = 'transfer'` fica DE FORA
 * das duas somas. Uma transferência é a mesma quantia saindo de uma conta e
 * entrando em outra — contá-la infla entradas e saídas na mesma medida e faz o
 * resumo parecer um mês movimentado que não aconteceu. É a mesma regra que
 * `finance.ts` já aplica na tela.
 */
async function contarDaSemana(
  admin: Admin,
  userId: string,
  janela: JanelaSemanal,
  agoraIso: string,
): Promise<ContagensDaSemana> {
  const naJanela = <T extends { gte: (c: string, v: string) => T; lt: (c: string, v: string) => T }>(
    q: T,
    coluna: string,
  ) => q.gte(coluna, janela.inicioIso).lt(coluna, janela.fimIso);

  const [
    tarefasConcluidas,
    tarefasCriadas,
    tarefasAtrasadas,
    capturasCriadas,
    capturasProcessadas,
    paginasEditadas,
    eventos,
    lancamentos,
  ] = await Promise.all([
    contar(
      naJanela(
        admin
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("status", "done"),
        "completed_at",
      ),
    ),
    contar(
      naJanela(
        admin.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", userId),
        "created_at",
      ),
    ),
    // FOTO DO AGORA, não da semana — e a linha do resumo diz isso.
    contar(
      admin
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .in("status", ["todo", "in_progress"])
        .lt("due_at", agoraIso),
    ),
    contar(
      naJanela(
        admin.from("captures").select("id", { count: "exact", head: true }).eq("user_id", userId),
        "created_at",
      ),
    ),
    contar(
      naJanela(
        admin
          .from("captures")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("status", "organized"),
        "created_at",
      ),
    ),
    contar(
      naJanela(
        admin
          .from("knowledge_pages")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .is("deleted_at", null),
        "updated_at",
      ),
    ),
    contar(
      naJanela(
        admin
          .from("calendar_events")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .neq("status", "cancelled"),
        "start_at",
      ),
    ),
    admin
      .from("finance_transactions")
      .select("kind, amount_cents")
      .eq("user_id", userId)
      .neq("kind", "transfer")
      .gte("occurred_on", janela.inicio)
      .lte("occurred_on", janela.fim),
  ]);

  let financeiroEntradas = 0;
  let financeiroSaidas = 0;
  for (const linha of lancamentos.data ?? []) {
    if (linha.kind === "income") financeiroEntradas += linha.amount_cents;
    else if (linha.kind === "expense") financeiroSaidas += linha.amount_cents;
  }

  return {
    ...CONTAGENS_ZERADAS,
    tarefasConcluidas,
    tarefasCriadas,
    tarefasAtrasadas,
    capturasCriadas,
    capturasProcessadas,
    paginasEditadas,
    eventos,
    financeiroEntradas,
    financeiroSaidas,
  };
}

/**
 * A linha de Hábitos do resumo.
 *
 * ⚠️ CONSOME O MESMO `src/lib/habits.ts` QUE A TELA. É o ponto todo daquele
 * módulo ser puro e não importar `server-only`: duas implementações da mesma
 * conta é como um dia a tela diz 18, o e-mail diz 19, e ninguém sabe qual está
 * certo.
 *
 * Devolve `[]` quando não há hábito nenhum — a linha simplesmente não aparece,
 * em vez de dizer "Hábitos: 0 de 0".
 */
async function linhaDeHabitos(
  admin: Admin,
  userId: string,
  janela: JanelaSemanal,
): Promise<LinhaDoResumo[]> {
  const [habitos, marcacoes, pausas] = await Promise.all([
    admin
      .from("habits")
      .select("id, name, schedule_kind, weekdays, weekly_target, started_on, archived_at")
      .eq("user_id", userId)
      .is("archived_at", null),
    admin
      .from("habit_entries")
      .select("habit_id, done_on")
      .eq("user_id", userId)
      .gte("done_on", janela.inicio)
      .lte("done_on", janela.fim),
    admin
      .from("habit_pauses")
      .select("habit_id, starts_on, ends_on")
      .eq("user_id", userId)
      .or(`ends_on.is.null,ends_on.gte.${janela.inicio}`),
  ]);

  const regras = (habitos.data ?? []) as Habito[];
  if (regras.length === 0) return [];

  const feitos = new Map<string, Set<string>>();
  for (const m of marcacoes.data ?? []) {
    const conjunto = feitos.get(m.habit_id) ?? new Set<string>();
    conjunto.add(m.done_on);
    feitos.set(m.habit_id, conjunto);
  }

  /*
    O "hoje" passado é o ÚLTIMO DIA DA JANELA, não a data real.

    A semana resumida já fechou, então nenhum dia dela está "em aberto" — e
    `resumirHabitos` usa `hoje` justamente para não contar o dia corrente como
    falha. Passar a data de verdade (segunda-feira) faria a função tratar a
    semana inteira como passado, o que é o certo, mas por acidente. Passar o
    domingo diz a mesma coisa de propósito.
  */
  const resumo = resumirHabitos(
    regras,
    feitos,
    janela.inicio,
    janela.fim,
    janela.fim,
    (pausas.data ?? []) as PausaHabito[],
  );

  const melhor = resumo.porHabito
    .filter((r) => r.sequenciaAtual > 0)
    .sort((a, b) => b.sequenciaAtual - a.sequenciaAtual)[0];

  return [
    {
      rotulo: "Hábitos",
      valor: `${resumo.cumpridos} de ${resumo.esperados}`,
      detalhe: [
        resumo.taxa !== null ? `${resumo.taxa}%` : null,
        resumo.falhas > 0 ? `${resumo.falhas} falhas` : null,
        melhor ? `melhor sequência: ${melhor.habito.name} (${melhor.sequenciaAtual})` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    },
  ];
}

async function despachar(request: NextRequest) {
  // 1. AUTORIZAÇÃO, antes de tudo. Ver o cabeçalho.
  const cron = verificarSegredoDeCron(request);
  if (cron !== "valida") return erro(401, "unauthorized");

  // 2. Configuração. Sem chave da Resend não há o que fazer, e é importante NÃO
  //    reservar a janela antes de descobrir isso: uma reserva sem envio queima
  //    a semana para sempre, por causa da UNIQUE.
  if (!resendConfigurado()) return erro(503, "resend_nao_configurado");

  const admin = createAdminClient();
  const agora = new Date();
  const janela = semanaAnterior(agora);

  const { data: usuarios, error: erroUsuarios } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 100,
  });
  if (erroUsuarios) return erro(500, "falha_ao_listar_usuarios");

  const relatorio: { userId: string; resultado: string }[] = [];

  for (const usuario of usuarios?.users ?? []) {
    const destino = usuario.email;
    if (!destino) {
      relatorio.push({ userId: usuario.id, resultado: "sem_email" });
      continue;
    }

    /*
      3. RESERVA ANTES DE ENVIAR — é o que torna a idempotência atômica.

      `on conflict do nothing` acontece pelo `ignoreDuplicates` do upsert: se a
      linha já existe para (usuário, semana, canal), nada volta e o e-mail não
      sai. Reservar DEPOIS do envio deixaria aberta a janela entre "enviei" e
      "registrei", e um segundo disparo caberia dentro dela.

      A consequência aceita: se a Resend falhar depois da reserva, a semana não
      é reenviada automaticamente. A linha fica com `error` e `delivered_at`
      nulo, e `metric_email_deliveries_falhas_idx` atende a consulta de "o que
      falhou". Para um resumo semanal esse é o lado certo de errar — um e-mail
      perdido aborrece, dois iguais ensinam a ignorar o remetente.
    */
    const { data: reserva } = await admin
      .from("metric_email_deliveries")
      .upsert(
        {
          user_id: usuario.id,
          period_start: janela.inicio,
          period_end: janela.fim,
          channel: "email",
          destination: destino,
        },
        { onConflict: "user_id,period_start,channel", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();

    if (!reserva) {
      relatorio.push({ userId: usuario.id, resultado: "ja_enviado" });
      continue;
    }

    const contagens = await contarDaSemana(admin, usuario.id, janela, agora.toISOString());
    const resumo = montarResumo(janela, contagens, await linhaDeHabitos(admin, usuario.id, janela));
    const corpo = corpoDoEmail(resumo);

    const envio = await enviarEmail({
      para: destino,
      assunto: assuntoDoEmail(resumo),
      html: corpo.html,
      texto: corpo.texto,
    });

    await admin
      .from("metric_email_deliveries")
      .update(
        envio.ok
          ? { delivered_at: new Date().toISOString(), error: null }
          : { error: envio.erro.slice(0, 500) },
      )
      .eq("id", reserva.id);

    relatorio.push({ userId: usuario.id, resultado: envio.ok ? "enviado" : "falhou" });
  }

  return NextResponse.json({ ok: true, semana: janela.rotulo, relatorio });
}

/**
 * GET e POST fazem a mesma coisa.
 *
 * O agendador da Vercel chama por GET. O POST existe para chamada manual com
 * `curl` — e para que trocar de agendador um dia não exija mexer aqui.
 *
 * ⚠️ Um GET com efeito colateral é incomum e merece a nota: ele é aceitável
 * porque a operação é IDEMPOTENTE por construção (a UNIQUE da 0019), então
 * repetir a chamada não repete o e-mail. Sem aquela trava, isto seria um erro.
 */
export const GET = despachar;
export const POST = despachar;
