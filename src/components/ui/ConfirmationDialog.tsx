"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  destructive = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex animate-overlay-in items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
    >
      <div
        ref={ref}
        tabIndex={-1}
        /* Mesma entrada do `Modal`: este diálogo é o mesmo nível de elevação e
           precisa nascer do mesmo jeito. Duas caixas que fazem o mesmo papel
           entrando de formas diferentes é o que faz uma interface parecer
           montada por pessoas que não se falaram. */
        className="w-full max-w-sm animate-modal-in rounded-lg border border-line bg-surface p-5 shadow-raised outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-corpo-forte font-semibold text-ink">{title}</h2>
        {description && <p className="mt-1.5 text-corpo text-ink-muted">{description}</p>}
        {children}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            size="sm"
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
