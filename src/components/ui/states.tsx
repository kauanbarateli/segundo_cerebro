import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/Icons";

/**
 * ESTADO VAZIO — DS §7.
 *
 * "Ícone 20–24px dentro de círculo 56–72px. Título curto, descrição de uma frase
 * e CTA apenas quando existe próxima ação clara. Evitar ilustrações coloridas: o
 * vazio também deve ser calmo."
 *
 * O círculo era de 44px com o ícone de 20px dentro — proporção de 45%, que faz o
 * ícone parecer apertado contra a borda e o conjunto, um distintivo grande em vez
 * de uma marca de ausência. Em 64px com o mesmo ícone a proporção cai para 31%, e
 * é o respiro que transforma o desenho em "aqui não há nada" em vez de "aqui há um
 * ícone".
 *
 * A descrição usa `ink-muted` e não `ink-subtle`: é a única frase da tela e
 * precisa ser lida. `ink-subtle` reprova em AA sobre o fundo claro (2.86).
 */
export function EmptyState({
  title,
  description,
  icon = "Inbox",
  action,
}: {
  title: string;
  description?: string;
  icon?: keyof typeof Icon;
  action?: ReactNode;
}) {
  const Glyph = Icon[icon];
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-line bg-surface-muted text-ink-subtle">
        <Glyph width={22} height={22} />
      </div>
      <div className="space-y-1.5">
        <p className="text-corpo font-medium text-ink">{title}</p>
        {description && <p className="max-w-xs text-corpo text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Algo deu errado",
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      {/* `text-danger-ink` no lugar do antigo `text-red-500` cru: o token
          acompanha o tema (no escuro ele clareia para #F0656A) e passa em AA nos
          dois. O vermelho aqui é reforço — a informação está no título, em
          texto. */}
      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-line bg-surface-muted text-danger-ink">
        <Icon.Alert width={22} height={22} />
      </div>
      <div className="space-y-1.5">
        <p className="text-corpo font-medium text-ink">{title}</p>
        {description && <p className="max-w-sm text-corpo text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function LoadingSkeleton({ className, rows = 3 }: { className?: string; rows?: number }) {
  return (
    <div className={cn("space-y-3", className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-14 animate-pulse rounded-md border border-line bg-surface-muted"
        />
      ))}
      <span className="sr-only">Carregando…</span>
    </div>
  );
}
