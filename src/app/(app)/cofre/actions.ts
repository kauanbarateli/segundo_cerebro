"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { VaultStatePayload } from "@/lib/action-types";

/**
 * Vault server actions. IMPORTANT: everything crossing this boundary is either
 * ciphertext or a WRAPPED key. The plaintext master password and decrypted
 * contents never reach the server. No decrypted value is ever logged.
 */

// bytea helpers: the DB stores bytea; the browser speaks base64.
function base64ToPgHex(b64: string): string {
  return `\\x${Buffer.from(b64, "base64").toString("hex")}`;
}
function pgHexToBase64(value: string): string {
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  return Buffer.from(hex, "hex").toString("base64");
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada");
  return { supabase, user };
}

/** Loads wrapped-key material + encrypted items. All values are safe to send. */
export async function getVaultState(): Promise<VaultStatePayload> {
  const { supabase } = await requireUser();

  const [{ data: master }, { data: items }] = await Promise.all([
    supabase.from("vault_master_keys").select("*").maybeSingle(),
    supabase
      .from("vault_items")
      .select("id, item_type, encrypted_payload, item_iv, favorite, updated_at")
      .is("deleted_at", null)
      .order("updated_at", { ascending: false }),
  ]);

  return {
    hasMasterKey: Boolean(master),
    master: master
      ? {
          wrappedDataKeyB64: pgHexToBase64(master.wrapped_data_key as string),
          wrapIvB64: pgHexToBase64(master.wrap_iv as string),
          kdfSaltB64: pgHexToBase64(master.kdf_salt as string),
          kdfAlgorithm: "argon2id",
          kdfParameters: (master.kdf_parameters as Record<string, unknown>) ?? {},
          cryptoVersion: (master.crypto_version as number) ?? 1,
        }
      : null,
    items: (items ?? []).map((i) => ({
      id: i.id as string,
      itemType: i.item_type as string,
      ciphertextB64: pgHexToBase64(i.encrypted_payload as string),
      ivB64: pgHexToBase64(i.item_iv as string),
      favorite: Boolean(i.favorite),
      updatedAt: i.updated_at as string,
    })),
  };
}

const setupSchema = z.object({
  wrappedDataKeyB64: z.string().min(1),
  wrapIvB64: z.string().min(1),
  kdfSaltB64: z.string().min(1),
  kdfAlgorithm: z.literal("argon2id"),
  kdfParameters: z.record(z.unknown()),
  cryptoVersion: z.number().int(),
});

export async function setupVault(
  input: z.infer<typeof setupSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Material inválido" };
  try {
    const { supabase, user } = await requireUser();
    const m = parsed.data;
    const { error } = await supabase.from("vault_master_keys").insert({
      user_id: user.id,
      wrapped_data_key: base64ToPgHex(m.wrappedDataKeyB64),
      wrap_iv: base64ToPgHex(m.wrapIvB64),
      kdf_salt: base64ToPgHex(m.kdfSaltB64),
      kdf_algorithm: m.kdfAlgorithm,
      kdf_parameters: m.kdfParameters,
      crypto_version: m.cryptoVersion,
    });
    if (error) return { ok: false, error: error.message };
    await logAudit("vault_created");
    revalidatePath("/cofre");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/**
 * Substitui o material da senha mestra — o passo final da recuperação por kit.
 *
 * O CENÁRIO: a senha mestra foi esquecida. O navegador desembrulhou a chave de
 * dados a partir do kit (arquivo + código), reembrulhou essa MESMA chave sob uma
 * senha nova e manda aqui o novo embrulho. Os itens não são tocados: continuam
 * cifrados com a mesma chave de dados, então nada precisa ser reescrito.
 *
 * POR QUE É `update` E NÃO `upsert`: se não existe linha, não existe cofre para
 * recuperar. Um upsert criaria um "cofre" novo cuja chave de dados não decifra
 * item nenhum — a pessoa entraria numa tela vazia achando que recuperou.
 *
 * O QUE O SERVIDOR NÃO CONSEGUE VERIFICAR, e é importante ser explícito: ele não
 * tem como saber se o material que chega veio mesmo de um kit legítimo. A chave
 * de dados nunca passa por aqui — é esse o ponto do desenho zero-knowledge. Quem
 * tiver a sessão pode sobrescrever o embrulho com material arbitrário e, com
 * isso, trancar o dono para fora dos itens (que permaneceriam cifrados sob a
 * chave antiga). Não é uma capacidade nova — a mesma sessão já apaga itens por
 * `deleteVaultItem` —, mas é IRREVERSÍVEL, então fica registrada na auditoria
 * com ação própria. `vault_master_keys` guarda `updated_at` por trigger, o que
 * dá a data da última troca mesmo se a auditoria falhar.
 */
export async function replaceVaultMasterKey(
  input: z.infer<typeof setupSchema>,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = setupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Material inválido" };
  try {
    const { supabase, user } = await requireUser();
    const m = parsed.data;
    const { data, error } = await supabase
      .from("vault_master_keys")
      .update({
        wrapped_data_key: base64ToPgHex(m.wrappedDataKeyB64),
        wrap_iv: base64ToPgHex(m.wrapIvB64),
        kdf_salt: base64ToPgHex(m.kdfSaltB64),
        kdf_algorithm: m.kdfAlgorithm,
        kdf_parameters: m.kdfParameters,
        crypto_version: m.cryptoVersion,
      })
      // A RLS já restringe a linha ao dono; o filtro explícito evita depender
      // disso para não atualizar a tabela inteira caso a policy mude.
      .eq("user_id", user.id)
      .select("user_id")
      .maybeSingle();

    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "Nenhum cofre encontrado para esta conta." };

    await logAudit("master_key_replaced");
    revalidatePath("/cofre");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

const itemSchema = z.object({
  id: z.string().uuid().optional(),
  itemType: z.enum(["login", "account", "document", "financial", "secure_note"]),
  ciphertextB64: z.string().min(1),
  ivB64: z.string().min(1),
  favorite: z.boolean().default(false),
});

export async function upsertVaultItem(
  input: z.infer<typeof itemSchema>,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Item inválido" };
  try {
    const { supabase, user } = await requireUser();
    const i = parsed.data;
    const row = {
      user_id: user.id,
      item_type: i.itemType,
      encrypted_payload: base64ToPgHex(i.ciphertextB64),
      item_iv: base64ToPgHex(i.ivB64),
      favorite: i.favorite,
    };

    if (i.id) {
      const { error } = await supabase.from("vault_items").update(row).eq("id", i.id);
      if (error) return { ok: false, error: error.message };
      await logAudit("item_updated", i.id);
      revalidatePath("/cofre");
      return { ok: true, id: i.id };
    }

    const { data, error } = await supabase.from("vault_items").insert(row).select("id").single();
    if (error) return { ok: false, error: error.message };
    await logAudit("item_created", data.id as string);
    revalidatePath("/cofre");
    return { ok: true, id: data.id as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

export async function deleteVaultItem(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { supabase } = await requireUser();
    const { error } = await supabase
      .from("vault_items")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    await logAudit("item_deleted", id);
    revalidatePath("/cofre");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/** Audit metadata only — never secrets, never decrypted content. */
export async function logAudit(
  action: string,
  vaultItemId?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const { supabase, user } = await requireUser();
    await supabase.from("vault_audit_events").insert({
      user_id: user.id,
      vault_item_id: vaultItemId ?? null,
      action,
      metadata: metadata ?? null,
    });
  } catch {
    /* auditing must never block the main action */
  }
}
