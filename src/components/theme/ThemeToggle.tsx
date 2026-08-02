"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icons";

/** Inline script (in <head>) applies the stored theme before paint to avoid FOUC. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('sb-theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var dark=t==='dark'||((!t||t==='system')&&m);document.documentElement.classList.toggle('dark',dark);}catch(e){}})();`;

type Theme = "light" | "dark" | "system";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = (localStorage.getItem("sb-theme") as Theme | null) ?? "system";
    setTheme(stored);
  }, []);

  function apply(next: Theme) {
    setTheme(next);
    localStorage.setItem("sb-theme", next);
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
