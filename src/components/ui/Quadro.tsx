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
  /**
   * Torna o cabeçalho um botão que recolhe a coluna. `undefined` mantém a
   * coluna fixa — é o caso do quadro pessoal, onde toda coluna é alvo de solta
   * e uma recolhida seria um destino invisível.
   */
  aoAlternar,
  colapsada = false,
  /**
   * Altura máxima da área de cartões, com rolagem própria.
   *
   * Sem isto, uma coluna com quarenta cartões estica a página inteira e as
   * outras duas ficam com metros de espaço vazio ao lado — o quadro perde
   * justamente a comparação lado a lado que justifica ser um quadro.
   */
  rolavel = false,
  children,
}: {
  titulo: string;
  contagem: number;
  refDeSolta?: Ref<HTMLElement>;
  destacada?: boolean;
  aoAlternar?: () => void;
  colapsada?: boolean;
  rolavel?: boolean;
  children: ReactNode;
}) {
  const cabecalho = (
    <>
      <h3 className="text-corpo font-semibold text-ink">{titulo}</h3>
      <Badge>{contagem}</Badge>
    </>
  );

  return (
    <section
      ref={refDeSolta}
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-line bg-surface-muted p-3 transition-colors",
        !colapsada && "min-h-[200px]",
        destacada && "border-line-strong bg-surface",
      )}
    >
      {aoAlternar ? (
        <button
          type="button"
          onClick={aoAlternar}
          aria-expanded={!colapsada}
          className="mb-1 flex w-full items-center justify-between gap-2 rounded-sm text-left"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              aria-hidden
              className={cn(
                "text-ink-subtle transition-transform",
                colapsada ? "-rotate-90" : "rotate-0",
              )}
            >
              ▾
            </span>
            {cabecalho}
          </span>
        </button>
      ) : (
        <div className="mb-1 flex items-center justify-between">{cabecalho}</div>
      )}

      {!colapsada && (
        <div className={cn("flex flex-col gap-2", rolavel && "max-h-[65vh] overflow-y-auto pr-1")}>
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * Divisor com o nome do grupo, DENTRO de uma coluna.
 *
 * Responde "de onde vem isto?" para um cartão no meio de uma coluna que junta
 * várias listas — pergunta que o ícone de 12px do cartão não responde sem que
 * se pare para ler linha por linha.
 */
export function QuadroDivisor({ children }: { children: ReactNode }) {
  return (
    <p className="mt-1 flex items-center gap-2 text-meta uppercase tracking-wide text-ink-subtle first:mt-0">
      <span className="truncate">{children}</span>
      <span aria-hidden className="h-px flex-1 bg-line" />
    </p>
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
