"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/Button";

/**
 * O boundary DESTE módulo.
 *
 * ⚠️ POR QUE ELE EXISTE, quando `(app)/error.tsx` já pegaria a exceção.
 *
 * Porque o boundary compartilhado já custou caro uma vez. O módulo Conhecimento
 * ficou INTEIRAMENTE inacessível — toda página abrindo na tela de erro — e a
 * mensagem genérica não dizia nem qual módulo tinha quebrado nem o que tinha
 * falhado, enquanto `tsc`, `lint` e a suíte inteira passavam limpos. O tempo
 * gasto até chegar à causa foi tempo gasto adivinhando qual das telas era.
 *
 * Um boundary por módulo não conserta nada sozinho. O que ele faz é: (1) dizer
 * QUAL parte quebrou, (2) manter o resto da aplicação navegável a partir daqui,
 * e (3) mostrar o `digest`, que é o que liga esta tela à linha do log.
 *
 * O `console.error` é deliberado e não vaza nada: `error` num boundary de
 * cliente do Next já chega sanitizado em produção — mensagem substituída e só o
 * `digest` preservado.
 */
export default function HabitosError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[habitos]", error);
  }, [error]);

  return (
    <ErrorState
      title="Não foi possível carregar os Hábitos"
      description={
        error.digest
          ? `O resto do aplicativo continua funcionando. Código do erro: ${error.digest}`
          : "O resto do aplicativo continua funcionando."
      }
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" size="sm" onClick={reset}>
            Tentar novamente
          </Button>
          <Link
            href="/"
            className="inline-flex h-8 items-center rounded-sm border border-line-strong px-3 text-corpo font-medium text-ink hover:bg-surface-muted"
          >
            Voltar ao Início
          </Link>
        </div>
      }
    />
  );
}
