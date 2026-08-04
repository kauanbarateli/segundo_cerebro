import type { IconName } from "@/components/ui/Icons";

/**
 * Registro de módulos. O que é *estrutura* (rota, rótulo, ícone) fica em
 * código; só o estado ligado/desligado vai ao banco (`user_modules`).
 *
 * `core: true` = não pode ser desativado — senão o usuário se tranca fora da
 * aplicação.
 */
export interface ModuleDef {
  key: string;
  label: string;
  href: string;
  icon: IconName;
  core: boolean;
  description: string;
}

export const MODULES: ModuleDef[] = [
  {
    key: "inicio",
    label: "Início",
    href: "/",
    icon: "Home",
    core: true,
    description: "Painel diário com próximos passos.",
  },
  {
    key: "capturar",
    label: "Capturar",
    href: "/capturar",
    icon: "Capture",
    core: false,
    description: "Caixa de entrada para tirar da cabeça.",
  },
  {
    key: "tarefas",
    label: "Tarefas",
    href: "/tarefas",
    icon: "Tasks",
    core: false,
    description: "Lista e quadro Kanban.",
  },
  {
    key: "calendario",
    label: "Calendário",
    href: "/calendario",
    icon: "Calendar",
    core: false,
    description: "Agenda unificada do Google Calendar.",
  },
  {
    key: "drive",
    label: "Drive",
    href: "/drive",
    icon: "Folder",
    core: false,
    description: "Arquivos e pastas.",
  },
  {
    key: "conhecimento",
    label: "Conhecimento",
    href: "/conhecimento",
    icon: "Book",
    core: false,
    description: "Cadernos, páginas e busca no que você escreveu.",
  },
  /*
    ⚠️ A POSIÇÃO NESTE ARRAY DECIDE A BARRA DO CELULAR.

    `MobileNavigation` mostra os `MAX_VISIBLE` primeiros; o resto vai para
    "Mais". Hábitos entra ANTES de Financeiro e Cofre porque é o único módulo
    de gesto DIÁRIO — marcar o que foi feito hoje —, e um módulo de rotina que
    exige três toques para ser alcançado deixa de ser rotina.

    Antes desta linha, "Mais" era um atalho para Configurações e os módulos
    excedentes ficavam INALCANÇÁVEIS no celular. Isso foi corrigido junto (ver
    `MobileNavigation`), então a posição hoje decide conveniência, não acesso.
  */
  {
    key: "habitos",
    label: "Hábitos",
    href: "/habitos",
    icon: "Repeat",
    core: false,
    description: "O que você faz todo dia, e o que falhou.",
  },
  {
    key: "financeiro",
    label: "Financeiro",
    href: "/financeiro",
    icon: "Wallet",
    core: false,
    description: "Contas, lançamentos e orçamentos.",
  },
  {
    key: "cofre",
    label: "Cofre",
    href: "/cofre",
    icon: "Vault",
    core: false,
    description: "Senhas e dados sensíveis (criptografado).",
  },
];

export const MODULE_BY_KEY = new Map(MODULES.map((m) => [m.key, m]));

/** Módulo dono de uma rota — usado pelo guard de servidor. */
export function moduleForPath(pathname: string): ModuleDef | undefined {
  // Ordena do mais específico para o menos, para "/" não capturar tudo.
  return [...MODULES]
    .sort((a, b) => b.href.length - a.href.length)
    .find((m) => (m.href === "/" ? pathname === "/" : pathname.startsWith(m.href)));
}

/**
 * Ausência de linha em `user_modules` significa habilitado — assim a migration
 * é retrocompatível e não precisa de backfill.
 */
export function resolveEnabled(rows: { module_key: string; enabled: boolean }[]): Set<string> {
  const disabled = new Set(rows.filter((r) => !r.enabled).map((r) => r.module_key));
  return new Set(MODULES.filter((m) => m.core || !disabled.has(m.key)).map((m) => m.key));
}
