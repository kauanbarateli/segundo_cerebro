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
