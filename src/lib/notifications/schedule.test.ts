import { describe, expect, it } from "vitest";
import { findDueReminders, reminderKey, describeLead, meetLinkOf } from "./schedule";
import type { CalendarEvent } from "@/lib/database.types";

function event(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "e1",
    user_id: "u1",
    calendar_account_id: "a1",
    calendar_source_id: "s1",
    google_event_id: "g1",
    etag: null,
    status: "confirmed",
    summary: "Daily",
    description: null,
    location: null,
    html_link: null,
    start_at: null,
    end_at: null,
    start_date: null,
    end_date: null,
    all_day: false,
    organizer: null,
    attendees: null,
    conference_data: null,
    recurring_event_id: null,
    original_start_time: null,
    created_at_google: null,
    updated_at_google: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

const NOW = new Date("2026-07-28T09:00:00.000Z");
const inMinutes = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();

describe("findDueReminders", () => {
  it("dispara quando o evento entra na janela de antecedência", () => {
    const due = findDueReminders([event({ start_at: inMinutes(15) })], [15], { now: NOW });
    expect(due).toHaveLength(1);
    expect(due[0]!.leadMinutes).toBe(15);
  });

  it("não dispara antes da hora", () => {
    // Evento em 20 min com antecedência 15 → só deve disparar daqui a 5 min.
    const due = findDueReminders([event({ start_at: inMinutes(20) })], [15], { now: NOW });
    expect(due).toHaveLength(0);
  });

  it("suporta várias antecedências no mesmo evento", () => {
    const due = findDueReminders([event({ start_at: inMinutes(30) })], [30, 5], { now: NOW });
    expect(due).toHaveLength(1);
    expect(due[0]!.leadMinutes).toBe(30);
  });

  it("ignora eventos de dia inteiro", () => {
    const due = findDueReminders(
      [event({ all_day: true, start_date: "2026-07-28", start_at: inMinutes(15) })],
      [15],
      { now: NOW },
    );
    expect(due).toHaveLength(0);
  });

  it("ignora eventos cancelados", () => {
    const due = findDueReminders(
      [event({ status: "cancelled", start_at: inMinutes(15) })],
      [15],
      { now: NOW },
    );
    expect(due).toHaveLength(0);
  });

  it("ignora eventos que já começaram", () => {
    const due = findDueReminders([event({ start_at: inMinutes(-1) })], [15], { now: NOW });
    expect(due).toHaveLength(0);
  });

  it("respeita a janela: fora dela não dispara", () => {
    // 10 min de antecedência, evento em 15 → falta muito, janela de 60 s.
    const due = findDueReminders([event({ start_at: inMinutes(15) })], [10], {
      now: NOW,
      windowMs: 60_000,
    });
    expect(due).toHaveLength(0);
  });
});

describe("reminderKey", () => {
  it("é estável e casa com a UNIQUE do banco", () => {
    expect(reminderKey("e1", 15)).toBe("e1:15:in_app");
    expect(reminderKey("e1", 15, "push")).toBe("e1:15:push");
  });
});

describe("describeLead", () => {
  it("descreve em português", () => {
    expect(describeLead(0)).toBe("agora");
    expect(describeLead(15)).toBe("em 15 min");
    expect(describeLead(60)).toBe("em 1 hora");
    expect(describeLead(120)).toBe("em 2 horas");
  });
});

describe("meetLinkOf", () => {
  it("extrai o link de vídeo do blob do Google, já analisado", () => {
    const e = event({
      conference_data: {
        entryPoints: [
          { entryPointType: "phone", uri: "tel:+551199999" },
          { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" },
        ],
      },
    });
    const link = meetLinkOf(e);
    expect(link?.href).toBe("https://meet.google.com/abc-defg-hij");
    expect(link?.ehGoogleMeet).toBe(true);
  });

  it("devolve null quando não há conferência", () => {
    expect(meetLinkOf(event({}))).toBeNull();
  });

  /*
    SB-SEC-019. O convite de agenda é conteúdo de terceiro: quem sabe seu e-mail
    cria um evento, te convida, e o `uri` que ele escolher é sincronizado. A
    filtragem mora nesta função — o único ponto onde o valor sai do blob — para
    que nenhum chamador receba a string crua sem perceber.
  */
  it("recusa link que não é https", () => {
    const e = event({
      conference_data: {
        entryPoints: [{ entryPointType: "video", uri: "javascript:alert(1)" }],
      },
    });
    expect(meetLinkOf(e)).toBeNull();
  });

  it("não carimba Google Meet num host falsificado", () => {
    const e = event({
      conference_data: {
        entryPoints: [
          { entryPointType: "video", uri: "https://meet.google.com.phishing.example/x" },
        ],
      },
    });
    const link = meetLinkOf(e);
    expect(link?.ehGoogleMeet).toBe(false);
    expect(link?.hostname).toBe("meet.google.com.phishing.example");
  });
});
