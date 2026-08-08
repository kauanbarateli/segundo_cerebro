import { FUSO_DO_APP } from "@/lib/tempo";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Reexportado de `tempo.ts` em vez de redeclarado. Eram duas constantes com o
 * mesmo valor — uma governando a EXIBIÇÃO (aqui) e nenhuma governando a
 * ENTRADA, que era exatamente o buraco por onde o horário digitado voltava
 * diferente. Uma definição só torna o ciclo fechado por construção.
 */
const TIME_ZONE = FUSO_DO_APP;

export function formatDateLong(date: Date, locale = "pt-BR"): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TIME_ZONE,
  }).format(date);
}

export function formatTime(iso: string | null, locale = "pt-BR"): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  }).format(new Date(iso));
}

export function formatDayLabel(iso: string | null, locale = "pt-BR"): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return "Hoje";
  if (diffDays === 1) return "Amanhã";
  if (diffDays === -1) return "Ontem";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: TIME_ZONE,
  }).format(date);
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/* -------------------------------------------------- o dia em um fuso ------ */

/**
 * Limites do dia civil num fuso — para consultas, não para exibição.
 *
 * POR QUE `startOfDay` NÃO SERVE AQUI. Ela usa `setHours`, que trabalha no fuso
 * LOCAL do processo. No navegador isso é o fuso da pessoa e dá certo por
 * acidente; no servidor da Vercel o processo roda em UTC, e "início do dia"
 * vira meia-noite UTC — 21h do dia ANTERIOR em São Paulo. Uma consulta de "hoje"
 * montada assim exibe, das 21h à meia-noite, os eventos de amanhã, e some com os
 * três últimos horários de hoje. O defeito só aparece à noite, o que é a pior
 * forma de um defeito aparecer.
 *
 * O QUE SAI DAQUI, e por que três campos e não dois:
 *   - `startIso`/`endIso` são INSTANTES (UTC) e servem para comparar com
 *     `start_at`, que é `timestamptz`. O fim é EXCLUSIVO — meia-noite do dia
 *     seguinte —, então nenhum evento cai fora por causa de milissegundo, que é
 *     o que um `23:59:59.999` inclusivo deixa escapar.
 *   - `dayKey` é "AAAA-MM-DD" e serve para comparar com `start_date`, que é
 *     `date` e não tem fuso nenhum. Derivar essa string do `startIso` seria
 *     errado: `startIso.slice(0, 10)` de um dia de São Paulo dá a data certa,
 *     mas a mesma conta sobre o `endIso` dá o dia SEGUINTE. Quem precisa da
 *     chave do dia tem que recebê-la pronta.
 */
export interface DayRange {
  /** "AAAA-MM-DD" no fuso pedido. Compara direto com colunas `date`. */
  dayKey: string;
  /** Instante do início do dia, ISO em UTC. Inclusivo. */
  startIso: string;
  /** Instante do início do dia SEGUINTE, ISO em UTC. Exclusivo. */
  endIso: string;
}

const partesFormatter = new Map<string, Intl.DateTimeFormat>();

function partesNoFuso(date: Date, timeZone: string) {
  let dtf = partesFormatter.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partesFormatter.set(timeZone, dtf);
  }
  const p: Record<string, number> = {};
  for (const parte of dtf.formatToParts(date)) {
    if (parte.type !== "literal") p[parte.type] = Number(parte.value);
  }
  // `hour12: false` produz "24" para a meia-noite em algumas versões do ICU.
  return { ...p, hour: (p.hour ?? 0) % 24 } as {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
}

/** Deslocamento do fuso, em ms, NO INSTANTE dado (positivo a leste de Greenwich). */
function deslocamentoNoFuso(date: Date, timeZone: string): number {
  const p = partesNoFuso(date, timeZone);
  const comoSeFosseUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // `formatToParts` não devolve milissegundos; descontá-los do outro lado é o
  // que mantém a subtração exata.
  return comoSeFosseUtc - (date.getTime() - date.getMilliseconds());
}

/**
 * Converte uma meia-noite civil em instante UTC.
 *
 * Duas passadas de propósito. A primeira usa o deslocamento do instante de
 * referência; a segunda recalcula usando o deslocamento do instante que a
 * primeira encontrou. Sem a correção, um dia cuja meia-noite fica do outro lado
 * de uma virada de horário de verão sai uma hora deslocado. O Brasil não usa
 * horário de verão desde 2019, então hoje a segunda passada é idempotente — ela
 * está aqui para que continuar correto não dependa disso continuar verdade.
 */
function instanteDaMeiaNoite(
  ano: number,
  mes: number,
  dia: number,
  referencia: Date,
  timeZone: string,
): number {
  const civilComoUtc = Date.UTC(ano, mes - 1, dia, 0, 0, 0);
  const aproximado = civilComoUtc - deslocamentoNoFuso(referencia, timeZone);
  return civilComoUtc - deslocamentoNoFuso(new Date(aproximado), timeZone);
}

export function dayRangeInTimeZone(reference: Date, timeZone: string = TIME_ZONE): DayRange {
  const p = partesNoFuso(reference, timeZone);
  // `Date.UTC` normaliza `dia + 1` sozinho na virada de mês e de ano.
  const inicio = instanteDaMeiaNoite(p.year, p.month, p.day, reference, timeZone);
  const fim = instanteDaMeiaNoite(p.year, p.month, p.day + 1, reference, timeZone);

  const dois = (n: number) => String(n).padStart(2, "0");
  return {
    dayKey: `${p.year}-${dois(p.month)}-${dois(p.day)}`,
    startIso: new Date(inicio).toISOString(),
    endIso: new Date(fim).toISOString(),
  };
}

export function greeting(date: Date, locale = "pt-BR"): string {
  const hour = Number(
    new Intl.DateTimeFormat(locale, { hour: "numeric", hour12: false, timeZone: TIME_ZONE }).format(
      date,
    ),
  );
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

export function minutesBetween(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000);
}

export function formatDuration(minutes: number | null): string {
  if (minutes == null) return "";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/* ------------------------------------------------------------------ dinheiro */

/**
 * Dinheiro trafega como INTEIRO em centavos em todo o sistema.
 * A conversão para/de texto acontece só aqui, na borda da UI — assim nenhuma
 * soma jamais toca ponto flutuante (0.1 + 0.2 !== 0.3).
 */
export function formatBRL(cents: number, opts?: { hidden?: boolean }): string {
  if (opts?.hidden) return "R$ ••••";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function formatCentsPlain(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** Aceita "1.234,56", "1234,56", "1234.56" e devolve centavos inteiros. */
export function parseBRLToCents(input: string): number | null {
  const cleaned = input.replace(/[^\d,.-]/g, "").trim();
  if (!cleaned) return null;

  let normalized = cleaned;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  if (lastComma > lastDot) {
    // Vírgula é o separador decimal (padrão pt-BR).
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    normalized = cleaned.replace(/,/g, "");
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/* ------------------------------------------------------------------- arquivos */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

export function monthLabel(iso: string, locale = "pt-BR"): string {
  const [y, m] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(y!, (m ?? 1) - 1, 1),
  );
}

/**
 * Concorda número e substantivo: `plural(1, "tarefa aberta", "tarefas abertas")`
 * → "1 tarefa aberta". Existe porque "1 tarefas abertas" na tela de abertura é
 * o tipo de detalhe que faz a interface parecer descuidada.
 */
export function plural(count: number, singular: string, many: string): string {
  return `${count} ${count === 1 ? singular : many}`;
}
