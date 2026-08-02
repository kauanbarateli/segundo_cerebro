import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { MobileNavigation } from "@/components/layout/MobileNavigation";
import { MeetingReminder } from "@/components/features/notifications/MeetingReminder";
import { getAppContext, getUpcomingEvents } from "@/lib/data";
import { MODULES } from "@/lib/modules";

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

  const items = MODULES.filter((m) => ctx.enabledModules.has(m.key));
  const notificationsOn = ctx.preferences?.notifications_enabled ?? true;
  const showReminder = notificationsOn && ctx.enabledModules.has("calendario");

  return (
    <div className="flex min-h-dvh bg-canvas">
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
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-24 pt-8 md:pb-10 md:pt-10">
          {children}
        </main>
        <MobileNavigation items={items} />
      </div>
    </div>
  );
}
