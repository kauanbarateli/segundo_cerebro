import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * CARTÃO — e os níveis de elevação do sistema.
 *
 * O problema que este arquivo resolve não é visual, é de HIERARQUIA. `Card` era
 * usado em trinta lugares com exatamente o mesmo peso, então uma tela com seis
 * cartões não dizia qual deles importa: tudo tinha a mesma borda e a mesma
 * sombra, e a leitura virava varredura de cima para baixo.
 *
 * A escala completa está em tailwind.config.ts (bloco 3). Em código, ela é:
 *
 *   nível 0  fundo         `bg-canvas` — a página. Não é um Card.
 *   nível 1  superfície    `bg-surface border-line`, SEM sombra — barra lateral,
 *                          cabeçalho fixo, painel encostado no fundo. Também não
 *                          é um Card: são regiões de layout, e passam a existir
 *                          como marcação comum onde estão. Um cartão que não
 *                          flutua não é um cartão, é um retângulo.
 *   nível 2  cartão        `elevacao="cartao"` — o PADRÃO, e o que as trinta
 *                          chamadas existentes já recebiam. Nada mudou para elas.
 *   nível 3  destaque      `elevacao="destaque"` — o cartão que o usuário precisa
 *                          achar PRIMEIRO. É `border-line-strong` + `shadow-raised`.
 *   nível 4  sobreposição  modal, menu, toast. Não é um Card: é `shadow-raised`
 *                          sobre véu escuro (ver ui/Modal.tsx).
 *
 * Repare que a diferença entre o nível 3 e o 4 NÃO é a sombra — é o véu escuro
 * por trás. Isso é de propósito: existem só duas sombras no projeto e nenhuma foi
 * acrescentada aqui. Uma terceira sombra tornaria a hierarquia mais barulhenta,
 * não mais legível; num sistema monocromático o que separa os planos é a força da
 * BORDA, e a sombra só confirma.
 *
 * O nível 3 é caro por natureza: se tudo é destaque, nada é. A regra prática é
 * NO MÁXIMO UM por tela. `TaskBoard` já usa a mesma ideia sem esta prop — o
 * cartão sendo arrastado troca `shadow-subtle` por `shadow-raised` justamente
 * porque, enquanto está na mão do usuário, ele é o único que importa.
 */
type Elevacao = "cartao" | "destaque";

const ELEVACAO: Record<Elevacao, string> = {
  cartao: "border-line shadow-subtle",
  destaque: "border-line-strong shadow-raised",
};

export function Card({
  className,
  elevacao = "cartao",
  ...props
}: HTMLAttributes<HTMLDivElement> & { elevacao?: Elevacao }) {
  return (
    <div
      className={cn("rounded-lg border bg-surface", ELEVACAO[elevacao], className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pt-5 pb-3", className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}
