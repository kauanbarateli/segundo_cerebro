import type { IconName } from "@/components/ui/Icons";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
}

/**
 * Ordem da barra lateral.
 *
 * ATENÇÃO — esta lista NÃO é o que a barra lateral desenha hoje. Quem alimenta
 * `AppSidebar` e `MobileNavigation` é `MODULES` (src/lib/modules.ts), filtrado
 * pelos módulos habilitados em `(app)/layout.tsx`; `NAV_ITEMS` ficou sem nenhum
 * importador e por isso já está desatualizada (Drive e Financeiro nunca foram
 * acrescentados aqui). "Conhecimento" entra para manter a lista coerente, mas o
 * registro que vale é o de `MODULES` — mexer só aqui não muda nada na tela.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Início", icon: "Home" },
  { href: "/capturar", label: "Capturar", icon: "Capture" },
  { href: "/tarefas", label: "Tarefas", icon: "Tasks" },
  { href: "/calendario", label: "Calendário", icon: "Calendar" },
  { href: "/conhecimento", label: "Conhecimento", icon: "Book" },
  { href: "/cofre", label: "Cofre", icon: "Vault" },
];
