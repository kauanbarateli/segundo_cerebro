import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { MobileNavigation } from "@/components/layout/MobileNavigation";
import { sidebarInitScript } from "@/components/layout/sidebar-preferencia";
import { MeetingReminder } from "@/components/features/notifications/MeetingReminder";
import { getAppContext, getUpcomingEvents } from "@/lib/data";
import { MODULES } from "@/lib/modules";
import { cn } from "@/lib/utils";

/**
 * Busca os próximos eventos fora do caminho crítico do shell (correção C1).
 *
 * Antes essa consulta era aguardada direto no layout, então TODA navegação —
 * inclusive para telas onde o lembrete nem é o assunto — só pintava depois que
 * ela voltava. Isolada num componente próprio sob <Suspense>, a barra lateral e
 * a página aparecem de imediato e o lembrete entra quando estiver pronto.
 */
async function MeetingReminderSlot({ leadMinutes }: { leadMinutes: number[] }) {
  const upcoming = await getUpcomingEvents(10);
  if (upcoming.length === 0) return null;
  return <MeetingReminder events={upcoming} leadMinutes={leadMinutes} />;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAppContext();
  if (!ctx) redirect("/login");

  /*
    O NONCE DA REQUISIÇÃO, para o script de barra recolhida logo abaixo.

    `script-src` NÃO tem mais 'unsafe-inline' (ver DÍVIDA 1 em src/lib/csp.ts):
    script inline sem nonce e sem hash é violação. Hoje a política vai em
    Report-Only e uma violação só aparece no console; no dia em que
    `CSP_EM_BLOQUEIO` virar `true`, o script deixaria de rodar — e o sintoma
    seria a barra voltar a piscar de 16rem para 4rem a cada carregamento, sem
    erro nenhum em lugar nenhum. É exatamente a falha silenciosa que aquele
    arquivo descreve.

    POR QUE NONCE E NÃO O HASH, que é a saída usada pelo script de tema: o hash
    foi escolhido lá porque ler `headers()` no layout RAIZ tornaria dinâmica
    toda rota da aplicação, inclusive a /login, que é estática. Esse argumento
    não alcança aqui: (app) já é dinâmico por natureza — `getAppContext()`,
    logo acima, lê os cookies de sessão a cada requisição, e nenhuma destas
    rotas pode ser estática. `headers()` aqui não muda o modo de renderização de
    nada, e evita ter que manter um segundo hash à mão em csp.ts a cada vez que
    alguém encostar no texto do script.

    `x-nonce` é posto na REQUISIÇÃO pelo middleware (src/middleware.ts) e chega
    até aqui pelo `NextResponse.next({ request })` de `updateSession`. Sem
    middleware (não deveria acontecer) o atributo simplesmente não sai, que é o
    comportamento de antes desta linha.
  */
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  const items = MODULES.filter((m) => ctx.enabledModules.has(m.key));
  const notificationsOn = ctx.preferences?.notifications_enabled ?? true;
  const showReminder = notificationsOn && ctx.enabledModules.has("calendario");

  return (
    <div className="flex min-h-dvh bg-canvas">
      {/*
        Aplica a preferência "barra recolhida" ANTES de o navegador pintar a
        barra que vem logo abaixo. Mesmo recurso, e pelo mesmo motivo, do
        `themeInitScript` no <head> do layout raiz — ver o bloco de comentário em
        `sidebar-preferencia.tsx`.

        AQUI E NÃO NO <head>: o layout raiz cobre também /login e /erro, que não
        têm barra nenhuma — e é lá que o nonce sairia caro (ver o bloco acima).
        O <head> não é necessário: o script é síncrono e está ANTES da <aside> na
        ordem do documento, então o parser o executa antes de sequer criar o nó
        da barra, e o atributo já está no <html> quando a primeira regra de
        largura é avaliada. Antes da pintura é o que importa; estar no <head> é
        só a forma mais comum de conseguir isso.

        `<script>` é `display: none` por padrão do navegador, então ele não vira
        um item deste flex.
      */}
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: sidebarInitScript }} />
      <AppSidebar
        items={items}
        displayName={ctx.displayName}
        email={ctx.email}
        avatarUrl={ctx.avatarUrl}
        organizedPercent={ctx.organized.percent}
        organizedDone={ctx.organized.done}
        organizedTotal={ctx.organized.total}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {showReminder && (
          <Suspense fallback={null}>
            <MeetingReminderSlot
              leadMinutes={ctx.preferences?.notification_lead_minutes ?? [15]}
            />
          </Suspense>
        )}
        {/*
          O TETO DE LARGURA ACOMPANHA A BARRA — senão recolher não devolve nada.

          `max-w-6xl` são 72rem. Numa tela de 1440px com a barra expandida sobram
          1184px de espaço útil, e o teto já morde: o conteúdo para em 1152px.
          Recolher a barra libera 12rem (16rem − 4rem), mas com o teto parado em
          72rem esses 12rem viram MARGEM — a página fica igual, só mais centrada,
          e o clique não produziu efeito visível nenhum.

          84rem = 72 + 12: exatamente o que a barra devolveu. O conteúdo mantém
          as mesmas distâncias das bordas que tinha antes, em vez de ganhar um
          teto novo escolhido no chute.

          Sem prefixo `md:` porque abaixo de 768px a conta não muda nada: a
          viewport é menor que 72rem e nenhum dos dois tetos chega a valer.
        */}
        <main
          className={cn(
            "mx-auto w-full max-w-6xl flex-1 px-5 pb-24 pt-8 md:pb-10 md:pt-10",
            "transition-[max-width] duration-150 ease-out",
            "[[data-sidebar=recolhida]_&]:max-w-[84rem]",
          )}
        >
          {children}
        </main>
        <MobileNavigation items={items} />
      </div>
    </div>
  );
}
