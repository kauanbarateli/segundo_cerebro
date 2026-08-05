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
 * Porque o boundary compartilhado já custou caro AQUI, duas vezes. Este módulo
 * ficou inteiramente inacessível — toda página abrindo na tela de erro — e a
 * mensagem genérica ("Não foi possível carregar esta tela. Verifique sua
 * conexão... confirme a configuração do Supabase") apontava para rede e para
 * banco, quando nas duas vezes a causa estava no editor, no cliente:
 *
 *   1. `useEditor` do TipTap devolvendo `null` no primeiro render sob Next.js,
 *      porque `immediatelyRender` não tinha sido declarado;
 *   2. `DOCUMENTO_VAZIO` sem bloco nenhum, recusado por `enableContentCheck`.
 *
 * Nos dois casos o texto genérico mandou procurar no lugar errado, e o tempo
 * gasto foi tempo gasto adivinhando qual tela tinha quebrado.
 *
 * Um boundary por módulo não conserta nada sozinho. O que ele faz é: (1) dizer
 * QUAL parte quebrou, (2) manter o resto navegável a partir daqui — em especial
 * a lista de cadernos, que é o caminho de volta natural —, e (3) mostrar o
 * `digest`, que é o que liga esta tela à linha do log.
 *
 * O `console.error` é deliberado e não vaza nada: `error` num boundary de
 * cliente do Next já chega sanitizado em produção — mensagem substituída e só o
 * `digest` preservado.
 */
export default function ConhecimentoError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[conhecimento]", error);
  }, [error]);

  return (
    <ErrorState
      title="Não foi possível carregar o Conhecimento"
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
          {/* O caminho de volta é a lista de cadernos, e não a Início: quem
              chegou aqui estava escrevendo, e o gesto seguinte quase sempre é
              abrir outra página. */}
          <Link
            href="/conhecimento"
            className="inline-flex h-8 items-center rounded-sm border border-line-strong px-3 text-corpo font-medium text-ink hover:bg-surface-muted"
          >
            Voltar aos cadernos
          </Link>
        </div>
      }
    />
  );
}
