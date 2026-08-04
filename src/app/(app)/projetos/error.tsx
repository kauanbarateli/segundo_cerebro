"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/states";
import { Button } from "@/components/ui/Button";

/**
 * O boundary DESTE módulo. Ver o de `/habitos` para o raciocínio completo.
 *
 * ⚠️ Aqui ele importa mais que na média, e por um motivo específico: este
 * módulo LÊ de quatro tabelas de outros módulos (`tasks`, `captures`,
 * `knowledge_notebooks`, `drive_folders`). Uma quebra aqui pode ter causa em
 * qualquer um deles, e o boundary compartilhado dizia apenas "não foi possível
 * carregar esta tela" — que, com quatro suspeitos, não estreita nada.
 */
export default function ProjetosError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[projetos]", error);
  }, [error]);

  return (
    <ErrorState
      title="Não foi possível carregar os Projetos"
      description={
        error.digest
          ? `Os módulos que este agrupa continuam acessíveis por conta própria. Código do erro: ${error.digest}`
          : "Os módulos que este agrupa continuam acessíveis por conta própria."
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
