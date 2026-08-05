"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { CHAVE_TEMA } from "@/components/theme/tema-init";

/*
  ⚠️ `themeInitScript` NÃO MORA MAIS AQUI — foi para `tema-init.ts`, e não pode
  voltar. Este arquivo tem "use client", e o layout raiz que consome o script é
  Componente de Servidor: exportar a string daqui devolvia ao servidor uma
  REFERÊNCIA de cliente em vez do texto, e o `<head>` acabava com o código-fonte
  de uma função lançadora dentro da tag <script>. O arquivo novo explica o
  defeito por inteiro; o resumo é que constante partilhada entre os dois lados
  fica em módulo sem diretiva.
*/

type Theme = "light" | "dark" | "system";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = (localStorage.getItem(CHAVE_TEMA) as Theme | null) ?? "system";
    setTheme(stored);
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    localStorage.setItem(CHAVE_TEMA, next);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = next === "dark" || (next === "system" && prefersDark);
    document.documentElement.classList.toggle("dark", dark);
  }

  const isDark =
    theme === "dark" ||
    (theme === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  return (
    <button
      type="button"
      onClick={() => apply(isDark ? "light" : "dark")}
      aria-label={isDark ? "Ativar tema claro" : "Ativar tema escuro"}
      title={isDark ? "Tema claro" : "Tema escuro"}
      className="flex h-10 w-10 items-center justify-center rounded-md border border-line-strong bg-surface text-ink-muted transition-colors hover:text-ink focus-visible:outline-2"
    >
      {isDark ? <Icon.Sun width={17} height={17} /> : <Icon.Moon width={17} height={17} />}
    </button>
  );
}
