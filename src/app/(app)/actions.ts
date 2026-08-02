"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { preferencesInputSchema } from "@/lib/validation";

export async function updatePreferences(input: {
  theme?: string;
  defaultCalendarView?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const parsed = preferencesInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Preferência inválida" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sessão expirada" };

  const patch: Record<string, string> = {};
  if (parsed.data.theme) patch.theme = parsed.data.theme;
  if (parsed.data.defaultCalendarView)
    patch.default_calendar_view = parsed.data.defaultCalendarView;

  const { error } = await supabase
    .from("user_preferences")
    .upsert({ user_id: user.id, ...patch }, { onConflict: "user_id" });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/");
  return { ok: true };
}
