"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { taskInputSchema, taskStatusSchema, lerUuid, ID_INVALIDO } from "@/lib/validation";
import { bloqueioPorLimite } from "@/lib/rate-limit";
import type { TaskStatus } from "@/lib/database.types";
import type { ActionResult } from "@/lib/action-types";

function revalidateAll() {
  revalidatePath("/tarefas");
  revalidatePath("/");
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada");
  return { supabase, user };
}

export async function createTask(formData: FormData): Promise<ActionResult> {
  const parsed = taskInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  try {
    const { supabase, user } = await requireUser();

    // Só a CRIAÇÃO é limitada. `moveTask` fica de fora de propósito: arrastar
    // cards no Kanban dispara muitas escritas seguidas por uso legítimo, e um
    // limite ali viraria "o quadro parou de funcionar" no meio de uma
    // reorganização. Criar tarefa, não: ninguém cria 30 por minuto à mão.
    const bloqueio = bloqueioPorLimite("tarefa:criar", user.id);
    if (bloqueio) return bloqueio;

    const i = parsed.data;
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        user_id: user.id,
        title: i.title,
        description: i.description,
        category_id: i.categoryId,
        project_id: i.projectId,
        priority: i.priority,
        status: i.status,
        due_at: i.dueAt,
        scheduled_start_at: i.scheduledStartAt,
        scheduled_end_at: i.scheduledEndAt,
        all_day: i.allDay,
        estimated_minutes: i.estimatedMinutes ?? null,
        source: "manual",
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    revalidateAll();
    return { ok: true, id: data.id as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

export async function updateTask(id: string, formData: FormData): Promise<ActionResult> {
  if (!lerUuid(id)) return { ok: false, error: ID_INVALIDO };
  const parsed = taskInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  try {
    const { supabase } = await requireUser();
    const i = parsed.data;
    const { error } = await supabase
      .from("tasks")
      .update({
        title: i.title,
        description: i.description,
        category_id: i.categoryId,
        project_id: i.projectId,
        priority: i.priority,
        status: i.status,
        due_at: i.dueAt,
        scheduled_start_at: i.scheduledStartAt,
        scheduled_end_at: i.scheduledEndAt,
        all_day: i.allDay,
        estimated_minutes: i.estimatedMinutes ?? null,
      })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

async function setStatus(id: string, status: TaskStatus): Promise<ActionResult> {
  if (!lerUuid(id)) return { ok: false, error: ID_INVALIDO };
  try {
    const { supabase } = await requireUser();
    const { error } = await supabase.from("tasks").update({ status }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

export async function completeTask(id: string): Promise<ActionResult> {
  return setStatus(id, "done");
}
export async function reopenTask(id: string): Promise<ActionResult> {
  return setStatus(id, "todo");
}
export async function archiveTask(id: string): Promise<ActionResult> {
  return setStatus(id, "archived");
}

/**
 * Move um card no Kanban.
 *
 * A posição usa índice fracionário: inserir entre A e B é (A+B)/2, então mover
 * custa 1 UPDATE, independente do tamanho da coluna. O trigger
 * `sync_task_lifecycle_timestamps` cuida de completed_at ao cair em "done".
 */
export async function moveTask(
  taskId: string,
  status: TaskStatus,
  beforeId: string | null,
  afterId: string | null,
): Promise<ActionResult> {
  /*
    Os quatro argumentos chegam pela rede: o tipo `TaskStatus` some na
    compilação e `beforeId`/`afterId` viram parte de um `.in(...)`.

    Os vizinhos são validados por FILTRO e não por recusa — de propósito. Eles
    são uma dica de posicionamento, não uma referência obrigatória: um vizinho
    que sumiu (outra aba concluiu a tarefa no meio do arrasto) já era tratado
    como ausente pelo cálculo abaixo. Recusar o movimento inteiro por causa de
    um id ruim seria mais rígido do que o recurso precisa; ignorar o id ruim
    cai no mesmo caminho que "não havia vizinho daquele lado".
  */
  if (!lerUuid(taskId)) return { ok: false, error: ID_INVALIDO };
  if (!taskStatusSchema.safeParse(status).success) {
    return { ok: false, error: "Coluna inválida." };
  }

  try {
    const { supabase } = await requireUser();

    const neighborIds = [beforeId, afterId].filter(
      (v): v is string => typeof v === "string" && lerUuid(v) !== null,
    );
    let prev: number | null = null;
    let next: number | null = null;

    if (neighborIds.length > 0) {
      const { data } = await supabase
        .from("tasks")
        .select("id, board_position")
        .in("id", neighborIds);

      const byId = new Map(
        (data ?? []).map((r) => [r.id as string, r.board_position as number | null]),
      );
      prev = beforeId ? (byId.get(beforeId) ?? null) : null;
      next = afterId ? (byId.get(afterId) ?? null) : null;
    }

    let position: number;
    if (prev != null && next != null) position = (prev + next) / 2;
    else if (prev != null) position = prev + 1;
    else if (next != null) position = next - 1;
    else position = 1;

    const { error } = await supabase
      .from("tasks")
      .update({ status, board_position: position })
      .eq("id", taskId);
    if (error) return { ok: false, error: error.message };

    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

export async function deleteTask(id: string): Promise<ActionResult> {
  if (!lerUuid(id)) return { ok: false, error: ID_INVALIDO };
  try {
    const { supabase } = await requireUser();
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidateAll();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}
