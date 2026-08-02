import type { CalendarEvent } from "@/lib/database.types";
import { analisarLinkExterno, type LinkExterno } from "@/lib/external-link";

/**
 * Lógica pura de agendamento de lembretes — sem I/O, para ser testável e
 * reutilizável tanto no cliente (fase 7a) quanto no despacho de push (7b).
 */

export interface DueReminder {
  event: CalendarEvent;
  leadMinutes: number;
  /** Instante em que o lembrete deveria disparar. */
  scheduledFor: Date;
}

export interface WindowOptions {
  now: Date;
  /** Tolerância para trás, para não perder o disparo entre execuções. */
  windowMs?: number;
}

/**
 * Retorna os lembretes que entraram na janela de disparo.
 *
 * Um lembrete é devido quando `now` está entre (início - antecedência) e
 * (início - antecedência + janela). A janela evita que um evento seja perdido
 * quando o verificador roda a cada N segundos e não exatamente no minuto.
 *
 * Eventos de dia inteiro e cancelados são ignorados: não têm horário útil e
 * não devem gerar aviso.
 */
export function findDueReminders(
  events: CalendarEvent[],
  leadMinutes: number[],
  { now, windowMs = 60_000 }: WindowOptions,
): DueReminder[] {
  const due: DueReminder[] = [];
  const nowMs = now.getTime();

  for (const event of events) {
    if (event.all_day) continue;
    if (event.status === "cancelled") continue;
    if (!event.start_at) continue;

    const startMs = new Date(event.start_at).getTime();
    if (!Number.isFinite(startMs)) continue;

    // Já começou: não faz sentido lembrar.
    if (startMs <= nowMs) continue;

    for (const lead of leadMinutes) {
      const fireAt = startMs - lead * 60_000;
      if (nowMs >= fireAt && nowMs < fireAt + windowMs) {
        due.push({ event, leadMinutes: lead, scheduledFor: new Date(fireAt) });
      }
    }
  }

  return due;
}

/** Chave estável de deduplicação (mesma tupla da UNIQUE do banco). */
export function reminderKey(eventId: string, leadMinutes: number, channel = "in_app"): string {
  return `${eventId}:${leadMinutes}:${channel}`;
}

export function describeLead(minutes: number): string {
  if (minutes === 0) return "agora";
  if (minutes < 60) return `em ${minutes} min`;
  const hours = minutes / 60;
  return `em ${hours === 1 ? "1 hora" : `${hours} horas`}`;
}

/**
 * Extrai o link de videoconferência do blob cacheado do Google, JÁ VALIDADO.
 *
 * A validação mora aqui, e não em quem renderiza, porque este é o único ponto
 * onde o `uri` sai do blob: filtrar na saída da fonte garante que nenhum
 * chamador futuro receba a string crua sem perceber. Devolve `null` quando o
 * link não é um https legítimo — ver src/lib/external-link.ts.
 */
export function meetLinkOf(event: CalendarEvent): LinkExterno | null {
  const data = event.conference_data as
    | { entryPoints?: { entryPointType?: string; uri?: string }[] }
    | null;
  const uri = data?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;
  return analisarLinkExterno(uri);
}
