"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icons";
import { cn } from "@/lib/utils";
import type { ModuleDef } from "@/lib/modules";

/**
 * Barra inferior do mobile. Cabem ~5 itens confortavelmente; o excedente vai
 * para "Mais" (que leva às Configurações, onde o usuário desativa o que não
 * usa e a barra volta a caber).
 */
const MAX_VISIBLE = 5;

export function MobileNavigation({ items }: { items: ModuleDef[] }) {
  const pathname = usePathname();
  const visible = items.slice(0, MAX_VISIBLE);
  const overflow = items.slice(MAX_VISIBLE);

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-line bg-surface/95 backdrop-blur md:hidden"
    >
      {visible.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Glyph = Icon[item.icon];
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-2.5 text-meta font-medium transition-colors",
              active ? "text-ink" : "text-ink-subtle",
            )}
          >
            <Glyph width={20} height={20} />
            {item.label}
          </Link>
        );
      })}

      {overflow.length > 0 && (
        <Link
          href="/configuracoes"
          className="flex flex-1 flex-col items-center gap-1 py-2.5 text-meta font-medium text-ink-subtle"
        >
          <Icon.Dots width={20} height={20} />
          Mais
        </Link>
      )}
    </nav>
  );
}
