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

/**
 * ============================================================================
 * ⭐ A GUARDA QUE DE FATO PROTEGE A ÁREA ADMINISTRATIVA
 * ============================================================================
 * São quatro camadas, e é importante saber qual faz o quê:
 *
 *   1. INTERFACE   — o link "Admin" some da barra. É CONVENIÊNCIA, não
 *                    segurança: esconder um link não fecha uma rota.
 *   2. ROTA        — `admin/layout.tsx` consulta o papel e redireciona. Cobre
 *                    quem digita o endereço.
 *   3. OPERAÇÃO    — ESTA função, na primeira linha de TODA Server Action.
 *   4. BANCO       — RLS + `eh_master()`. A última linha.
 *
 * ⚠️ A CAMADA 3 É A QUE IMPORTA, e a razão é específica do Next: uma Server
 * Action **é um endpoint HTTP**. O framework publica um id por função exportada,
 * e qualquer um monta um POST para esse id — sem passar por layout, sem
 * renderizar página nenhuma, sem que a guarda da camada 2 chegue a existir.
 *
 * Dito de outro jeito: a guarda de layout protege a TELA. Só esta protege a
 * OPERAÇÃO. Uma action administrativa sem esta linha na primeira posição está
 * aberta para qualquer usuário autenticado, por mais escondido que o botão
 * esteja.
 *
 * ⚠️ LANÇA, e não redireciona. `redirect()` funciona ao renderizar uma página;
 * numa action ele viraria uma resposta de navegação que o cliente que chamou
 * direto simplesmente ignora. A exceção interrompe a execução, ponto — que é o
 * único desfecho aceitável aqui.
 */
export async function requireMaster(): Promise<AppContext> {
  const ctx = await getAppContext();
  // A MESMA mensagem para "sem sessão" e "sem permissão", de propósito:
  // distinguir as duas confirmaria a existência da área para quem está sondando.
  if (!ctx || ctx.papel !== "master") throw new Error("Sem permissão.");
  return ctx;
}

/** A versão para PÁGINA (camada 2), onde redirecionar é o comportamento certo. */
export async function requireMasterPage(): Promise<AppContext> {
  const ctx = await getAppContext();
  if (!ctx) redirect("/login");
  // Para a Início, e não para uma tela de "acesso negado": um usuário comum não
  // precisa aprender que existe uma área administrativa.
  if (ctx.papel !== "master") redirect("/");
  return ctx;
}
