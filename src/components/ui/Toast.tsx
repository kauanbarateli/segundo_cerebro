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
                `animate-toast-in`: sobe 8px esmaecendo, nos 180ms de troca de
                superfície do DS §8. O sentido do
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
              /*
                Os três tons saem de token, e o de erro deixou de ser uma paleta
                crua do Tailwind (`red-50`/`red-300`/`red-700` + quatro variantes
                `dark:`) — que era invisível para o tema e impossível de manter em
                sincronia com o resto.

                `danger-ink` para o texto e `danger/10` para o fundo: o vermelho
                cheio do DS reprova em AA como texto (3.91 sobre branco), e a
                versão a 10% dá a mancha de cor sem virar um bloco vermelho.

                O tom de SUCESSO continua preto sobre branco, e isso é o DS §1
                ("preto significa ação ou estado ativo"), não economia: um toast
                verde para "salvo" gastaria cor num evento que não é excepcional.
                O vermelho fica reservado ao que deu errado, que é o único caso
                em que a cor acrescenta urgência.
              */
              t.tone === "error"
                ? "border-danger/30 bg-danger/10 text-danger-ink"
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
