import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  cifrarTokenClickUp,
  decifrarTokenClickUp,
  fromPgHex,
  toPgHex,
} from "@/lib/crypto/tokens";
import type { ClickUpAccount, ClickUpConnection } from "@/lib/database.types";
import type { PerfilClickUp } from "@/lib/clickup/types";

/**
 * Leitura e escrita da conexão com o ClickUp.
 *
 * ============================================================================
 * ⚠️ O ADMIN CLIENT IGNORA RLS — e é por isso que ele é usado aqui
 * ============================================================================
 * `clickup_credentials` tem RLS ligada e NENHUMA policy (migration 0016), então
 * a sessão do navegador lê zero linhas. `service_role` passa por cima da RLS e
 * é o único caminho até o token — que é exatamente o desenho pretendido.
 *
 * O preço: aqui dentro a RLS não protege NADA. Toda consulta precisa do
 * `.eq("user_id", userId)` explícito, e o `userId` tem que vir de
 * `auth.getUser()` no servidor — NUNCA de parâmetro do cliente. Um `userId`
 * vindo da rede transformaria estas funções em "leia o token de quem você
 * quiser", e a RLS não estaria lá para impedir. É a mesma advertência do
 * cabeçalho de `src/lib/supabase/admin.ts`.
 *
 * Por isso toda função deste arquivo recebe `userId` como PRIMEIRO parâmetro e
 * nenhuma delas o aceita de outro lugar.
 */

/** Colunas do metadado. `select("*")` traria só isso, mas explícito é contrato. */
const COLUNAS_DA_CONTA =
  "id, user_id, clickup_user_id, clickup_username, clickup_email, workspace_id, workspace_name, enabled, space_ids, status, last_error, last_checked_at, created_at, updated_at";

/**
 * A conta do usuário, ou null.
 *
 * Usa o admin client por consistência com o resto do arquivo — a tabela
 * `clickup_accounts` TEM RLS e poderia ser lida pela sessão, mas alternar entre
 * dois clientes no mesmo módulo é como um `.eq("user_id")` acaba esquecido no
 * dia em que alguém move uma função de um lado para o outro.
 */
export async function lerConta(userId: string): Promise<ClickUpAccount | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("clickup_accounts")
    .select(COLUNAS_DA_CONTA)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as ClickUpAccount | null) ?? null;
}

/**
 * O que a interface precisa saber. Recorte deliberado: nada que identifique a
 * linha, nada que descreva o token.
 */
export async function lerConexao(userId: string): Promise<ClickUpConnection | null> {
  const conta = await lerConta(userId);
  if (!conta) return null;
  return {
    conectado: true,
    ativo: conta.enabled && conta.status !== "invalid",
    username: conta.clickup_username,
    workspaceName: conta.workspace_name,
    status: conta.status,
  };
}

/**
 * Grava (ou substitui) a conexão inteira: metadado + token cifrado.
 *
 * A ORDEM É OBRIGATÓRIA e não é arbitrária: a conta precisa existir ANTES da
 * cifragem, porque o id dela é o AAD. Cifrar antes exigiria inventar um id ou
 * cifrar sem AAD — e um segredo sem AAD é um segredo que decifra na linha de
 * qualquer outra pessoa. É o mesmo motivo pelo qual o callback do Google cifra
 * depois de criar a `calendar_account`.
 */
export async function salvarConexao(
  userId: string,
  token: string,
  perfil: PerfilClickUp,
): Promise<void> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("clickup_accounts")
    .upsert(
      {
        user_id: userId,
        clickup_user_id: perfil.clickupUserId,
        clickup_username: perfil.username,
        clickup_email: perfil.email,
        workspace_id: perfil.workspaceId,
        workspace_name: perfil.workspaceName,
        status: "connected",
        last_error: null,
        last_checked_at: new Date().toISOString(),
        // `enabled` NÃO entra: reconectar não deve religar uma integração que a
        // pessoa tinha desligado de propósito. O default `true` só vale na
        // inserção, que é o que se quer.
      },
      { onConflict: "user_id" },
    )
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Não foi possível gravar a conexão do ClickUp.");
  }

  const contaId = data.id as string;
  const cifrado = cifrarTokenClickUp(token, contaId);

  const { error: erroToken } = await admin.from("clickup_credentials").upsert(
    {
      clickup_account_id: contaId,
      token_ciphertext: toPgHex(cifrado.ciphertext),
      token_iv: toPgHex(cifrado.iv),
      crypto_version: cifrado.cryptoVersion,
      key_id: cifrado.keyId,
    },
    { onConflict: "clickup_account_id" },
  );

  if (erroToken) {
    // O metadado ficaria apontando para uma credencial que não existe, e a aba
    // apareceria conectada sem conseguir chamar nada. Desfazer é mais honesto
    // que deixar meio-gravado.
    await admin.from("clickup_accounts").delete().eq("id", contaId);
    throw new Error("Não foi possível gravar o token do ClickUp.");
  }
}

/**
 * O token em claro, ou null quando não há conexão utilizável.
 *
 * Devolve também o id da conta e o meu id no ClickUp porque quem chama sempre
 * precisa dos três juntos — o token para autenticar, o `clickupUserId` para o
 * filtro de responsável, e o `contaId` foi necessário para decifrar. Devolver
 * separado obrigaria uma segunda leitura da mesma linha.
 *
 * ⚠️ O RETORNO DESTA FUNÇÃO NUNCA PODE ATRAVESSAR A FRONTEIRA PARA O CLIENTE.
 * Ela é chamada dentro de Server Actions e o valor morre lá.
 */
export async function lerCredencial(userId: string): Promise<{
  token: string;
  contaId: string;
  clickupUserId: string;
  workspaceId: string;
  spaceIds: string[];
} | null> {
  const conta = await lerConta(userId);
  if (!conta) return null;
  // Desligada ou com token recusado: não há o que chamar. Devolver null aqui
  // evita que cada chamador precise lembrar de checar `enabled`.
  if (!conta.enabled || conta.status === "invalid") return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("clickup_credentials")
    .select("token_ciphertext, token_iv, crypto_version, key_id")
    .eq("clickup_account_id", conta.id)
    .maybeSingle();

  if (!data) return null;

  const token = decifrarTokenClickUp(
    {
      ciphertext: fromPgHex(data.token_ciphertext as string),
      iv: fromPgHex(data.token_iv as string),
      cryptoVersion: (data.crypto_version as number | null) ?? null,
      keyId: (data.key_id as string | null) ?? null,
    },
    conta.id,
  );

  return {
    token,
    contaId: conta.id,
    clickupUserId: conta.clickup_user_id,
    workspaceId: conta.workspace_id,
    spaceIds: conta.space_ids ?? [],
  };
}

/** Liga/desliga sem apagar o token. */
export async function definirAtivo(userId: string, ativo: boolean): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("clickup_accounts")
    .update({ enabled: ativo })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

/**
 * Registra o resultado de uma chamada — para a tela poder dizer "verificado
 * hoje 14:32" e para um 401 virar "reconecte" em vez de erro repetido.
 *
 * Nunca propaga exceção: é anotação de diagnóstico, e falhar ao anotar não pode
 * derrubar a operação que estava sendo diagnosticada.
 */
export async function anotarResultado(
  userId: string,
  status: ClickUpAccount["status"],
  erro?: string | null,
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin
      .from("clickup_accounts")
      .update({
        status,
        last_error: erro ?? null,
        last_checked_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  } catch {
    /* diagnóstico não bloqueia o caminho principal */
  }
}

/**
 * Apaga a conexão. O `on delete cascade` da 0016 leva a credencial junto.
 *
 * Nada é alterado no ClickUp: não há revogação de token pessoal pela API, e
 * seria errado tentar. A tela precisa dizer isso — "desconectar" numa
 * ferramenta de trabalho soa como se fosse mexer lá.
 */
export async function apagarConexao(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("clickup_accounts").delete().eq("user_id", userId);
  if (error) throw new Error(error.message);
}
