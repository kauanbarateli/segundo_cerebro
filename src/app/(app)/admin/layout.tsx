import type { ReactNode } from "react";
import { requireMasterPage } from "@/lib/guards";

/**
 * CAMADA 2 das quatro que protegem esta área — a guarda de ROTA.
 *
 * Ela cobre quem digita `/admin` na barra de endereços, que é o furo que
 * esconder o link da barra lateral (camada 1) deixa aberto.
 *
 * ⚠️ E ela NÃO É SUFICIENTE, o que é a parte importante de saber. Um layout
 * roda ao RENDERIZAR uma página; uma Server Action invocada diretamente por
 * POST nunca passa por aqui. Por isso toda action de `actions.ts` chama
 * `requireMaster()` na primeira linha — ver o cabeçalho daquele arquivo.
 *
 * Um layout, e não a checagem repetida em cada `page.tsx`: assim uma rota nova
 * dentro de `/admin` nasce protegida em vez de depender de alguém lembrar.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireMasterPage();
  return <>{children}</>;
}
