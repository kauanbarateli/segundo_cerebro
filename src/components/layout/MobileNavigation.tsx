"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { cn } from "@/lib/utils";
import type { ModuleDef } from "@/lib/modules";

/**
 * Barra inferior do mobile. Cabem ~5 itens confortavelmente; o excedente abre
 * numa folha ao tocar em "Mais".
 *
 * ============================================================================
 * ⚠️ O DEFEITO QUE ESTA FOLHA CORRIGE
 * ============================================================================
 * "Mais" era um `<Link href="/configuracoes">`. O excedente do array de módulos
 * não aparecia em lugar nenhum no celular — nem numa lista, nem atrás de um
 * menu. Ficava INALCANÇÁVEL, e sem erro, sem aviso e sem teste falhando: a
 * única forma de chegar a um módulo excedente era digitar a URL.
 *
 * Com 8 módulos e `MAX_VISIBLE = 5`, isso já valia para Conhecimento,
 * Financeiro e Cofre. Acrescentar Hábitos e Projetos faria a lista dos
 * inalcançáveis crescer justamente com o que é novo — e a conclusão razoável de
 * quem não achasse seria que o módulo não foi feito.
 *
 * A folha custa ~30 linhas e devolve o acesso. É melhor do que a alternativa
 * discutida (escolher quais dois módulos "merecem" os cinco lugares), porque
 * aquela decisão precisaria ser revista a cada módulo novo.
 */
const MAX_VISIBLE = 5;

export function MobileNavigation({ items }: { items: ModuleDef[] }) {
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);

  const visible = items.slice(0, MAX_VISIBLE);
  const overflow = items.slice(MAX_VISIBLE);

  // Navegar FECHA a folha. Sem isto, tocar num item leva à rota certa e deixa a
  // folha por cima dela — a tela nova chega escondida.
  useEffect(() => {
    setAberto(false);
  }, [pathname]);

  const ativo = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <>
      {aberto && (
        <>
          {/* O véu fecha ao toque. É o gesto que todo mundo tenta primeiro. */}
          <button
            type="button"
            aria-label="Fechar menu"
            onClick={() => setAberto(false)}
            className="fixed inset-0 z-40 bg-black/30 md:hidden"
          />
          <div
            className="fixed inset-x-0 bottom-[56px] z-50 max-h-[60vh] overflow-y-auto border-t border-line bg-surface p-2 md:hidden"
            role="menu"
            aria-label="Mais módulos"
          >
            {overflow.map((item) => {
              const Glyph = Icon[item.icon];
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  aria-current={ativo(item.href) ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium",
                    ativo(item.href) ? "bg-surface-muted text-ink" : "text-ink-muted",
                  )}
                >
                  <Glyph width={18} height={18} />
                  {item.label}
                </Link>
              );
            })}
            <Link
              href="/configuracoes"
              role="menuitem"
              className="flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium text-ink-muted"
            >
              <Icon.Settings width={18} height={18} />
              Configurações
            </Link>
          </div>
        </>
      )}

      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-50 flex items-stretch border-t border-line bg-surface/95 backdrop-blur md:hidden"
      >
        {visible.map((item) => {
          const Glyph = Icon[item.icon];
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={ativo(item.href) ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 text-meta font-medium transition-colors",
                ativo(item.href) ? "text-ink" : "text-ink-subtle",
              )}
            >
              <Glyph width={20} height={20} />
              {item.label}
            </Link>
          );
        })}

        {overflow.length > 0 && (
          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
            aria-haspopup="menu"
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-2.5 text-meta font-medium transition-colors",
              // Fica marcado quando a rota atual é um dos escondidos — senão a
              // barra inteira pareceria "em lugar nenhum" dentro deles.
              aberto || overflow.some((i) => ativo(i.href)) ? "text-ink" : "text-ink-subtle",
            )}
          >
            <Icon.Dots width={20} height={20} />
            Mais
          </button>
        )}
      </nav>
    </>
  );
}
