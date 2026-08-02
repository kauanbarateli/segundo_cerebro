"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icons";
import type { CalendarEvent } from "@/lib/database.types";
import { findDueReminders, reminderKey, describeLead, meetLinkOf } from "@/lib/notifications/schedule";
import { formatTime } from "@/lib/utils";

interface ActiveReminder {
  key: string;
  event: CalendarEvent;
  leadMinutes: number;
}

const CHECK_INTERVAL_MS = 30_000;

/**
 * Fase 7a — lembrete enquanto a aplicação está aberta.
 *
 * Limite conhecido: um timer no cliente morre junto com a aba. Avisar com o
 * app fechado exige Web Push + agendador no servidor (fase 7b).
 */
export function MeetingReminder({
  events,
  leadMinutes,
}: {
  events: CalendarEvent[];
  leadMinutes: number[];
}) {
  const [active, setActive] = useState<ActiveReminder[]>([]);
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (events.length === 0 || leadMinutes.length === 0) return;

    function check() {
      const due = findDueReminders(events, leadMinutes, { now: new Date(), windowMs: CHECK_INTERVAL_MS * 2 });
      const fresh = due.filter((d) => !firedRef.current.has(reminderKey(d.event.id, d.leadMinutes)));
      if (fresh.length === 0) return;

      for (const d of fresh) {
        const key = reminderKey(d.event.id, d.leadMinutes);
        firedRef.current.add(key);

        // Notificação do sistema quando houver permissão. Funciona com a aba em
        // segundo plano, desde que o navegador esteja aberto.
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            new Notification(d.event.summary ?? "Reunião", {
              body: `Começa ${describeLead(d.leadMinutes)} · ${formatTime(d.event.start_at)}`,
              tag: key,
            });
          } catch {
            // Alguns navegadores exigem service worker; o banner cobre o caso.
          }
        }
      }

      setActive((prev) => [
        ...prev,
        ...fresh.map((d) => ({
          key: reminderKey(d.event.id, d.leadMinutes),
          event: d.event,
          leadMinutes: d.leadMinutes,
        })),
      ]);
    }

    check();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [events, leadMinutes]);

  if (active.length === 0) return null;

  return (
    <div className="sticky top-0 z-30 flex flex-col">
      {active.map((r) => {
        const link = meetLinkOf(r.event);
        return (
          <div
            key={r.key}
            role="status"
            /* `animate-list-in`: esta faixa aparece SOZINHA, no meio da leitura,
               e empurra a página inteira para baixo. Sem entrada, o conteúdo
               parece ter saltado por conta própria; com os 4px de deslocamento,
               fica claro que algo NOVO chegou e que foi ele que empurrou. É o
               caso em que movimento não é enfeite, é explicação.

               Chave estável (`r.key` = evento + antecedência), então cada
               lembrete anima uma vez só, na montagem. Nenhum estado novo. */
            className="flex animate-list-in items-center gap-3 border-b border-line bg-accent px-4 py-2.5 text-accent-ink"
          >
            <Icon.Bell width={16} height={16} className="shrink-0" />
            <p className="min-w-0 flex-1 truncate text-corpo">
              <span className="font-semibold">{r.event.summary ?? "Reunião"}</span>
              <span className="opacity-80">
                {" "}
                começa {describeLead(r.leadMinutes)} · {formatTime(r.event.start_at)}
              </span>
            </p>
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-sm bg-surface px-2.5 py-1 text-legenda font-medium text-ink hover:opacity-90"
              >
                Entrar no Meet
              </a>
            )}
            <button
              type="button"
              aria-label="Dispensar lembrete"
              onClick={() => setActive((prev) => prev.filter((x) => x.key !== r.key))}
              className="shrink-0 rounded-sm p-1 opacity-70 hover:opacity-100"
            >
              <Icon.X width={15} height={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
