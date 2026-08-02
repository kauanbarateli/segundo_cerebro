"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icons";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/utils";
import { signOut } from "@/app/(auth)/actions";
import type { ModuleDef } from "@/lib/modules";

export function AppSidebar({
  items,
  displayName,
  email,
  avatarUrl,
  organizedPercent,
  organizedDone,
  organizedTotal,
}: {
  items: ModuleDef[];
  displayName: string;
  email: string;
  avatarUrl: string | null;
  organizedPercent: number;
  organizedDone: number;
  organizedTotal: number;
}) {
  const pathname = usePathname();

  return (
    // sticky + h-dvh: a barra acompanha a rolagem da página e nunca "sobe"
    // quando o conteúdo principal é mais alto que a viewport.
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface md:flex">
      {/* A foto ocupa o lugar da marca. Canto arredondado (não círculo) porque
          aqui ela lê como logotipo e acompanha os demais blocos da interface. */}
      <div className="flex items-center gap-3 px-5 pt-6 pb-5">
        <Avatar name={displayName} url={avatarUrl} size={36} rounded="md" />
        <div className="leading-tight">
          <p className="text-corpo-forte font-semibold text-ink">Segundo</p>
          <p className="text-corpo text-ink-subtle">Cérebro</p>
        </div>
      </div>

      <p className="eyebrow px-5 pb-2">Espaço pessoal</p>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {items.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Glyph = Icon[item.icon];
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-accent text-accent-ink"
                  : "text-ink-muted hover:bg-surface-muted hover:text-ink",
              )}
            >
              <Glyph width={18} height={18} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mx-3 mb-3 mt-2 rounded-md border border-line bg-surface-muted p-3">
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-meta font-semibold text-ink">
            {organizedPercent}%
          </div>
          <div className="leading-tight">
            <p className="text-corpo font-medium text-ink">Cérebro em ordem</p>
            <p className="text-legenda text-ink-subtle">
              {organizedDone} de {organizedTotal} concluídas
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-0.5 border-t border-line px-3 py-3">
        <Link
          href="/configuracoes"
          className="flex items-center gap-3 rounded-md px-3 py-2 text-corpo text-ink-muted hover:bg-surface-muted hover:text-ink"
        >
          <Icon.Settings width={16} height={16} /> Configurações
        </Link>
        <Link
          href="/ajuda"
          className="flex items-center gap-3 rounded-md px-3 py-2 text-corpo text-ink-muted hover:bg-surface-muted hover:text-ink"
        >
          <Icon.Help width={16} height={16} /> Ajuda e atalhos
        </Link>

        {/* Sem avatar aqui: ele já identifica a conta no topo da barra e no
            cabeçalho da página. Repetir a mesma foto três vezes na mesma tela
            é ruído. O que falta saber neste ponto é QUAL conta está aberta —
            isso o nome e o e-mail resolvem. */}
        <div className="mt-1 flex items-center gap-3 rounded-md px-3 py-2">
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-corpo font-medium text-ink">{displayName}</p>
            <p className="truncate text-legenda text-ink-subtle">{email}</p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              aria-label="Sair"
              title="Sair"
              className="flex h-8 w-8 items-center justify-center rounded-md text-ink-subtle hover:bg-surface hover:text-ink"
            >
              <Icon.Logout width={16} height={16} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
