import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/Icons";

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
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface-muted text-ink-subtle">
        <Glyph width={20} height={20} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        {description && <p className="max-w-xs text-corpo text-ink-subtle">{description}</p>}
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
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface-muted text-red-500">
        <Icon.Alert width={20} height={20} />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        {description && <p className="max-w-sm text-corpo text-ink-subtle">{description}</p>}
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
