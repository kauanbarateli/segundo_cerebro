"use client";

import { useMemo, useState } from "react";
import { Badge, PillButton } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/states";
import { CalendarEventCard } from "@/components/features/calendar/CalendarEventCard";
import { DetalheDoEvento } from "@/components/features/calendar/DetalheDoEvento";
import { RelatedSection } from "@/components/features/links/RelatedSection";
import type { CalendarAccount, CalendarEvent, CalendarSource, CalendarView } from "@/lib/database.types";
import type { RelatedItem } from "@/lib/links";
import { rotuloDaConta, tomDaConta, type TomDaConta } from "@/lib/calendar-colors";
import { cn, formatTime, startOfDay } from "@/lib/utils";

/** Views disponíveis nesta versão (Lista foi removida). */
type ViewKey = "day" | "week" | "month";

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "day", label: "Dia" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mês" },
];

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const WEEKDAYS_LONG = [
  "Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira",
  "Quinta-feira", "Sexta-feira", "Sábado",
];
const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function eventDate(ev: CalendarEvent): Date {
  if (ev.start_at) return new Date(ev.start_at);
  if (ev.start_date) {
    const [y, m, d] = ev.start_date.split("-").map(Number);
    return new Date(y!, (m ?? 1) - 1, d ?? 1);
  }
  return new Date(0);
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay()); // semana começa no domingo
  return x;
}

/** A preferência salva pode ser 'list' (legado) — cai para 'week'. */
function normalizeView(v: CalendarView): ViewKey {
  return v === "day" || v === "week" || v === "month" ? v : "week";
}

export function CalendarViews({
  events,
  accounts,
  sources,
  initialView,
  related,
  linkCandidates,
}: {
  events: CalendarEvent[];
  accounts: CalendarAccount[];
  sources: CalendarSource[];
  initialView: CalendarView;
  /** Vínculos de todos os eventos da janela, em lote (ver getRelatedItems). */
  related: Map<string, RelatedItem[]>;
  /** Tarefas e capturas oferecidas no autocomplete. */
  linkCandidates: RelatedItem[];
}) {
  const [view, setView] = useState<ViewKey>(() => normalizeView(initialView));
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [accountFilter, setAccountFilter] = useState<string | "all">("all");
  // Só o id no estado; o objeto é derivado da prop a cada render, como faz a
  // CaptureView. Uma sincronização do Google pode reescrever o evento enquanto
  // o detalhe está aberto — guardar a cópia congelaria o modal no texto velho.
  const [detailId, setDetailId] = useState<string | null>(null);

  const contarVinculos = (id: string) => related.get(id)?.length ?? 0;

  const enabledSourceIds = useMemo(
    () => new Set(sources.filter((s) => s.is_enabled).map((s) => s.id)),
    [sources],
  );
  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const visibleEvents = useMemo(
    () =>
      events
        // Cancelado some da agenda, COM UMA EXCEÇÃO: se tem vínculo, fica.
        // `getEventsForCalendar` já se dá ao trabalho de trazer justamente esses
        // (é a razão de o cancelamento ser soft delete desde a 0009) — filtrar
        // todos aqui desfaria isso e a tarefa ficaria apontando para uma reunião
        // que o usuário não consegue mais ver. O card já esmaece e risca o
        // cancelado, então ele aparece como o que é.
        .filter((e) => e.status !== "cancelled" || (related.get(e.id)?.length ?? 0) > 0)
        .filter((e) => enabledSourceIds.has(e.calendar_source_id))
        .filter((e) => accountFilter === "all" || e.calendar_account_id === accountFilter)
        .sort((a, b) => eventDate(a).getTime() - eventDate(b).getTime()),
    [events, enabledSourceIds, accountFilter, related],
  );

  // Derivado da prop, não do estado: ver o comentário de `detailId`. Buscar em
  // `events` (e não em `visibleEvents`) porque trocar o filtro de conta com o
  // detalhe aberto não é motivo para fechá-lo.
  const detail = events.find((e) => e.id === detailId) ?? null;

  function badgeFor(ev: CalendarEvent): string | undefined {
    return rotuloDaConta(accountById.get(ev.calendar_account_id));
  }

  /**
   * O tom da conta do evento — irmão de `badgeFor`, e sempre usado JUNTO com
   * ele.
   *
   * ⚠️ Com UMA conta só não há o que distinguir, e a coloração vira ruído: uma
   * agenda inteira pintada de teal não informa nada. `null` faz cada ponto de
   * aplicação cair no visual anterior, sem caso especial em nenhum deles.
   */
  const colorir = accounts.length > 1;
  function tomFor(ev: CalendarEvent) {
    if (!colorir) return null;
    return tomDaConta(accountById.get(ev.calendar_account_id)?.slot);
  }

  function navigate(dir: -1 | 0 | 1) {
    if (dir === 0) return setAnchor(new Date());
    if (view === "day") return setAnchor((d) => addDays(d, dir));
    if (view === "week") return setAnchor((d) => addDays(d, dir * 7));
    return setAnchor((d) => new Date(d.getFullYear(), d.getMonth() + dir, 1));
  }

  const title = useMemo(() => {
    if (view === "month") return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`;
    if (view === "day")
      return anchor.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
    const s = startOfWeek(anchor);
    const e = addDays(s, 6);
    return `${s.getDate()}/${s.getMonth() + 1} – ${e.getDate()}/${e.getMonth() + 1}`;
  }, [view, anchor]);

  return (
    <Card className="overflow-hidden">
      {/* Barra de navegação — empilha no mobile, alinha no desktop */}
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} aria-label="Período anterior">
            ‹
          </Button>
          <Button variant="secondary" size="sm" onClick={() => navigate(0)}>
            Hoje
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate(1)} aria-label="Próximo período">
            ›
          </Button>
          <span className="ml-1 truncate text-sm font-medium text-ink">{title}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {VIEWS.map((v) => (
            <PillButton key={v.key} active={view === v.key} onClick={() => setView(v.key)}>
              {v.label}
            </PillButton>
          ))}
        </div>
      </div>

      {accounts.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5">
          <PillButton active={accountFilter === "all"} onClick={() => setAccountFilter("all")}>
            Todas as contas
          </PillButton>
          {/*
            ESTA FILEIRA É A LEGENDA. As pills de filtro já traziam o nome de
            cada conta; com o ponto colorido ao lado, elas passam a ensinar o
            código de cores sem que nada novo apareça na tela. Uma legenda
            separada seria um segundo lugar dizendo a mesma coisa.
          */}
          {accounts.map((a) => {
            const tom = colorir ? tomDaConta(a.slot) : null;
            return (
              <PillButton
                key={a.id}
                active={accountFilter === a.id}
                onClick={() => setAccountFilter(a.id)}
              >
                {tom && (
                  <span
                    aria-hidden
                    className={cn("h-2 w-2 shrink-0 rounded-full", tom.ponto)}
                  />
                )}
                {rotuloDaConta(a)}
              </PillButton>
            );
          })}
        </div>
      )}

      <div className="p-4">
        {view === "day" && (
          <DayList
            events={visibleEvents.filter((e) => sameDay(eventDate(e), anchor))}
            badgeFor={badgeFor}
            tomFor={tomFor}
            onOpen={setDetailId}
            linkCountOf={contarVinculos}
          />
        )}
        {view === "week" && (
          <WeekView
            events={visibleEvents}
            badgeFor={badgeFor}
            tomFor={tomFor}
            anchor={anchor}
            onOpen={setDetailId}
            linkCountOf={contarVinculos}
          />
        )}
        {view === "month" && (
          <MonthView
            events={visibleEvents}
            anchor={anchor}
            // A única assinatura que muda de verdade: o mês não tinha rótulo de
            // conta nenhum, então precisa dos dois para poder dizer de quem é
            // cada faixa. Ver o comentário dentro do componente.
            badgeFor={badgeFor}
            tomFor={tomFor}
            onPick={(d) => {
              setAnchor(d);
              setView("day");
            }}
          />
        )}
      </div>

      {/*
        DETALHE DO EVENTO — o diálogo mora em `DetalheDoEvento.tsx`.

        Não existia lugar nenhum na agenda onde a seção "Relacionado" coubesse:
        o card era uma <div> sem interação e o chip da semana, um retângulo com
        `title`. Em vez de inventar uma tela de evento, o diálogo REAPROVEITA o
        próprio card e acrescenta só a seção de vínculos.

        O corpo saiu daqui quando o Início passou a abrir o mesmo painel — sem a
        extração seriam dois modais de evento, e só um deles receberia a próxima
        correção. Nada mudou nesta tela: o Calendário continua sem descrição e
        sem link do Google (`mostrarDetalhes` fica desligado), e os vínculos
        continuam sendo a razão de este diálogo existir.
      */}
      {detail && (
        <DetalheDoEvento
          evento={detail}
          contaRotulo={badgeFor(detail)}
          tom={tomFor(detail)}
          onFechar={() => setDetailId(null)}
        >
          <RelatedSection
            className="mt-4"
            entity={{ kind: "event", id: detail.id }}
            related={related.get(detail.id) ?? []}
            candidates={linkCandidates}
          />
        </DetalheDoEvento>
      )}
    </Card>
  );
}

/** Assinatura comum a todas as visões: rótulo e tom saem sempre juntos. */
type TomDeEvento = (e: CalendarEvent) => TomDaConta | null;

function DayList({
  events,
  badgeFor,
  tomFor,
  onOpen,
  linkCountOf,
}: {
  events: CalendarEvent[];
  badgeFor: (e: CalendarEvent) => string | undefined;
  tomFor: TomDeEvento;
  onOpen: (id: string) => void;
  linkCountOf: (id: string) => number;
}) {
  if (events.length === 0) return <EmptyState icon="Calendar" title="Sem eventos neste dia" />;
  return (
    <div className="space-y-2">
      {events.map((e) => (
        <CalendarEventCard
          key={e.id}
          event={e}
          accountBadge={badgeFor(e)}
          tom={tomFor(e)}
          linkCount={linkCountOf(e.id)}
          onOpen={() => onOpen(e.id)}
        />
      ))}
    </div>
  );
}

/**
 * Chip compacto usado nas células da semana. Diferente do card completo, ele
 * empilha horário e título verticalmente para caber em colunas estreitas, e
 * identifica a conta por um marcador + rótulo curto (nunca só por cor).
 */
function WeekEventChip({
  event,
  accountLabel,
  tom,
  linkCount,
  onOpen,
}: {
  event: CalendarEvent;
  accountLabel?: string;
  tom: TomDaConta | null;
  linkCount: number;
  onOpen: () => void;
}) {
  const time = event.all_day ? "Dia inteiro" : formatTime(event.start_at);
  return (
    /*
      O chip inteiro é o botão — aqui, diferente do card, isso é seguro: não há
      link do Meet nem nenhum outro controle dentro dele, então não se cria
      interativo aninhado. Os filhos são <span> pelo mesmo motivo de validade que
      a caixa de entrada já seguia (o conteúdo permitido de <button> é conteúdo
      de frase) e desenham igual com display block/flex.

      Sem isso, a visão de semana no desktop — que só mostra chips — seria o
      único lugar da agenda sem como abrir o evento e vincular alguma coisa.
    */
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "w-full rounded-sm border border-line bg-surface px-2 py-1.5 text-left hover:bg-surface-muted",
        tom?.trilho,
      )}
      title={`${time} · ${event.summary ?? "(sem título)"}${accountLabel ? ` · ${accountLabel}` : ""}`}
    >
      <span className="block text-meta font-medium leading-tight text-ink-muted">{time}</span>
      <span className="mt-0.5 line-clamp-2 block text-legenda font-medium leading-snug text-ink">
        {event.summary ?? "(sem título)"}
      </span>
      {accountLabel && (
        <span className="mt-1 flex items-center gap-1 text-micro leading-none text-ink-subtle">
          {/* Este ponto já existia — e era SEMPRE cinza, em todas as contas.
              Ele desenhava um marcador que não marcava nada. */}
          <span
            aria-hidden
            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tom?.ponto ?? "bg-ink-subtle")}
          />
          <span className="truncate">{accountLabel}</span>
        </span>
      )}
      {linkCount > 0 && (
        // O chip é estreito demais para o selo completo: aqui a informação vira
        // um número com rótulo acessível, em vez de "2 vínculos" quebrando a
        // coluna em três linhas.
        <span className="mt-1 flex items-center gap-1 text-micro leading-none text-ink-subtle">
          <Badge tone="outline" className="px-1.5 py-0 text-micro">
            {linkCount}
          </Badge>
          <span className="sr-only">{linkCount === 1 ? "vínculo" : "vínculos"}</span>
        </span>
      )}
    </button>
  );
}

function WeekView({
  events,
  badgeFor,
  tomFor,
  anchor,
  onOpen,
  linkCountOf,
}: {
  events: CalendarEvent[];
  badgeFor: (e: CalendarEvent) => string | undefined;
  tomFor: TomDeEvento;
  anchor: Date;
  onOpen: (id: string) => void;
  linkCountOf: (id: string) => number;
}) {
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = new Date();
  const byDay = days.map((day) => ({
    day,
    isToday: sameDay(day, today),
    events: events.filter((e) => sameDay(eventDate(e), day)),
  }));

  return (
    <>
      {/* Desktop/tablet: 7 colunas. As colunas rolam horizontalmente se ficarem
          estreitas demais, em vez de espremer o conteúdo.

          O piso é 760px, o valor original. Ele chegou a subir para 900px porque
          a escala do DS 1.0 aumentou o texto do título do evento; com os
          tamanhos revertidos (ver a nota em tailwind.config.ts) o piso volta
          junto — mantê-lo em 900px só produziria rolagem horizontal em telas
          onde as colunas cabiam. A conta: 760 − 6 gaps de 8px = 712 ÷ 7 ≈ 102px
          por coluna, que em 12px dá ~13 caracteres por linha de título. */}
      <div className="-mx-1 hidden overflow-x-auto px-1 pb-1 md:block">
        <div className="grid min-w-[760px] grid-cols-7 items-start gap-2">
          {byDay.map(({ day, isToday, events: dayEvents }) => (
            <div key={day.toISOString()} className="min-w-0">
              <div
                className={cn(
                  "mb-2 rounded-md px-2 py-1.5 text-center text-legenda font-medium",
                  isToday ? "bg-accent text-accent-ink" : "text-ink-muted",
                )}
              >
                {WEEKDAYS[day.getDay()]} {day.getDate()}
              </div>
              <div className="space-y-1.5">
                {dayEvents.length === 0 ? (
                  <p className="py-2 text-center text-meta text-ink-subtle">—</p>
                ) : (
                  dayEvents.map((e) => (
                    <WeekEventChip
                      key={e.id}
                      event={e}
                      accountLabel={badgeFor(e)}
                      tom={tomFor(e)}
                      linkCount={linkCountOf(e.id)}
                      onOpen={() => onOpen(e.id)}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Mobile: dias empilhados em seções legíveis, sem colunas espremidas. */}
      <div className="space-y-4 md:hidden">
        {byDay.map(({ day, isToday, events: dayEvents }) => (
          <div key={day.toISOString()}>
            <div className="mb-2 flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-legenda font-medium",
                  isToday ? "bg-accent text-accent-ink" : "bg-surface-muted text-ink-muted",
                )}
              >
                {day.getDate()}
              </span>
              <span className="text-corpo font-medium text-ink">{WEEKDAYS_LONG[day.getDay()]}</span>
            </div>
            {dayEvents.length === 0 ? (
              <p className="pl-8 text-legenda text-ink-subtle">Sem eventos</p>
            ) : (
              <div className="space-y-2">
                {dayEvents.map((e) => (
                  <CalendarEventCard
                    key={e.id}
                    event={e}
                    compact
                    accountBadge={badgeFor(e)}
                    tom={tomFor(e)}
                    linkCount={linkCountOf(e.id)}
                    onOpen={() => onOpen(e.id)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * ⚠️ A VISÃO QUE MAIS EXIGE CUIDADO COM A COR.
 *
 * É a única do calendário sem rótulo de conta nenhum: a célula do mês só tem
 * espaço para o título do evento, cortado. Pintar a faixa aqui e parar por aí
 * faria do mês o ÚNICO lugar do aplicativo onde a cor é o único diferenciador —
 * exatamente o que a regra "nunca só por cor" existe para impedir.
 *
 * Por isso o nome da conta entra de duas formas que não ocupam espaço: no
 * `title` (ponteiro parado) e num `sr-only` (leitor de tela). O texto está lá
 * para quem precisar dele; só não está desenhado.
 */
function MonthView({
  events,
  anchor,
  badgeFor,
  tomFor,
  onPick,
}: {
  events: CalendarEvent[];
  anchor: Date;
  badgeFor: (e: CalendarEvent) => string | undefined;
  tomFor: TomDeEvento;
  onPick: (d: Date) => void;
}) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = new Date();

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div className="min-w-[560px]">
        <div className="mb-1 grid grid-cols-7 gap-1 text-center text-meta text-ink-subtle">
          {WEEKDAYS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((day) => {
            const inMonth = day.getMonth() === anchor.getMonth();
            const dayEvents = events.filter((e) => sameDay(eventDate(e), day));
            const isToday = sameDay(day, today);
            return (
              <button
                key={day.toISOString()}
                onClick={() => onPick(day)}
                className={cn(
                  "min-h-[76px] rounded-md border border-line p-1.5 text-left transition-colors hover:bg-surface-muted",
                  !inMonth && "opacity-40",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-5 w-5 items-center justify-center rounded-full text-legenda",
                    isToday ? "bg-accent text-accent-ink" : "text-ink",
                  )}
                >
                  {day.getDate()}
                </span>
                <div className="mt-1 space-y-0.5">
                  {dayEvents.slice(0, 2).map((e) => {
                    const titulo = e.summary ?? "(sem título)";
                    const conta = badgeFor(e);
                    return (
                      <div
                        key={e.id}
                        className={cn(
                          "truncate rounded-sm bg-surface-muted px-1 py-0.5 text-micro text-ink-muted",
                          tomFor(e)?.trilho,
                        )}
                        title={conta ? `${titulo} · ${conta}` : titulo}
                      >
                        {titulo}
                        {conta && <span className="sr-only"> — {conta}</span>}
                      </div>
                    );
                  })}
                  {dayEvents.length > 2 && (
                    <div className="px-1 text-micro text-ink-subtle">+{dayEvents.length - 2}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
