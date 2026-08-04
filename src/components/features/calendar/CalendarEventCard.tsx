import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icons";
import { LinkCountBadge } from "@/components/features/links/LinkCountBadge";
import type { CalendarEvent } from "@/lib/database.types";
import type { TomDaConta } from "@/lib/calendar-colors";
import { formatTime, minutesBetween, formatDuration, cn } from "@/lib/utils";
import { analisarLinkExterno } from "@/lib/external-link";

/**
 * Link de videoconferência do blob cacheado do Google, JÁ VALIDADO.
 *
 * `conference_data` é conteúdo de terceiro: quem te convida escolhe o `uri`.
 * `analisarLinkExterno` devolve `null` para qualquer coisa que não seja um
 * https legítimo, e só carimba "Google Meet" quando o host é exatamente
 * `meet.google.com`. Ver src/lib/external-link.ts.
 */
function conferencia(ev: CalendarEvent) {
  const data = ev.conference_data as
    | { entryPoints?: { entryPointType?: string; uri?: string }[] }
    | null;
  const entry = data?.entryPoints?.find((e) => e.entryPointType === "video");
  return analisarLinkExterno(entry?.uri);
}

export function CalendarEventCard({
  event,
  accountLabel,
  accountBadge,
  tom,
  compact = false,
  linkCount = 0,
  ended = false,
  onOpen,
}: {
  event: CalendarEvent;
  accountLabel?: string;
  accountBadge?: string;
  /**
   * A cor da conta. SEMPRE opcional, e sempre acompanhada de `accountBadge` —
   * ver `lib/calendar-colors.ts`. Um cartão colorido sem o distintivo seria o
   * caso que a regra "nunca só por cor" existe para impedir.
   */
  tom?: TomDaConta | null;
  compact?: boolean;
  /** Quantos vínculos este evento tem. Zero não desenha selo nenhum. */
  linkCount?: number;
  /**
   * Já terminou (usado na agenda do dia).
   *
   * Esmaece SEM riscar. O risco é vocabulário de cancelamento — "isto não vai
   * acontecer" — e uma reunião que terminou aconteceu. A opacidade diz apenas
   * que ela saiu do caminho: continua na lista porque o contexto do dia é útil,
   * mas não compete com o que ainda está por vir.
   */
  ended?: boolean;
  /**
   * Abre o detalhe do evento. Opcional porque a página Início também usa este
   * card e lá não existe modal para abrir.
   */
  onOpen?: () => void;
}) {
  const link = conferencia(event);
  const duration = formatDuration(minutesBetween(event.start_at, event.end_at));
  const cancelled = event.status === "cancelled";

  const titulo = event.summary ?? "(sem título)";
  const classeTitulo = cn(
    "text-sm font-medium text-ink",
    cancelled && "line-through",
    compact && "truncate",
  );

  return (
    <div
      className={cn(
        "flex gap-3 rounded-md border border-line bg-surface px-3.5 py-3",
        // O trilho vem DEPOIS de `border-line` porque é `border-l-*`: a classe
        // mais específica do lado esquerdo vence, e as outras três bordas ficam
        // como estavam.
        tom?.trilho,
        // Cancelado vence encerrado: os dois esmaecem igual, mas só o cancelado
        // risca o título, e as classes não se somam de forma útil.
        (cancelled || ended) && "opacity-60",
      )}
    >
      <div className="w-14 shrink-0 pt-0.5 text-corpo font-medium text-ink-muted">
        {event.all_day ? "Dia" : formatTime(event.start_at)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          {/*
            Só o TÍTULO vira botão, nunca o card inteiro: o card já contém o
            link do Google Meet, e um <a> dentro de <button> é HTML inválido,
            dá aviso do React e deixa o clique ambíguo. Mesmo raciocínio que a
            lista da caixa de entrada já usava.
          */}
          {onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              className={cn(classeTitulo, "min-w-0 rounded-sm text-left hover:underline focus-visible:outline-2")}
            >
              {titulo}
            </button>
          ) : (
            <p className={classeTitulo}>{titulo}</p>
          )}
          {accountBadge && (
            <Badge tone="outline" className="shrink-0">
              {tom && <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", tom.ponto)} />}
              {accountBadge}
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-legenda text-ink-subtle">
          {duration && (
            <span className="inline-flex items-center gap-1">
              <Icon.Clock width={12} height={12} /> {duration}
            </span>
          )}
          {event.location && (
            <span className="inline-flex items-center gap-1">
              <Icon.MapPin width={12} height={12} /> {event.location}
            </span>
          )}
          {accountLabel && <span>{accountLabel}</span>}
          {cancelled && <span className="text-red-500">Cancelado</span>}
          <LinkCountBadge count={linkCount} />
        </div>
        {!compact && (event.organizer || link) && (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-legenda">
            {event.organizer && <span className="text-ink-subtle">Org.: {event.organizer}</span>}
            {link && (
              /*
                O rótulo VEM DO LINK, não do JSX. Quando o host não é
                `meet.google.com`, o que aparece é o próprio domínio — a pessoa
                decide clicar vendo para onde vai. Antes, qualquer endereço
                pescado do convite era anunciado como "Google Meet".
              */
              <a
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-ink hover:underline"
                title={link.href}
              >
                <Icon.Video width={13} height={13} /> {link.rotulo}
                {!link.ehGoogleMeet && <span className="sr-only"> (site externo)</span>}
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
