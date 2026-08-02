import { PageHeader } from "@/components/layout/PageHeader";
import { CalendarAccountCard } from "@/components/features/calendar/CalendarAccountCard";
import { CalendarViews } from "@/components/features/calendar/CalendarViews";
import {
  getCalendarAccounts,
  getCalendarSources,
  getCaptureCandidates,
  getEventsForCalendar,
  getRelatedItems,
  getTaskCandidates,
} from "@/lib/data";
import { requireModule } from "@/lib/guards";
import { isGoogleConfigured } from "@/lib/env";
import type { CalendarAccount, CalendarSource } from "@/lib/database.types";

const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "Credenciais do Google ainda não configuradas no servidor.",
  invalid_slot: "Slot inválido.",
  invalid_state: "Sessão de conexão inválida ou expirada. Tente novamente.",
  session_mismatch: "A sessão não confere. Faça login novamente.",
  no_refresh_token: "O Google não retornou um refresh token. Reconecte e conceda o acesso.",
  already_connected: "Esta conta Google já está conectada em outro slot.",
  connect_failed: "Não foi possível salvar a conta. Verifique o limite de 2 contas.",
  credential_store_failed: "Falha ao armazenar as credenciais com segurança.",
  oauth_exchange_failed: "Falha na troca de tokens com o Google.",
  missing_params: "Retorno do Google incompleto.",
};

export default async function CalendarioPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; sync?: string }>;
}) {
  const ctx = await requireModule("calendario");
  const sp = await searchParams;
  const googleConfigured = isGoogleConfigured();

  const from = new Date(Date.now() - 31 * 86_400_000).toISOString();
  const to = new Date(Date.now() + 180 * 86_400_000).toISOString();

  const [accounts, sources, events, related, tarefas, capturas] = await Promise.all([
    getCalendarAccounts(),
    getCalendarSources(),
    getEventsForCalendar(from, to),
    getRelatedItems("event"),
    getTaskCandidates(),
    getCaptureCandidates(),
  ]);

  const accountsBySlot = new Map<number, CalendarAccount>(accounts.map((a) => [a.slot, a]));
  const sourcesByAccount = (id: string): CalendarSource[] =>
    (sources as CalendarSource[]).filter((s) => s.calendar_account_id === id);

  return (
    <>
      <PageHeader
        eyebrow="Agenda unificada"
        title="Sua agenda em uma só visão."
        subtitle="Reuniões pessoais e profissionais sem trocar de conta."
        user={{ name: ctx.displayName, avatarUrl: ctx.avatarUrl }}
      />

      {sp.error && (
        <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-corpo text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {ERROR_MESSAGES[sp.error] ?? "Ocorreu um erro na conexão."}
        </div>
      )}
      {sp.connected && !sp.error && (
        <div className="mb-5 rounded-md border border-line bg-surface-muted px-4 py-3 text-corpo text-ink-muted">
          Conta {sp.connected} conectada.
          {sp.sync === "failed" && " A primeira sincronização falhou — tente sincronizar manualmente."}
        </div>
      )}

      {!googleConfigured && (
        <div className="mb-5 rounded-md border border-line bg-surface px-4 py-3 text-corpo text-ink-muted">
          <strong className="font-medium text-ink">Configuração pendente.</strong> Defina{" "}
          <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>,{" "}
          <code>GOOGLE_REDIRECT_URI</code> e <code>TOKEN_ENCRYPTION_KEY</code> para conectar o Google
          Calendar. Consulte <code>docs/google-calendar-setup.md</code>.
        </div>
      )}

      <section className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-ink">Contas conectadas</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2].map((slot) => {
            const account = accountsBySlot.get(slot) ?? null;
            return (
              <CalendarAccountCard
                key={slot}
                slot={slot as 1 | 2}
                account={account}
                sources={account ? sourcesByAccount(account.id) : []}
                googleConfigured={googleConfigured}
              />
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">Eventos</h2>
        <CalendarViews
          events={events}
          accounts={accounts}
          sources={sources as CalendarSource[]}
          initialView={ctx.preferences?.default_calendar_view ?? "week"}
          related={related}
          linkCandidates={[...tarefas, ...capturas]}
        />
      </section>
    </>
  );
}
