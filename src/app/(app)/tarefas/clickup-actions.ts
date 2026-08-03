"use server";

import { createClient } from "@/lib/supabase/server";
import {
  comentar,
  lerComentarios,
  listarMinhasTarefas,
  mudarStatus,
  statusDaLista,
} from "@/lib/clickup/client";
import { anotarResultado, lerCredencial } from "@/lib/clickup/credentials";
import { fraseDoErro, motivoDoErro, type MotivoClickUp } from "@/lib/clickup/erros";
import { garantirResponsavel } from "@/lib/clickup/guard";
import { mapearComentario, mapearTarefa, porPrazo } from "@/lib/clickup/mapper";
import type {
  ComentarioClickUp,
  StatusPossivel,
  TarefaClickUp,
} from "@/lib/clickup/types";
import { bloqueioPorLimite } from "@/lib/rate-limit";
import {
  clickupComentarioSchema,
  clickupIdSchema,
  clickupStatusSchema,
} from "@/lib/validation";
import type { ActionResult } from "@/lib/action-types";

/**
 * As actions da aba ClickUp.
 *
 * ============================================================================
 * ⚠️ A SEQUÊNCIA DE SEIS ETAPAS DE TODA ESCRITA
 * ============================================================================
 *   1. auth.getUser()                 → a sessão é válida?
 *   2. bloqueioPorLimite              → 10/min, mais apertado que o padrão
 *   3. Zod                            → formato do id, do status, do texto
 *   4. lerCredencial                  → existe conexão, e está ativa?
 *   5. garantirResponsavel            → ⭐ a tarefa é MINHA? (invariante I3)
 *   6. a chamada                      → corpo montado, nunca repassado
 *
 * Nenhuma etapa é dispensável, e a 5 é a que costuma parecer. Ela não parece
 * necessária porque a interface só mostra tarefas minhas — mas `"use server"`
 * NÃO é fronteira de confiança: o Next publica um id por função exportada e
 * qualquer um manda POST direto, com o `taskId` que quiser. Sem a etapa 5, "só
 * nas minhas tarefas" é uma frase sobre a tela, não sobre o sistema.
 */

async function exigirUsuario() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada");
  return user;
}

export interface ListagemClickUp {
  ok: boolean;
  tarefas?: TarefaClickUp[];
  /** Bateu no teto de 5 páginas — a tela avisa que há mais. */
  truncado?: boolean;
  erro?: string;
  /** Tipado para a tela oferecer "Reconectar" ou "Tentar de novo". */
  motivo?: MotivoClickUp;
}

/**
 * Lista as tarefas em que sou responsável.
 *
 * Chamada quando a ABA É CLICADA, não em `tarefas/page.tsx` — ver
 * `getClickUpConnection` em data.ts para o porquê. O pior caso aqui é uma aba
 * dizendo "não foi possível carregar"; a lista pessoal nunca fica sabendo.
 */
export async function listarTarefasClickUp(): Promise<ListagemClickUp> {
  try {
    const user = await exigirUsuario();

    const bloqueio = bloqueioPorLimite("clickup:listar", user.id, {
      maximo: 20,
      janelaMs: 60_000,
    });
    if (bloqueio) return { ok: false, erro: bloqueio.error, motivo: "limite_de_taxa" };

    const credencial = await lerCredencial(user.id);
    if (!credencial) {
      return { ok: false, erro: "ClickUp não está conectado.", motivo: "token_invalido" };
    }

    const { tarefas, truncado } = await listarMinhasTarefas(credencial.token, {
      teamId: credencial.workspaceId,
      meuId: credencial.clickupUserId,
      spaceIds: credencial.spaceIds,
    });

    await anotarResultado(user.id, "connected", null);

    return {
      ok: true,
      tarefas: tarefas.map(mapearTarefa).sort(porPrazo),
      truncado,
    };
  } catch (e) {
    const motivo = motivoDoErro(e);
    // Um 401 vira `invalid` na tabela, e é isso que faz a tela de Configurações
    // dizer "Token recusado" na próxima visita em vez de repetir o erro.
    await marcarFalha(motivo, e);
    return { ok: false, erro: fraseDoErro(e), motivo };
  }
}

/** Anota o diagnóstico sem derrubar o caminho principal. */
async function marcarFalha(motivo: MotivoClickUp, erro: unknown): Promise<void> {
  try {
    const user = await exigirUsuario();
    await anotarResultado(
      user.id,
      motivo === "token_invalido" ? "invalid" : "error",
      erro instanceof Error ? erro.message.slice(0, 300) : null,
    );
  } catch {
    /* sem sessão não há o que anotar */
  }
}

export interface DetalheClickUp {
  ok: boolean;
  tarefa?: TarefaClickUp;
  comentarios?: ComentarioClickUp[];
  statusPossiveis?: StatusPossivel[];
  erro?: string;
  motivo?: MotivoClickUp;
}

/**
 * Detalhe de uma tarefa: descrição, comentários e os status válidos DAQUELA
 * lista.
 *
 * ⚠️ Os comentários NÃO SÃO PERSISTIDOS em lugar nenhum. São dados de colegas
 * num banco pessoal — buscados agora, exibidos, e esquecidos. Guardá-los seria
 * trazer conversa de terceiros para dentro de um sistema que ninguém mais
 * audita.
 *
 * Passa por `garantirResponsavel` mesmo sendo LEITURA. Poderia não passar — ler
 * uma tarefa de colega não estraga nada —, mas então esta action viraria um
 * leitor de qualquer tarefa do workspace por id, para quem chamasse direto. O
 * custo de fechar é um GET; o de deixar aberto é uma ferramenta de bisbilhotar.
 */
export async function detalharTarefaClickUp(taskId: unknown): Promise<DetalheClickUp> {
  const parsed = clickupIdSchema.safeParse(taskId);
  if (!parsed.success) return { ok: false, erro: "Tarefa inválida.", motivo: "nao_encontrado" };

  try {
    const user = await exigirUsuario();

    const bloqueio = bloqueioPorLimite("clickup:detalhar", user.id, {
      maximo: 30,
      janelaMs: 60_000,
    });
    if (bloqueio) return { ok: false, erro: bloqueio.error, motivo: "limite_de_taxa" };

    const credencial = await lerCredencial(user.id);
    if (!credencial) {
      return { ok: false, erro: "ClickUp não está conectado.", motivo: "token_invalido" };
    }

    const crua = await garantirResponsavel(
      credencial.token,
      parsed.data,
      credencial.clickupUserId,
    );
    const tarefa = mapearTarefa(crua);

    // As duas leituras que faltam não dependem uma da outra.
    const [comentarios, statusPossiveis] = await Promise.all([
      lerComentarios(credencial.token, parsed.data),
      tarefa.listaId ? statusDaLista(credencial.token, tarefa.listaId) : Promise.resolve([]),
    ]);

    return {
      ok: true,
      tarefa,
      comentarios: comentarios.map(mapearComentario),
      statusPossiveis,
    };
  } catch (e) {
    return { ok: false, erro: fraseDoErro(e), motivo: motivoDoErro(e) };
  }
}

/**
 * Muda o status. As seis etapas, na ordem.
 *
 * Entre a 5 e a 6 há um passo a mais: VALIDAR O STATUS contra os status reais
 * da lista daquela tarefa. Cada Space do ClickUp define os seus, então não
 * existe lista fixa. Sem validar, um status inexistente volta como 400 com
 * mensagem crua em inglês; validando antes, vira frase em português e não gasta
 * a requisição de escrita.
 */
export async function mudarStatusClickUp(
  taskId: unknown,
  status: unknown,
): Promise<ActionResult> {
  const idOk = clickupIdSchema.safeParse(taskId);
  const statusOk = clickupStatusSchema.safeParse(status);
  if (!idOk.success) return { ok: false, error: "Tarefa inválida." };
  if (!statusOk.success) {
    return { ok: false, error: statusOk.error.issues[0]?.message ?? "Status inválido." };
  }

  try {
    const user = await exigirUsuario();

    const bloqueio = bloqueioPorLimite("clickup:escrita", user.id, {
      maximo: 10,
      janelaMs: 60_000,
    });
    if (bloqueio) return bloqueio;

    const credencial = await lerCredencial(user.id);
    if (!credencial) return { ok: false, error: "ClickUp não está conectado." };

    // Etapa 5 — e a tarefa devolvida evita um segundo GET para achar a lista.
    const crua = await garantirResponsavel(credencial.token, idOk.data, credencial.clickupUserId);

    const listaId = crua.list?.id;
    if (listaId) {
      const possiveis = await statusDaLista(credencial.token, listaId);
      const existe = possiveis.some(
        (s) => s.status.toLowerCase() === statusOk.data.toLowerCase(),
      );
      if (!existe) {
        return {
          ok: false,
          error: `"${statusOk.data}" não é um status desta lista no ClickUp.`,
        };
      }
    }

    await mudarStatus(credencial.token, idOk.data, statusOk.data);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: fraseDoErro(e) };
  }
}

/**
 * Comenta na tarefa.
 *
 * O comentário SAI deste aplicativo e aparece para o time. Três camadas contra
 * duplicata, proporcionais ao problema (o mesmo comentário duas vezes numa
 * tarefa que colegas leem):
 *
 *   1. botão desabilitado durante o envio — resolve o duplo clique (na UI);
 *   2. sem retry automático em POST — resolve o retry (em capabilities.ts);
 *   3. limite de 10/min — resolve o laço (aqui).
 *
 * Nenhuma delas sozinha cobre as três causas.
 */
export async function comentarClickUp(taskId: unknown, texto: unknown): Promise<ActionResult> {
  const idOk = clickupIdSchema.safeParse(taskId);
  const textoOk = clickupComentarioSchema.safeParse(texto);
  if (!idOk.success) return { ok: false, error: "Tarefa inválida." };
  if (!textoOk.success) {
    return { ok: false, error: textoOk.error.issues[0]?.message ?? "Comentário inválido." };
  }

  try {
    const user = await exigirUsuario();

    const bloqueio = bloqueioPorLimite("clickup:escrita", user.id, {
      maximo: 10,
      janelaMs: 60_000,
    });
    if (bloqueio) return bloqueio;

    const credencial = await lerCredencial(user.id);
    if (!credencial) return { ok: false, error: "ClickUp não está conectado." };

    await garantirResponsavel(credencial.token, idOk.data, credencial.clickupUserId);
    const { id } = await comentar(credencial.token, idOk.data, textoOk.data);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: fraseDoErro(e) };
  }
}
