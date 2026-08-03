import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  ProfilePanel,
  ModulesPanel,
  NotificationsPanel,
  PrivacyPanel,
  SocialLinksPanel,
} from "@/components/features/settings/SettingsPanels";
import { IntegrationsPanel } from "@/components/features/settings/IntegrationsPanel";
import {
  getAppContext,
  getClickUpConnection,
  getClickUpVerificadoEm,
  getSocialLinks,
} from "@/lib/data";

export default async function ConfiguracoesPage() {
  const ctx = await getAppContext();
  if (!ctx) redirect("/login");

  // As três leituras próprias da página, em paralelo. Nenhuma depende das
  // outras, e as do ClickUp são consultas locais ao Postgres — não há chamada à
  // API deles aqui (ver `getClickUpConnection`).
  const [socialLinks, clickup, clickupVerificadoEm] = await Promise.all([
    getSocialLinks(),
    getClickUpConnection(),
    getClickUpVerificadoEm(),
  ]);

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
          {/* `conexao` NUNCA carrega o token — ver ClickUpConnection. */}
          <IntegrationsPanel conexao={clickup} verificadoEm={clickupVerificadoEm} />
        </div>
      </div>
    </>
  );
}
