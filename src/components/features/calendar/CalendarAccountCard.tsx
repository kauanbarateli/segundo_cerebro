"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icons";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { useToast } from "@/components/ui/Toast";
import type { CalendarAccount, CalendarSource } from "@/lib/database.types";
import { tomDaConta } from "@/lib/calendar-colors";
import { formatDayLabel, formatTime } from "@/lib/utils";
import { setAccountNickname, setSourceEnabled } from "@/app/(app)/calendario/actions";

const STATUS_LABEL: Record<string, string> = {
  connected: "Conectada",
  expired: "Sessão expirada",
  error: "Erro de sincronização",
  disconnected: "Desconectada",
};

export function CalendarAccountCard({
  slot,
  account,
  sources,
  googleConfigured,
}: {
  slot: 1 | 2;
  account: CalendarAccount | null;
  sources: CalendarSource[];
  googleConfigured: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [syncing, startSync] = useTransition();
  const [, startToggle] = useTransition();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const connectHref = `/api/google/calendar/connect?slot=${slot}`;

  if (!account) {
    return (
      <Card className="flex flex-col justify-between p-5">
        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="eyebrow">Conta {slot}</p>
            <Badge tone="outline">Vazio</Badge>
          </div>
          <p className="text-sm font-medium text-ink">Nenhuma conta conectada</p>
          <p className="mt-1 text-corpo text-ink-subtle">
            Conecte uma conta Google para ver os compromissos aqui.
          </p>
        </div>
        {googleConfigured ? (
          <a
            href={connectHref}
            className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-ink hover:opacity-90"
          >
            <Icon.Google width={16} height={16} /> Conectar conta Google
          </a>
        ) : (
          <p className="mt-4 rounded-md border border-line bg-surface-muted px-3 py-2 text-legenda text-ink-subtle">
            Configuração do Google pendente. Veja docs/google-calendar-setup.md.
          </p>
        )}
      </Card>
    );
  }

  async function post(path: string) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: account!.id }),
    });
    return res.json() as Promise<{ ok: boolean; error?: string }>;
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="eyebrow">Conta {slot}</p>
        <Badge tone={account.status === "connected" ? "outline" : "default"}>
          {STATUS_LABEL[account.status] ?? account.status}
        </Badge>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-ink">
          <Icon.Google width={16} height={16} />
        </div>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium text-ink">
            {/*
              A LEGENDA. É aqui que se dá o apelido à conta, então é aqui que a
              cor precisa ser vista ao lado do nome — sem isso, o ponto teal na
              agenda seria uma convenção que ninguém ensinou.

              `aria-hidden` porque o nome ao lado já diz tudo o que este ponto
              diz. Anunciá-lo acrescentaria ruído sem acrescentar informação.
            */}
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 rounded-full ${tomDaConta(slot)?.ponto ?? ""}`}
            />
            <span className="truncate">{account.display_name ?? `Conta ${slot}`}</span>
          </p>
          <p className="truncate text-legenda text-ink-subtle">{account.email}</p>
        </div>
      </div>

      {/* Nickname (non-color differentiation: label + badge) */}
      <div className="mt-3 flex items-center gap-2">
        <span className="text-legenda text-ink-subtle">Apelido:</span>
        {["Pessoal", "Trabalho"].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() =>
              startToggle(async () => {
                const r = await setAccountNickname(account.id, n);
                if (r.ok) router.refresh();
                else toast(r.error ?? "Erro", "error");
              })
            }
            className={`rounded-full border px-2.5 py-1 text-legenda ${
              account.display_name === n
                ? "border-transparent bg-accent text-accent-ink"
                : "border-line-strong text-ink-muted hover:bg-surface-muted"
            }`}
          >
            {n}
          </button>
        ))}
      </div>

      {account.status === "error" && account.last_error && (
        <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-legenda text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {account.last_error}
        </p>
      )}

      {/* Calendars */}
      {sources.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-legenda font-medium text-ink-muted">Calendários</p>
          <ul className="space-y-1.5">
            {sources.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`src-${s.id}`}
                  defaultChecked={s.is_enabled}
                  onChange={(e) =>
                    startToggle(async () => {
                      const r = await setSourceEnabled(s.id, e.target.checked);
                      if (r.ok) router.refresh();
                      else toast(r.error ?? "Erro", "error");
                    })
                  }
                  className="h-4 w-4 rounded border-line-strong"
                />
                <label htmlFor={`src-${s.id}`} className="min-w-0 flex-1 truncate text-corpo text-ink">
                  {s.summary ?? s.google_calendar_id}
                </label>
                {s.is_primary && <Badge tone="outline">Principal</Badge>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 text-legenda text-ink-subtle">
        {account.last_synced_at
          ? `Última sincronização: ${formatDayLabel(account.last_synced_at)} ${formatTime(account.last_synced_at)}`
          : "Ainda não sincronizado"}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={syncing}
          onClick={() =>
            startSync(async () => {
              const r = await post("/api/google/calendar/sync");
              if (r.ok) {
                toast("Sincronizado", "success");
                router.refresh();
              } else {
                toast(r.error ?? "Falha ao sincronizar", "error");
              }
            })
          }
        >
          <Icon.Refresh width={14} height={14} /> {syncing ? "Sincronizando…" : "Sincronizar agora"}
        </Button>
        <a
          href={connectHref}
          className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line-strong px-3 text-corpo font-medium text-ink hover:bg-surface-muted"
        >
          Reconectar
        </a>
        <Button variant="danger" size="sm" onClick={() => setConfirmDisconnect(true)}>
          Desconectar
        </Button>
      </div>

      <ConfirmationDialog
        open={confirmDisconnect}
        title="Desconectar conta"
        description="Os eventos em cache desta conta serão removidos. Você pode reconectar depois."
        confirmLabel="Desconectar"
        destructive
        onCancel={() => setConfirmDisconnect(false)}
        onConfirm={() => {
          setConfirmDisconnect(false);
          startSync(async () => {
            const r = await post("/api/google/calendar/disconnect");
            if (r.ok) {
              toast("Conta desconectada", "success");
              router.refresh();
            } else {
              toast(r.error ?? "Erro", "error");
            }
          });
        }}
      />
    </Card>
  );
}
