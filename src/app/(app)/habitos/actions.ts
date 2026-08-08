"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { bloqueioPorLimite } from "@/lib/rate-limit";
import {
  ID_INVALIDO,
  habitPauseSchema,
  habitSchema,
  habitToggleSchema,
  lerUuid,
} from "@/lib/validation";
import type { ActionResult } from "@/lib/action-types";

/**
 * Server actions do módulo Hábitos.
 *
 * Toda função aqui é um ENDPOINT HTTP: o `input` chega da rede e não do
 * formulário. Zod primeiro, sempre, e o id validado como uuid ANTES de tocar no
 * banco — o Postgres devolve "invalid input syntax for type uuid" para lixo, e
 * isso vira toast em inglês.
 *
 * A RLS filtra por dono; o código não repete `user_id` nas leituras. Nas
 * ESCRITAS o `user_id` é gravado a partir da sessão, nunca do input.
 */

async function exigirUsuario() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

/** As duas telas que mostram hábito. Revalidar só uma deixaria a outra velha. */
function revalidar() {
  revalidatePath("/habitos");
  revalidatePath("/");
}

export async function createHabit(input: unknown): Promise<ActionResult> {
  const parsed = habitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, user } = await exigirUsuario();
  if (!user) return { ok: false, error: "Sessão expirada" };

  const bloqueio = bloqueioPorLimite("habitos:escrita", user.id);
  if (bloqueio) return bloqueio;

  const { data, error } = await supabase
    .from("habits")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      color_key: parsed.data.colorKey,
      schedule_kind: parsed.data.scheduleKind,
      weekdays: parsed.data.weekdays,
      weekly_target: parsed.data.weeklyTarget,
      started_on: parsed.data.startedOn,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 é violação de UNIQUE. O índice único é por nome entre os ATIVOS —
    // dois "Ler" na mesma tela mostrariam duas sequências para o que a pessoa
    // pensa ser uma coisa só.
    if (error.code === "23505") return { ok: false, error: "Já existe um hábito com esse nome." };
    return { ok: false, error: "Não foi possível criar o hábito." };
  }

  revalidar();
  return { ok: true, id: data.id };
}

export async function updateHabit(id: unknown, input: unknown): Promise<ActionResult> {
  const habitId = lerUuid(id);
  if (!habitId) return { ok: false, error: ID_INVALIDO };

  const parsed = habitSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, user } = await exigirUsuario();
  if (!user) return { ok: false, error: "Sessão expirada" };

  const bloqueio = bloqueioPorLimite("habitos:escrita", user.id);
  if (bloqueio) return bloqueio;

  /*
    ⚠️ A LISTA DE COLUNAS É EXPLÍCITA, e não um espalhamento do input.

    `update({ ...input })` deixaria o cliente escolher a coluna: `user_id`,
    `created_at`, qualquer coisa. A whitelist é o que faz "o cliente manda os
    dados" não virar "o cliente manda no banco". É o mesmo padrão das outras
    actions do projeto.

    Não há `.eq("user_id", ...)`: a RLS de update já compara `auth.uid()` no
    `using` E no `with check`. Repetir aqui seria conforto, não segurança.
  */
  const { error } = await supabase
    .from("habits")
    .update({
      name: parsed.data.name,
      color_key: parsed.data.colorKey,
      schedule_kind: parsed.data.scheduleKind,
      weekdays: parsed.data.weekdays,
      weekly_target: parsed.data.weeklyTarget,
      started_on: parsed.data.startedOn,
    })
    .eq("id", habitId);

  if (error) {
    if (error.code === "23505") return { ok: false, error: "Já existe um hábito com esse nome." };
    return { ok: false, error: "Não foi possível salvar o hábito." };
  }

  revalidar();
  return { ok: true, id: habitId };
}

/**
 * Arquivar, e não apagar.
 *
 * Apagar levaria junto o histórico inteiro (`on delete cascade` em
 * `habit_entries`), e num segundo cérebro isso é porta de mão única. Arquivado
 * some da tela, para de contar, e o passado continua lá.
 */
export async function archiveHabit(id: unknown): Promise<ActionResult> {
  const habitId = lerUuid(id);
  if (!habitId) return { ok: false, error: ID_INVALIDO };

  const { supabase, user } = await exigirUsuario();
  if (!user) return { ok: false, error: "Sessão expirada" };

  const bloqueio = bloqueioPorLimite("habitos:escrita", user.id);
  if (bloqueio) return bloqueio;

  const { error } = await supabase
    .from("habits")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", habitId);

  if (error) return { ok: false, error: "Não foi possível arquivar." };
  revalidar();
  return { ok: true, id: habitId };
}

/**
 * Desarquivar: devolve o hábito à lista ativa.
 *
 * Existe porque a exclusão passou a exigir arquivar antes (ver `deleteHabit`).
 * Sem a volta, arquivar viraria uma porta de mão única — e alguém que arquivou
 * por engano ficaria com a escolha entre excluir de vez ou recriar do zero,
 * perdendo o histórico das duas formas.
 */
export async function unarchiveHabit(id: unknown): Promise<ActionResult> {
  const habitId = lerUuid(id);
  if (!habitId) return { ok: false, error: ID_INVALIDO };

  const { supabase, user } = await exigirUsuario();
  if (!user) return { ok: false, error: "Sessão expirada" };

  const bloqueio = bloqueioPorLimite("habitos:escrita", user.id);
  if (bloqueio) return bloqueio;

  const { error } = await supabase
    .from("habits")
    .update({ archived_at: null })
    .eq("id", habitId);

  if (error) return { ok: false, error: "Não foi possível desarquivar." };
  revalidar();
  return { ok: true, id: habitId };
}

/**
 * Quanto histórico existe — para a CONFIRMAÇÃO poder dizer o que se perde.
 *
 * ============================================================================
 * POR QUE UMA CONSULTA SÓ PARA ISSO
 * ============================================================================
 * "Tem certeza?" não é uma pergunta: quem clicou já demonstrou intenção, e a
 * resposta é sempre sim. "Excluir «Ler 20 páginas» e 47 dias de histórico?" é
 * outra coisa — ela informa o TAMANHO do que está sendo destruído, que é a
 * única informação capaz de mudar a decisão de alguém.
 *
 * `head: true` com `count: "exact"`: o banco conta e não devolve linha nenhuma.
 * Trazer os 47 registros para contá-los no cliente seria trabalho para
 * descartar em seguida.
 */
export async function contarHistoricoDoHabito(
  id: unknown,
): Promise<{ ok: true; dias: number } | { ok: false; error: string }> {
  const habitId = lerUuid(id);
  if (!habitId) return { ok: false, error: ID_INVALIDO };

  const { supabase, user } = await exigirUsuario();
  if (!user) return { ok: false, error: "Sessão expirada" };

  // A RLS já filtra por dono; o `.eq` é sobre o hábito, não sobre o usuário.
  const { count, error } = await supabase
    .from("habit_entries")
    .select("id", { count: "exact", head: true })
    .eq("habit_id", habitId);

  if (error) return { ok: false, error: "Não foi possível ler o histórico." };
  return { ok: true, dias: count ?? 0 };
}

/**
 * EXCLUIR de verdade — e só a partir dos ARQUIVADOS.
 *
 * ============================================================================
 * ⚠️ POR QUE ARQUIVAR-DEPOIS-EXCLUIR, E NÃO EXCLUSÃO DIRETA
 * ============================================================================
 * Hábito não é um item qualquer: ele acumula sequência, marcações diárias e
 * pausas — meses de registro que não existem em nenhum outro lugar e que ninguém
 * consegue reconstruir de memória. Um botão "excluir" ao lado de "marcar hoje",
 * na mesma linha, no celular, é a distância de um dedo entre marcar o dia e
 * apagar o ano.
 *
 * As três opções e o que cada uma custa:
 *
 *   exclusão direta   um toque errado destrói histórico irrecuperável;
 *   soft delete       preserva tudo, mas nunca LIBERTA: o hábito criado por
 *                     engano continua no banco para sempre, e "excluir" passa a
 *                     ser mentira;
 *   arquivar → excluir  o destrutivo fica atrás de um passo deliberado, e quem
 *                     chega lá já tirou o hábito da tela e viveu sem ele.
 *
 * A terceira ganha por um motivo específico: ela não inventa fluxo novo.
 * Arquivar já existia e já era o gesto de "não quero mais ver isto".
 *
 * ⚠️ A VERIFICAÇÃO DE `archived_at` É NO SERVIDOR, e precisa ser. Esconder o
 * botão na interface é conveniência; server action é ENDPOINT HTTP, e quem
 * chamar `deleteHabit` direto não passa por interface nenhuma. O `.not(...
 * "is", null)` no próprio UPDATE faz a regra valer no banco: um hábito ativo
 * simplesmente não casa com o filtro, e nada é apagado.
 *
 * O histórico some junto por CASCADE, declarado na 0018 (`habit_entries` e
 * `habit_pauses` com `on delete cascade` em `habit_id`). Não há limpeza manual
 * aqui de propósito: apagar em três passos abriria a janela em que a exclusão
 * falha no meio e deixa marcações órfãs apontando para um hábito que não existe.
 */
export async function deleteHabit(id: unknown): Promise<ActionResult> {
  const habitId = lerUuid(id);
  if (!habitId) return { ok: false, error: ID_INVALIDO };

  const { supabase, user } = await exigirUsuario();
  if (!user) return { ok: false, error: "Sessão expirada" };

  const bloqueio = bloqueioPorLimite("habitos:escrita", user.id);
  if (bloqueio) return bloqueio;

  const { data, error } = await supabase
    .from("habits")
    .delete()
    .eq("id", habitId)
    .not("archived_at", "is", null)
    .select("id");

  if (error) return { ok: false, error: "Não foi possível excluir." };

  /*
    Zero linha significa "não estava arquivado" OU "não existe" OU "é de outro
    usuário" — e a mensagem é a MESMA para os três de propósito. Distinguir
    "este hábito existe mas é de outra pessoa" de "não existe" confirmaria a
    existência de um id para quem está sondando.
  */
  if (!data || data.length === 0) {
    return { ok: false, error: "Arquive o hábito antes de excluí-lo." };
  }

  revalidar();
  return { ok: true, id: habitId };
}

/**
 * MARCAR OU DESMARCAR um dia.
 *
 * ============================================================================
 * ⚠️ O DIA VEM DO CLIENTE, E ISSO É DELIBERADO
 * ============================================================================
 * Só o navegador sabe em que dia a pessoa está. `current_date` no servidor
 * gravaria o dia errado toda noite depois das 21h — a Vercel roda em UTC, e São
 * Paulo está três horas atrás. Marcar um hábito às 22h registraria amanhã.
 *
 * A contrapartida é o TETO DE DISTÂNCIA abaixo: sem ele, um cliente adulterado
 * marcaria o ano 3000 e o painel passaria a mostrar sequência de mil dias. O
 * teto aceita retroagir (marcar ontem depois do fato é um gesto legítimo e
 * frequente) e recusa o futuro, que não é gesto nenhum.
 *
 * ============================================================================
 * DESMARCAR É `DELETE`
 * ============================================================================
 * Não existe linha "falhou" nesta tabela — ver o cabeçalho da 0018. Desmarcar é
 * apagar a linha, e o passado volta a ser o que era.
 */
export async function toggleHabitDay(input: unknown): Promise<ActionResult> {
  const parsed = habitToggleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, user } = await exigirUsuario();
  if (!user) return { ok: false, error: "Sessão expirada" };

  // Mais folgado que o padrão: marcar cinco hábitos seguidos é um gesto de dez
  // segundos, e um limite apertado aqui viraria "o app parou" no meio da
  // rotina da manhã.
  const bloqueio = bloqueioPorLimite("habitos:marcar", user.id, {
    maximo: 60,
    janelaMs: 60_000,
  });
  if (bloqueio) return bloqueio;

  const hoje = new Date().toISOString().slice(0, 10);
  // Uma folga de dois dias no futuro absorve qualquer divergência de fuso entre
  // o relógio do navegador e o do servidor, sem abrir a porta para o ano 3000.
  if (parsed.data.dia > somarDiasIso(hoje, 2)) {
    return { ok: false, error: "Não dá para marcar um dia no futuro." };
  }

  const { data: existente } = await supabase
    .from("habit_entries")
    .select("id")
    .eq("habit_id", parsed.data.habitId)
    .eq("done_on", parsed.data.dia)
    .maybeSingle();

  if (existente) {
    const { error } = await supabase.from("habit_entries").delete().eq("id", existente.id);
    if (error) return { ok: false, error: "Não foi possível desmarcar." };
    revalidar();
    return { ok: true, id: existente.id };
  }

  const { data, error } = await supabase
    .from("habit_entries")
    .insert({
      user_id: user.id,
      habit_id: parsed.data.habitId,
      done_on: parsed.data.dia,
    })
    .select("id")
    .single();

  if (error) {
    /*
      23505 é a UNIQUE (habit_id, done_on): duas abas marcaram o mesmo dia ao
      mesmo tempo, e a segunda perdeu a corrida entre o SELECT e o INSERT acima.
      O estado final é o desejado — o dia está marcado —, então isto é sucesso,
      não erro. Devolver falha aqui faria a tela desfazer uma marcação correta.

      23503 é a FK / a trigger de dono: hábito que não existe ou não é seu.
    */
    if (error.code === "23505") {
      revalidar();
      return { ok: true };
    }
    if (error.code === "23503") return { ok: false, error: ID_INVALIDO };
    return { ok: false, error: "Não foi possível marcar." };
  }

  revalidar();
  return { ok: true, id: data.id };
}

/** Soma dias a "AAAA-MM-DD" sem passar pelo fuso do processo. */
function somarDiasIso(chave: string, n: number): string {
  const [a, m, d] = chave.split("-").map(Number);
  const data = new Date(Date.UTC(a!, m! - 1, d!));
  data.setUTCDate(data.getUTCDate() + n);
  return data.toISOString().slice(0, 10);
}

export async function createHabitPause(input: unknown): Promise<ActionResult> {
  const parsed = habitPauseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, user } = await exigirUsuario();
  if (!user) return { ok: false, error: "Sessão expirada" };

  const bloqueio = bloqueioPorLimite("habitos:escrita", user.id);
  if (bloqueio) return bloqueio;

  const { data, error } = await supabase
    .from("habit_pauses")
    .insert({
      user_id: user.id,
      habit_id: parsed.data.habitId ?? null,
      starts_on: parsed.data.startsOn,
      ends_on: parsed.data.endsOn ?? null,
      reason: parsed.data.reason,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: "Não foi possível registrar a pausa." };
  revalidar();
  return { ok: true, id: data.id };
}

export async function deleteHabitPause(id: unknown): Promise<ActionResult> {
  const pauseId = lerUuid(id);
  if (!pauseId) return { ok: false, error: ID_INVALIDO };

  const { supabase, user } = await exigirUsuario();
  if (!user) return { ok: false, error: "Sessão expirada" };

  const bloqueio = bloqueioPorLimite("habitos:escrita", user.id);
  if (bloqueio) return bloqueio;

  const { error } = await supabase.from("habit_pauses").delete().eq("id", pauseId);
  if (error) return { ok: false, error: "Não foi possível remover a pausa." };
  revalidar();
  return { ok: true, id: pauseId };
}
