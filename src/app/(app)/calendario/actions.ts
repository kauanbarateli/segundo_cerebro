"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada");
  return supabase;
}

export async function setSourceEnabled(
  sourceId: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await requireUser();
    const { error } = await supabase
      .from("calendar_sources")
      .update({ is_enabled: enabled })
      .eq("id", sourceId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/calendario");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

const nicknameSchema = z.string().trim().max(40);

export async function setAccountNickname(
  accountId: string,
  nickname: string,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = nicknameSchema.safeParse(nickname);
  if (!parsed.success) return { ok: false, error: "Apelido inválido" };
  try {
    const supabase = await requireUser();
    const { error } = await supabase
      .from("calendar_accounts")
      .update({ display_name: parsed.data || null })
      .eq("id", accountId);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/calendario");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}
