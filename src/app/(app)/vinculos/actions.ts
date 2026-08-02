"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { linkInputSchema, type LinkKind } from "@/lib/validation";
import type { ActionResult } from "@/lib/action-types";

/**
 * Criação e remoção dos vínculos entre tarefa, captura e evento (migration
 * 0009). Não há página em /vinculos: o diretório existe só para agrupar estas
 * actions, que são chamadas pelas telas de tarefas, capturas e calendário.
 *
 * As três tabelas têm o mesmo formato (duas FKs + user_id + created_at, PK
 * composta pelas duas FKs), então o código é um só, parametrizado pelo tipo.
 */

interface FormatoDoVinculo {
  tabela: string;
  colunaA: string;
  colunaB: string;
  /** Telas que mostram este vínculo e precisam ser revalidadas. */
  rotas: string[];
}

/**
 * Tradução de tipo -> tabela/colunas.
 *
 * TUDO AQUI É LITERAL. Nada de `\`${tipo}_links\`` ou de montar nome de tabela
 * concatenando entrada: mesmo com o enum Zod barrando valores estranhos, a
 * concatenação transformaria uma falha futura de validação em escrita numa
 * tabela arbitrária. O mapa é fechado e o `satisfies` garante, em tempo de
 * compilação, que existe uma entrada para CADA membro do enum — acrescentar um
 * quarto tipo em validation.ts sem completar este mapa não compila.
 */
const FORMATOS = {
  "task-capture": {
    tabela: "task_capture_links",
    colunaA: "task_id",
    colunaB: "capture_id",
    rotas: ["/tarefas", "/capturar"],
  },
  "task-event": {
    tabela: "task_event_links",
    colunaA: "task_id",
    colunaB: "calendar_event_id",
    rotas: ["/tarefas", "/calendario"],
  },
  "capture-event": {
    tabela: "capture_event_links",
    colunaA: "capture_id",
    colunaB: "calendar_event_id",
    rotas: ["/capturar", "/calendario"],
  },
} satisfies Record<LinkKind, FormatoDoVinculo>;

function revalidar(formato: FormatoDoVinculo) {
  for (const rota of formato.rotas) revalidatePath(rota);
  // A página inicial mostra tarefas e próximos eventos: um vínculo novo muda o
  // que ela renderiza.
  revalidatePath("/");
}

/**
 * Traduz o erro do Postgres em mensagem de tela.
 *
 * As duas exceções do trigger `enforce_link_same_owner` viram a MESMA resposta
 * de propósito. "não existe / não está visível" (foreign_key_violation) e
 * "pertence a outro usuário" (insufficient_privilege) são estados diferentes
 * para o banco, mas devolver mensagens diferentes contaria ao chamador se
 * aquele uuid existe na conta de outra pessoa — um oráculo de existência de
 * graça. Para quem está do lado de fora, os dois casos são "não encontrado".
 */
function mensagemDeErro(codigo: string | undefined, fallback: string): string {
  if (codigo === "23503" || codigo === "42501") return "Item não encontrado.";
  // 23514/22P02 e afins não deveriam chegar aqui (o Zod já barrou), mas se
  // chegarem a mensagem crua do banco não vai para a tela.
  return fallback;
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada");
  return { supabase, user };
}

/**
 * Cria o vínculo entre duas entidades do mesmo dono.
 *
 * IDEMPOTENTE: a PK composta das tabelas de vínculo garante no máximo um par, e
 * vincular o que já está vinculado é um NO-OP bem-sucedido, não um erro — o
 * usuário pediu um estado ("estes dois estão ligados") e o estado é esse. Por
 * isso a violação de unicidade (23505) volta como `ok: true`.
 *
 * O `user_id` sai SEMPRE de `auth.getUser()`. Aceitá-lo do cliente permitiria
 * gravar vínculo em nome de outra pessoa — e a RLS de INSERT, que compara
 * `auth.uid()` com a coluna, ficaria satisfeita porque a comparação é com o
 * valor enviado. O dono não é dado de entrada.
 */
export async function createLink(tipo: LinkKind, aId: string, bId: string): Promise<ActionResult> {
  // O tipo de TypeScript some na compilação e esta função é um endpoint HTTP:
  // `tipo` chega como o que o cliente mandar. A validação de runtime é a que
  // vale.
  const parsed = linkInputSchema.safeParse({ tipo, aId, bId });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const entrada = parsed.data;
  const formato = FORMATOS[entrada.tipo];

  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from(formato.tabela)
      .insert({
        [formato.colunaA]: entrada.aId,
        [formato.colunaB]: entrada.bId,
        user_id: user.id,
      })
      // `.select()` obriga o PostgREST a devolver a linha gravada. Sem ele não
      // há como distinguir "inseriu" de "não inseriu nada": o INSERT volta com
      // `error: null` e corpo vazio, e a interface comemoraria um vínculo que
      // não existe.
      .select(formato.colunaA);

    if (error) {
      // 23505 = unique_violation: o par já existia. Ver a nota de idempotência.
      if (error.code === "23505") return { ok: true };
      return { ok: false, error: mensagemDeErro(error.code, "Não foi possível criar o vínculo.") };
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Não foi possível criar o vínculo." };
    }

    revalidar(formato);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/**
 * Desfaz o vínculo. Apaga a linha da tabela de junção e NADA mais — as duas
 * entidades continuam existindo, que é o ponto de ter uma tabela de junção em
 * vez de coluna de FK.
 *
 * Não há `.eq("user_id", ...)`: a RLS de DELETE já restringe ao dono. O que a
 * RLS não dá é aviso — um DELETE que não casa com nenhuma linha (par
 * inexistente, ou de outro usuário, que para a RLS é a mesma coisa) volta com
 * `error: null` e zero linhas. Daí o `.select()`.
 */
export async function removeLink(tipo: LinkKind, aId: string, bId: string): Promise<ActionResult> {
  const parsed = linkInputSchema.safeParse({ tipo, aId, bId });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const entrada = parsed.data;
  const formato = FORMATOS[entrada.tipo];

  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from(formato.tabela)
      .delete()
      .eq(formato.colunaA, entrada.aId)
      .eq(formato.colunaB, entrada.bId)
      .select(formato.colunaA);

    if (error) {
      return { ok: false, error: mensagemDeErro(error.code, "Não foi possível remover o vínculo.") };
    }
    if (!data || data.length === 0) {
      return { ok: false, error: "Vínculo não encontrado." };
    }

    revalidar(formato);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}
