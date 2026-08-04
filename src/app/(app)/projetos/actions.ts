"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { bloqueioPorLimite } from "@/lib/rate-limit";
import { ID_INVALIDO, lerUuid, projectSchema } from "@/lib/validation";
import type { ActionResult } from "@/lib/action-types";

/**
 * Server actions do módulo Projetos.
 *
 * ⚠️ AS TABELAS QUE GANHAM `project_id` NÃO TÊM ACTION PRÓPRIA AQUI. Atribuir
 * um projeto a uma tarefa é `updateTask`; a um caderno, `renameNotebook`. As
 * actions daqui cuidam só do PROJETO. Duplicar a escrita seria criar um
 * segundo caminho para gravar a mesma coluna, com uma segunda validação para
 * manter em dia.
 */

async function exigirUsuario() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function revalidar(id?: string) {
  revalidatePath("/projetos");
  if (id) revalidatePath(`/projetos/${id}`);
}

export async function createProject(input: unknown): Promise<ActionResult> {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, user } = await exigirUsuario();
  if (!user) return { ok: false, error: "Sessão expirada" };

  const bloqueio = bloqueioPorLimite("projetos:escrita", user.id);
  if (bloqueio) return bloqueio;

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      description: parsed.data.description,
      color_key: parsed.data.colorKey,
    })
    .select("id")
    .single();

  if (error) {
    // O índice único é por nome entre os VIVOS: dois "Site" no seletor de
    // projeto seriam duas opções idênticas.
    if (error.code === "23505") return { ok: false, error: "Já existe um projeto com esse nome." };
    return { ok: false, error: "Não foi possível criar o projeto." };
  }

  revalidar();
  return { ok: true, id: data.id };
}

export async function updateProject(id: unknown, input: unknown): Promise<ActionResult> {
  const projectId = lerUuid(id);
  if (!projectId) return { ok: false, error: ID_INVALIDO };

  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, user } = await exigirUsuario();
  if (!user) return { ok: false, error: "Sessão expirada" };

  const bloqueio = bloqueioPorLimite("projetos:escrita", user.id);
  if (bloqueio) return bloqueio;

  // Whitelist explícita — o cliente manda os dados, não manda no banco.
  const { error } = await supabase
    .from("projects")
    .update({
      name: parsed.data.name,
      description: parsed.data.description,
      color_key: parsed.data.colorKey,
    })
    .eq("id", projectId);

  if (error) {
    if (error.code === "23505") return { ok: false, error: "Já existe um projeto com esse nome." };
    return { ok: false, error: "Não foi possível salvar." };
  }

  revalidar(projectId);
  return { ok: true, id: projectId };
}

/**
 * SOFT DELETE, como cadernos e pastas.
 *
 * ============================================================================
 * ⚠️ O QUE ACONTECE COM O QUE ESTAVA NO PROJETO
 * ============================================================================
 * NADA. As tarefas, capturas, cadernos e pastas continuam com o `project_id`
 * apontando para o projeto apagado.
 *
 * Isso é deliberado e é o que torna o soft delete reversível: restaurar o
 * projeto devolve o conteúdo dele inteiro. Zerar as colunas na exclusão faria
 * "apagar" virar uma operação destrutiva disfarçada de reversível — a linha do
 * projeto voltaria vazia.
 *
 * ⚠️ E É POR ISSO QUE `on delete set null` É SÓ BACKSTOP: com soft delete ele
 * nunca dispara. Quem impede um `project_id` novo de apontar para projeto morto
 * é a trigger `enforce_project_alive_same_owner` da 0017 — a FK sozinha
 * aceitaria, porque a linha continua lá.
 *
 * As telas filtram por `deleted_at is null` ao listar projetos, então o
 * conteúdo aparece "sem projeto" enquanto o projeto estiver apagado.
 */
export async function deleteProject(id: unknown): Promise<ActionResult> {
  const projectId = lerUuid(id);
  if (!projectId) return { ok: false, error: ID_INVALIDO };

  const { supabase, user } = await exigirUsuario();
  if (!user) return { ok: false, error: "Sessão expirada" };

  const bloqueio = bloqueioPorLimite("projetos:escrita", user.id);
  if (bloqueio) return bloqueio;

  const { error } = await supabase
    .from("projects")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", projectId);

  if (error) return { ok: false, error: "Não foi possível apagar." };

  // Revalida as telas do CONTEÚDO também: uma tarefa que estava neste projeto
  // passa a mostrar "sem projeto", e a lista de tarefas precisa refletir isso.
  revalidar(projectId);
  revalidatePath("/tarefas");
  revalidatePath("/capturar");
  return { ok: true, id: projectId };
}
