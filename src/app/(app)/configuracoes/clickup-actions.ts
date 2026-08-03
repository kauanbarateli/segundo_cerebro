"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { identificarEEscolherWorkspace } from "@/lib/clickup/client";
import {
  apagarConexao,
  definirAtivo,
  lerConexao,
  lerCredencial,
  salvarConexao,
} from "@/lib/clickup/credentials";
import { fraseDoErro } from "@/lib/clickup/erros";
import { bloqueioPorLimite } from "@/lib/rate-limit";
import { clickupTokenSchema } from "@/lib/validation";
import type { ActionResult } from "@/lib/action-types";

/**
 * Conectar, testar e desconectar o ClickUp.
 *
 * ⚠️ NENHUMA função deste arquivo devolve o token, nem mascarado. A invariante
 * I1 diz que ele não sai do servidor, e "mascarado" ainda é sair: `pk_••••3f2a`
 * entrega quatro caracteres sem necessidade nenhuma. Para responder "é a conta
 * certa?", nome e workspace bastam — e eles já estão na tela.
 */

async function exigirUsuario() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada");
  return user;
}

function revalidar() {
  revalidatePath("/configuracoes");
  revalidatePath("/tarefas");
}

export interface ConexaoResult {
  ok: boolean;
  error?: string;
  perfil?: {
    username: string | null;
    workspaceName: string | null;
    /** > 1 faz a tela avisar qual workspace foi escolhido. */
    totalDeWorkspaces: number;
  };
}

/**
 * Conecta. A ORDEM DOS PASSOS é a parte que importa.
 *
 * 1. Zod — formato errado nem vira requisição.
 * 2. Limite de taxa, mais apertado que o padrão (5/min contra 30). Conectar é
 *    operação rara; sem freio, esta action vira um ORÁCULO para testar tokens
 *    contra o ClickUp usando o servidor de outra pessoa como intermediário.
 * 3. `identificar` — TESTA ANTES DE GRAVAR. Este é o ponto de projeto: um token
 *    inválido falha aqui, na hora, com o erro na tela de Configurações. Gravar
 *    primeiro e descobrir depois transformaria o mesmo problema numa aba
 *    quebrada em Tarefas, longe da causa e sem nada que aponte para ela.
 * 4. Cifra e grava as duas tabelas.
 */
export async function conectarClickUp(token: unknown): Promise<ConexaoResult> {
  const parsed = clickupTokenSchema.safeParse(token);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Token inválido." };
  }

  try {
    const user = await exigirUsuario();

    const bloqueio = bloqueioPorLimite("clickup:conectar", user.id, {
      maximo: 5,
      janelaMs: 60_000,
    });
    if (bloqueio) return bloqueio;

    // Passo 3 — nada é gravado se isto falhar.
    const perfil = await identificarEEscolherWorkspace(parsed.data);

    await salvarConexao(user.id, parsed.data, perfil);
    revalidar();

    return {
      ok: true,
      perfil: {
        username: perfil.username,
        workspaceName: perfil.workspaceName,
        totalDeWorkspaces: perfil.totalDeWorkspaces,
      },
    };
  } catch (e) {
    // `fraseDoErro` traduz o motivo tipado; qualquer outra coisa vira a frase
    // genérica. O erro cru NÃO sobe: ele pode carregar detalhe da requisição.
    return { ok: false, error: fraseDoErro(e) };
  }
}

/**
 * Reverifica a conexão existente.
 *
 * Serve ao botão "Testar conexão": responde "o token ainda vale?" sem exigir
 * que a pessoa cole nada de novo. Um token revogado no painel do ClickUp
 * continua gravado aqui e só falharia na próxima listagem — este botão é o que
 * transforma isso numa resposta pedida em vez de uma surpresa.
 */
export async function testarClickUp(): Promise<ConexaoResult> {
  try {
    const user = await exigirUsuario();

    const bloqueio = bloqueioPorLimite("clickup:testar", user.id, {
      maximo: 10,
      janelaMs: 60_000,
    });
    if (bloqueio) return bloqueio;

    const credencial = await lerCredencial(user.id);
    if (!credencial) return { ok: false, error: "Nenhuma conexão ativa com o ClickUp." };

    const perfil = await identificarEEscolherWorkspace(credencial.token);
    // Regrava o metadado: nome e workspace podem ter mudado do lado de lá, e
    // `last_checked_at` é o que a tela mostra como "verificado hoje 14:32".
    await salvarConexao(user.id, credencial.token, perfil);
    revalidar();

    return {
      ok: true,
      perfil: {
        username: perfil.username,
        workspaceName: perfil.workspaceName,
        totalDeWorkspaces: perfil.totalDeWorkspaces,
      },
    };
  } catch (e) {
    return { ok: false, error: fraseDoErro(e) };
  }
}

/**
 * Liga/desliga sem apagar o token.
 *
 * DESLIGAR ≠ DESCONECTAR, e a diferença é visível na interface de propósito:
 * desligar esconde a aba e para as chamadas, mantendo a credencial; desconectar
 * apaga. Quem quer só parar de ver a aba por uma semana não deveria precisar
 * gerar um token novo depois.
 */
export async function alternarClickUp(ativo: unknown): Promise<ActionResult> {
  if (typeof ativo !== "boolean") return { ok: false, error: "Valor inválido." };
  try {
    const user = await exigirUsuario();
    await definirAtivo(user.id, ativo);
    revalidar();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/**
 * Desconecta: apaga a conta e, por cascade, a credencial.
 *
 * NADA é alterado no ClickUp. Não existe revogação de token pessoal pela API, e
 * tentar seria pior — a interface diz isso em texto, porque "desconectar" numa
 * ferramenta de trabalho compartilhada soa como se fosse mexer lá.
 */
export async function desconectarClickUp(): Promise<ActionResult> {
  try {
    const user = await exigirUsuario();
    await apagarConexao(user.id);
    revalidar();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/** Estado da conexão para a interface. Nunca inclui o token. */
export async function estadoClickUp() {
  const user = await exigirUsuario();
  return lerConexao(user.id);
}
