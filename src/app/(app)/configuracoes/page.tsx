import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  ProfilePanel,
  ModulesPanel,
  NotificationsPanel,
  PrivacyPanel,
  SocialLinksPanel,
} from "@/components/features/settings/SettingsPanels";
import { getAppContext, getSocialLinks } from "@/lib/data";

export default async function ConfiguracoesPage() {
  const ctx = await getAppContext();
  if (!ctx) redirect("/login");

  // `getAppContext` é memoizado e já resolveu no `await` acima (o layout também
  // o chama no mesmo passe), então não há nada com que paralelizar aqui: esta é
  // a única leitura própria da página.
  const socialLinks = await getSocialLinks();

  const prefs = ctx.preferences;

  return (
    <>
      <PageHeader
        eyebrow="Preferências"
        title="Configurações."
        subtitle="Ajuste a aplicação ao seu jeito de trabalhar."
        user={{ name: ctx.displayName, avatarUrl: ctx.avatarUrl }}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <ProfilePanel
            displayName={ctx.displayName}
            email={ctx.email}
            avatarUrl={ctx.avatarUrl}
          />
          <PrivacyPanel hideValues={prefs?.finance_hide_values ?? false} />
          <SocialLinksPanel links={socialLinks} />
        </div>
        <div className="space-y-5">
          <ModulesPanel enabled={[...ctx.enabledModules]} />
          <NotificationsPanel
            enabled={prefs?.notifications_enabled ?? true}
            leadMinutes={prefs?.notification_lead_minutes ?? [15]}
            channel={prefs?.notification_channel ?? "in_app"}
          />
        </div>
      </div>
    </>
  );
}
