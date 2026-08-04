import type { ReactNode, Ref } from "react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

/**
 * A CASCA de um quadro kanban: a grade e a coluna. Só o desenho.
 *
 * ⚠️ ESTE ARQUIVO NÃO IMPORTA `@dnd-kit`, e isso é a decisão de projeto, não
 * uma omissão.
 *
 * Existem dois quadros no aplicativo e eles são diferentes por natureza:
 *
 *   - o das tarefas PESSOAIS arrasta, porque `moveTask` persiste posição e
 *     status;
 *   - o do ClickUp NÃO arrasta, porque `capabilities.ts` não tem operação que
 *     expresse ordenação, e cada `mudarStatus` custa três chamadas contra um
 *     limite de dez por minuto. Ver `ClickUpQuadro.tsx`.
 *
 * Se a casca trouxesse o `DndContext` junto, o segundo quadro carregaria uma
 * biblioteca de arrastar para desenhar cartões parados — e, pior, a estrutura
 * empurraria para "só falta ligar o arrasto", que é justamente o que não deve
 * ser feito ali.
 *
 * Então o que se compartilha é a APARÊNCIA, e o arrasto fica com quem arrasta:
 * `TaskBoard` chama `useSortable` e entrega `ref` e `destacada` para a coluna.
 */

export function QuadroGrade({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 md:grid-cols-3">{children}</div>;
}

export function QuadroColuna({
  titulo,
  contagem,
  /** `setNodeRef` do dnd-kit, quando a coluna é alvo de solta. */
  refDeSolta,
  /** Um card está pairando sobre esta coluna. */
  destacada,
  children,
}: {
  titulo: string;
  contagem: number;
  refDeSolta?: Ref<HTMLElement>;
  destacada?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      ref={refDeSolta}
      className={cn(
        "flex min-h-[200px] flex-col gap-2 rounded-lg border border-line bg-surface-muted p-3 transition-colors",
        destacada && "border-line-strong bg-surface",
      )}
    >
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-corpo font-semibold text-ink">{titulo}</h3>
        <Badge>{contagem}</Badge>
      </div>
      {children}
    </section>
  );
}

/**
 * O texto de coluna vazia.
 *
 * Componente próprio porque a FRASE muda com o motivo do vazio, e não com a
 * coluna: "Solte um card aqui" só faz sentido onde se pode soltar. Num quadro
 * de leitura, aquela frase seria uma instrução para um gesto que não existe.
 */
export function QuadroColunaVazia({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-line px-2 py-6 text-center text-legenda text-ink-subtle">
      {children}
    </p>
  );
}
