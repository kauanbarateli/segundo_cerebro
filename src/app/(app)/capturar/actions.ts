"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { captureInputSchema, captureUpdateSchema } from "@/lib/validation";
import { bloqueioPorLimite } from "@/lib/rate-limit";
import type { CaptureResult } from "@/lib/action-types";

function revalidate() {
  revalidatePath("/capturar");
  revalidatePath("/");
  revalidatePath("/tarefas");
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada");
  return { supabase, user };
}

export async function createCapture(input: {
  type: string;
  title?: string;
  content?: string;
  categoryId?: string;
  projectId?: string;
}): Promise<CaptureResult> {
  const parsed = captureInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const i = parsed.data;
  if (!i.title && !i.content) {
    return { ok: false, error: "Escreva algo para capturar." };
  }
  try {
    const { supabase, user } = await requireUser();

    /*
      Limite de taxa DEPOIS de identificar o usuário — a chave é o id dele, e
      ele só existe depois do `getUser()`. Antes disso não há por quem limitar
      (limitar por IP puniria o dono em rede móvel e não pararia ninguém).

      A captura é a porta mais larga da aplicação: um campo de texto, um botão,
      nenhuma outra validação além de "escreva algo". É onde um laço enche a
      tabela mais rápido. Ver src/lib/rate-limit.ts para o que este limite
      realmente cobre — e para o que ele NÃO cobre (memória por instância).
    */
    const bloqueio = bloqueioPorLimite("captura:criar", user.id);
    if (bloqueio) return bloqueio;

    const { data, error } = await supabase
      .from("captures")
      .insert({
        user_id: user.id,
        type: i.type,
        title: i.title,
        content: i.content,
        category_id: i.categoryId,
        project_id: i.projectId,
        status: "inbox",
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    revalidate();
    return { ok: true, id: data.id as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/**
 * Edita uma captura existente.
 *
 * Não há `.eq("user_id", user.id)` aqui de propósito: a RLS da tabela já
 * restringe o UPDATE ao dono, então repetir o filtro no cliente seria
 * redundante e, pior, sugeriria que a segurança mora nesta linha. O que a RLS
 * *não* dá é uma mensagem decente — um UPDATE que não casa com nenhuma linha
 * (id inexistente, ou de outro usuário, que para a RLS é a mesma coisa) volta
 * com `error: null` e zero linhas afetadas, ou seja, sucesso silencioso. Por
 * isso o `.select("id")`: ele obriga o PostgREST a devolver as linhas tocadas e
 * transforma "não fiz nada" em um erro visível.
 */
export async function updateCapture(input: {
  id: string;
  type: string;
  title?: string;
  content?: string;
  categoryId?: string;
  projectId?: string;
}): Promise<CaptureResult> {
  const parsed = captureUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const i = parsed.data;
  // Mesma regra do create: uma captura sem título e sem conteúdo não é um
  // rascunho, é lixo — e editar não pode ser a porta dos fundos para criá-lo.
  if (!i.title && !i.content) {
    return { ok: false, error: "Escreva algo para capturar." };
  }
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("captures")
      .update({
        type: i.type,
        title: i.title,
        content: i.content,
        category_id: i.categoryId,
        project_id: i.projectId,
      })
      .eq("id", i.id)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) {
      return { ok: false, error: "Captura não encontrada." };
    }
    revalidate();
    return { ok: true, id: i.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/**
 * Converte a captura em tarefa pela função transacional do banco.
 *
 * Não precisa da checagem de "0 linhas" das outras actions: a função SQL levanta
 * exceção em "capture not found" e "not authorized", então o erro chega de
 * verdade. Só falta barrar o id malformado na borda — sem isso o cast estoura no
 * Postgres e a mensagem crua do banco vai parar no toast do usuário.
 */
export async function convertCaptureToTask(captureId: string): Promise<CaptureResult> {
  const parsedId = z.string().uuid().safeParse(captureId);
  if (!parsedId.success) {
    return { ok: false, error: "Captura não encontrada." };
  }
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("convert_capture_to_task", {
      p_capture_id: parsedId.data,
    });
    if (error) return { ok: false, error: error.message };
    revalidate();
    return { ok: true, id: data as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/**
 * Tira a captura da caixa de entrada sem apagar o registro.
 *
 * Vale as mesmas duas proteções de updateCapture e deleteCapturePermanently, e
 * pelos mesmos motivos: server action é endpoint HTTP, então o `captureId` pode
 * chegar com qualquer coisa dentro, e um UPDATE que não casa com nenhuma linha
 * volta do PostgREST com `error: null` — sucesso silencioso.
 */
export async function archiveCapture(captureId: string): Promise<CaptureResult> {
  // Sem esta validação, um id malformado não vira "0 linhas": vira erro de cast
  // do Postgres, e a string `invalid input syntax for type uuid: "abc"` iria
  // crua para dentro do toast do usuário.
  const parsed = z.string().uuid().safeParse(captureId);
  if (!parsed.success) {
    return { ok: false, error: "Captura não encontrada." };
  }
  try {
    const { supabase } = await requireUser();
    // `.select("id")` obriga o PostgREST a devolver as linhas tocadas. Sem ele,
    // arquivar uma captura já apagada em outra aba — ou de outro usuário,
    // barrada pela RLS — devolvia `{ ok: true }` e o botão comemorava
    // "Arquivada" para uma operação que não mudou nada.
    const { data, error } = await supabase
      .from("captures")
      .update({ status: "archived" })
      .eq("id", parsed.data)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) {
      return { ok: false, error: "Captura não encontrada." };
    }
    revalidate();
    return { ok: true, id: parsed.data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/**
 * Exclusão definitiva — sem lixeira, a linha some do banco. Para tirar da
 * caixa de entrada sem perder o registro existe archiveCapture.
 *
 * ARMADILHA: apagar a captura NÃO apaga a tarefa que ela gerou, e é natural
 * supor o contrário porque existe uma FK ligando as duas. Só que a FK é
 * `captures.converted_task_id -> tasks (id) on delete set null`, e ela aponta
 * para o outro lado: quem tem cascata é a TAREFA. Apagar a tarefa zera o
 * vínculo na captura; apagar a captura não toca em tasks, porque nada em tasks
 * referencia captures. A linha de captures some e a tarefa continua viva, só
 * que sem origem — o que é o comportamento certo: uma vez convertida, a tarefa
 * virou compromisso próprio (tem prazo, posição no board, histórico) e não deve
 * evaporar porque alguém faxinou o rascunho que a originou. Se um dia excluir a
 * captura precisar levar a tarefa junto, isso é decisão de produto e tem que
 * ser escrita aqui, com um delete explícito em tasks antes deste — o banco não
 * vai fazer isso sozinho.
 */
export async function deleteCapturePermanently(id: string): Promise<CaptureResult> {
  // Validar o uuid antes de ir ao banco: um id malformado não vira "0 linhas",
  // vira erro de cast do Postgres ("invalid input syntax for type uuid") e essa
  // mensagem acabaria na tela do usuário.
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "Captura não encontrada." };
  }
  try {
    const { supabase } = await requireUser();
    // `.select("id")` pelo mesmo motivo do updateCapture: DELETE que não casa
    // com nenhuma linha (id de outro usuário, barrado pela RLS, ou já apagado)
    // volta sem erro. Sem isso, a interface comemoraria uma exclusão que não
    // aconteceu.
    const { data, error } = await supabase
      .from("captures")
      .delete()
      .eq("id", parsed.data)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) {
      return { ok: false, error: "Captura não encontrada." };
    }
    revalidate();
    return { ok: true, id: parsed.data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}
