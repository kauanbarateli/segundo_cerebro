import "server-only";

import { redirect } from "next/navigation";
import { getAppContext, type AppContext } from "@/lib/data";

/**
 * Guard de módulo.
 *
 * Esconder o link na barra lateral NÃO é controle de acesso — a rota continua
 * respondendo se digitada na URL. Toda página de módulo desativável deve
 * começar por aqui.
 */
export async function requireModule(moduleKey: string): Promise<AppContext> {
  const ctx = await getAppContext();
  if (!ctx) redirect("/login");
  if (!ctx.enabledModules.has(moduleKey)) redirect("/");
  return ctx;
}
