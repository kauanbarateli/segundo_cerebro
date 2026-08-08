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

  /*
    ⚠️ "Admin" NÃO entra em `MODULES`, e a distinção importa.

    `MODULES` é a lista de módulos DESLIGÁVEIS — cada um tem um interruptor em
    Configurações, e `user_modules` guarda a escolha. A área administrativa não
    é uma preferência: ela existe ou não conforme o PAPEL, e um interruptor ali
    sugeriria que um usuário comum poderia ligá-la.

    Este acréscimo é a CAMADA 1 das quatro (ver `requireMaster`), e é a mais
    fraca de todas: esconder um link não fecha uma rota. Quem digitar `/admin`
    ainda passa por `admin/layout.tsx`, e quem chamar uma action direto ainda
    passa por `requireMaster()`. É conveniência, não controle de acesso.
  */
  const items = [
    ...MODULES.filter((m) => ctx.enabledModules.has(m.key)),
    ...(ctx.papel === "master"
      ? [
          {
            key: "admin",
            label: "Admin",
            href: "/admin",
            icon: "Settings" as const,
            core: false,
            description: "Contas, papéis e bloqueio.",
          },
        ]
      : []),
  ];
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

          O teto expandido é 67.5rem (1080px), o número do DS §5. Recolher a barra
          libera espaço, mas com o teto parado esse espaço vira MARGEM: a página
          fica igual, só mais centrada, e o clique não produz efeito visível.
          O teto recolhido precisa, portanto, ser `67.5rem + o que a barra
          devolveu`.

          ⚠️ E A BARRA DEVOLVE DUAS COISAS DIFERENTES, porque ela tem dois
          tamanhos (ver AppSidebar.tsx — 16rem até 1535px, 20rem a partir de
          1536px). São dois regimes, e por isso são dois tetos recolhidos:

            até 1535px   barra 16 → 4rem, devolve 12rem   →  67.5 + 12 = 79.5rem
            de 1536px    barra 20 → 4rem, devolve 16rem   →  67.5 + 16 = 83.5rem

          A conta foi CONFERIDA nos dois, não deduzida. Em 1535px com a barra
          recolhida sobram 1391px úteis (1535 − 64 de barra − 80 de padding); o
          teto de 79.5rem (1272px) deixa 59.5px de margem de cada lado, que é
          exatamente a margem que o estado expandido tinha. Com o teto de 83.5rem
          ali, a margem cairia para 27.5px — o conteúdo cresceria 64px A MAIS do
          que a barra liberou, e o "recolher" passaria a comer o respiro lateral
          em vez de só devolver o que era da barra.

          Em 1536px a mesma conta fecha com 83.5rem: 1392px úteis, 1336px de
          conteúdo, 28px de margem de cada lado — os mesmos 28px do expandido.

          Sem prefixo `md:` no teto de baixo porque abaixo de 768px a conta não
          muda nada: a viewport é menor que 67.5rem e nenhum teto chega a valer.
        */}
        <main
          className={cn(
            "mx-auto w-full max-w-[67.5rem] flex-1 px-5 pb-24 pt-8 md:px-8 md:pb-10 md:pt-10 lg:px-10",
            "transition-[max-width] duration-150 ease-out",
            "[[data-sidebar=recolhida]_&]:max-w-[79.5rem]",
            "2xl:[[data-sidebar=recolhida]_&]:max-w-[83.5rem]",
          )}
        >
          {children}
        </main>
        <MobileNavigation items={items} />
      </div>
    </div>
  );
}
