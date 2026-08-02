import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";

export interface HeaderUser {
  name: string;
  avatarUrl: string | null;
}

/**
 * Cabeçalho global: eyebrow, título, subtítulo + busca / tema / capturar /
 * avatar. Recebe o usuário inteiro (antes recebia só a inicial, duplicada em
 * 7 páginas).
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  user,
  right,
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: string;
  user: HeaderUser;
  right?: ReactNode;
}) {
  return (
    <header className="mb-8">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">{eyebrow}</p>
          <h1 className="mt-2 text-4xl font-bold tracking-tight text-ink sm:text-5xl">{title}</h1>
          {subtitle && <p className="mt-2 text-corpo-forte text-ink-muted">{subtitle}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <label className="relative hidden lg:block">
            <span className="sr-only">Buscar</span>
            <Icon.Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle"
              width={16}
              height={16}
            />
            <input
              type="search"
              placeholder="Buscar"
              className="h-10 w-56 rounded-md border border-line-strong bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline-2"
            />
          </label>
          <ThemeToggle />
          {right}
          <Link
            href="/capturar"
            className="flex h-10 items-center gap-2 rounded-md bg-accent px-4 text-sm font-medium text-accent-ink hover:opacity-90"
          >
            <Icon.Capture width={16} height={16} /> Capturar
          </Link>
          <Link href="/configuracoes" aria-label="Configurações do perfil">
            <Avatar name={user.name} url={user.avatarUrl} size={40} />
          </Link>
        </div>
      </div>
    </header>
  );
}
