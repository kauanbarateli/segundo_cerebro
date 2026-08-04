import { Icon } from "@/components/ui/Icons";
import type { ResponsavelClickUp } from "@/lib/clickup/types";
import { cn } from "@/lib/utils";

/**
 * "Quem está comigo nisto."
 *
 * Mostra TODOS os responsáveis, com "você" destacado — e não só os outros. As
 * duas leituras eram possíveis; esta é mais informativa porque diz também
 * quando você é o único, que é a diferença entre "isto é meu" e "isto é nosso".
 *
 * ⚠️ Nome, nunca e-mail. E nada é persistido — ver `ResponsavelClickUp`.
 *
 * Custo de rede: ZERO. `assignees` já vinha em toda resposta (o `guard.ts` já o
 * lia para a invariante I3); era o mapper que o jogava fora.
 */
export function ResponsaveisClickUp({
  pessoas,
  className,
}: {
  pessoas: ResponsavelClickUp[];
  className?: string;
}) {
  if (pessoas.length === 0) return null;

  // "você" primeiro. Numa tarefa de cinco pessoas, o que se procura ao bater o
  // olho é a própria presença.
  const ordenadas = [...pessoas].sort((a, b) => Number(b.souEu) - Number(a.souEu));

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <Icon.User width={12} height={12} className="shrink-0" />
      <span className="truncate">
        {ordenadas.map((p, i) => (
          <span key={p.id}>
            {i > 0 && ", "}
            <span className={cn(p.souEu && "font-medium text-ink-muted")}>
              {p.souEu ? "você" : p.nome}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}
