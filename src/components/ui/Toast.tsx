"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type ToastTone = "default" | "success" | "error";
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  toast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, tone: ToastTone = "default") => {
    // NOTE: never pass decrypted vault content here — toasts are non-sensitive UI.
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setItems((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3200);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "pointer-events-auto rounded-md border px-4 py-2.5 text-corpo shadow-raised",
              /*
                `animate-toast-in`: sobe 8px esmaecendo, em 200ms. O sentido do
                movimento é o mesmo da borda por onde o toast entra (rodapé),
                senão o aviso parece cair na tela em vez de entrar nela.

                A animação dispara sozinha porque cada toast tem `key={t.id}`
                único: o React MONTA um nó novo a cada aviso, e animação de
                entrada roda na montagem. Não há estado extra, nem efeito, nem
                re-render de quem está por baixo — o custo é uma classe.

                Na SAÍDA não há animação de propósito. O item some do estado em
                3200ms e o nó é desmontado; animar a saída exigiria segurar o
                toast montado durante a animação, o que significa estado de
                "saindo", temporizador extra e um caminho a mais para o aviso
                ficar preso na tela se o componente desmontar no meio. Custo alto
                para algo que o usuário raramente está olhando quando acontece.
              */
              "animate-toast-in",
              t.tone === "error"
                ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
                : t.tone === "success"
                  ? "border-line bg-accent text-accent-ink"
                  : "border-line bg-surface text-ink",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
