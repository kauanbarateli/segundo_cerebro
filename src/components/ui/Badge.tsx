import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * DISTINTIVO E CHIP — DS §7.
 *
 * `Badge` é rótulo (não clicável); `PillButton` é filtro (clicável). Os dois são
 * pill, e a diferença de altura é de propósito: um rótulo acompanha a linha de
 * texto onde está, um filtro é alvo de dedo.
 */
type Tone = "default" | "solid" | "outline";

const tones: Record<Tone, string> = {
  default: "bg-surface-muted text-ink-muted border border-line",
  solid: "bg-accent text-accent-ink border border-transparent",
  outline: "bg-transparent text-ink-muted border border-line-strong",
};

/**
 * Categoria com PONTO COLORIDO, nunca com o chip inteiro preenchido.
 *
 * Regra do DS §7: "Chips de categoria podem usar um ponto colorido, não um
 * preenchimento inteiro." O motivo é a regra 90/10 (§3) — um chip preenchido de
 * teal, num sistema que usa preto para dizer "ativo", rouba a hierarquia: o olho
 * vai para a cor e não para o que está selecionado.
 *
 * O ponto é `aria-hidden` porque a cor NÃO carrega informação sozinha (DS §9). O
 * nome da categoria está escrito ao lado, em texto, e é ele que o leitor de tela
 * anuncia. Se um dia o rótulo sair, o ponto precisa ganhar um nome acessível.
 */
export type PontoDeCategoria = "work" | "personal" | "success" | "danger" | "warning" | "info";

const PONTO: Record<PontoDeCategoria, string> = {
  work: "bg-work",
  personal: "bg-personal",
  success: "bg-success",
  danger: "bg-danger",
  warning: "bg-warning",
  info: "bg-info",
};

/** Pill badge (non-interactive). */
export function Badge({
  className,
  tone = "default",
  ponto,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; ponto?: PontoDeCategoria }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-legenda font-medium leading-none",
        tones[tone],
        className,
      )}
      {...props}
    >
      {ponto && (
        <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", PONTO[ponto])} />
      )}
      {children}
    </span>
  );
}

/**
 * Filtro clicável.
 *
 * `h-10` (40px) é o topo da faixa de 36–40px que o DS §7 pede para chip. Fica
 * abaixo dos 44px de alvo mínimo do §9 porque estes chips vivem em barras de
 * filtro com cinco ou seis itens lado a lado, e 44px de altura visual quebraria
 * a linha no celular. A conciliação é `.alvo-44` (ver globals.css): o `::before`
 * estende a área tocável para 44px sem mudar o desenho.
 */
export function PillButton({
  className,
  active = false,
  ponto,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  ponto?: PontoDeCategoria;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "alvo-44 inline-flex h-10 items-center gap-2 rounded-full px-4 text-corpo font-medium leading-none",
        // Mesmo estado `pressed` do Button, e pelo mesmo motivo — ver o
        // comentário lá. `aria-pressed` acima já diz o estado ao leitor de tela;
        // isto é o sinal visual que faltava para o resto das pessoas.
        "transition-[color,background-color,border-color,transform]",
        "active:scale-[0.98] motion-reduce:active:scale-100",
        active
          ? "bg-accent text-accent-ink border border-transparent"
          : "bg-surface text-ink-muted border border-line-strong hover:bg-surface-hover hover:text-ink",
        className,
      )}
      {...props}
    >
      {ponto && (
        <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", PONTO[ponto])} />
      )}
      {children}
    </button>
  );
}
