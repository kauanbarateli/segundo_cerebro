"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/Button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface for observability; never logs sensitive payloads.
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      title="Não foi possível carregar esta tela"
      description="Verifique sua conexão e tente novamente. Se persistir, confirme a configuração do Supabase."
      action={
        <Button variant="secondary" size="sm" onClick={reset}>
          Tentar novamente
        </Button>
      }
    />
  );
}
