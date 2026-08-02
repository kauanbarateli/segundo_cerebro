import { Badge } from "@/components/ui/Badge";
import { cn, plural } from "@/lib/utils";

/**
 * Selo discreto de "tem vínculo" para os cards de tarefa, captura e evento.
 *
 * Informação SECUNDÁRIA: o card continua sendo sobre a tarefa/nota/reunião, e o
 * selo só diz que existe história em volta dela. Por isso ele some quando não há
 * nada (nada de "0 vínculos" ocupando espaço em todos os cards) e por isso é
 * menor que os outros selos da mesma linha.
 *
 * Fica em arquivo próprio, separado de RelatedSection.tsx, porque quem só quer o
 * selo não deve arrastar o combobox e as server actions para o pacote — o
 * bundler agrupa por módulo, não por símbolo importado.
 *
 * Sem "use client": é uma função de render pura, e assim serve tanto ao card do
 * calendário (renderizado por um componente de cliente) quanto a qualquer
 * componente de servidor que venha a precisar dele.
 */
export function LinkCountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <Badge tone="outline" className={cn("px-2 py-0.5 text-meta", className)}>
      {plural(count, "vínculo", "vínculos")}
    </Badge>
  );
}
