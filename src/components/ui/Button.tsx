import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * BOTÃO — as quatro variantes e os três tamanhos do DS §7.
 *
 * ============================================================================
 * ALTURAS: 40 / 44 / 52
 * ============================================================================
 * Eram 32 / 40 / 48. O `sm` de 32px é o que motivou a mudança: um alvo de 32px
 * reprova no mínimo de 44×44 do DS §9, e ele não era usado só em cantos
 * decorativos — "Novo lançamento", "Nova conta" e "Transferência" no Financeiro
 * são `size="sm"`. Alvo pequeno erra mais, e erra mais em quem tem menos
 * precisão de toque.
 *
 * 44px é o mínimo, então `md` — o padrão, e a maioria dos usos — passa a nascer
 * conforme. `sm` fica em 40px porque vive em barras densas onde 44 empurraria o
 * layout; ele recebe a área de toque ampliada por `::before`, que cresce o alvo
 * sem crescer o desenho. Ver `.alvo-44` em globals.css.
 *
 * ============================================================================
 * `disabled` NÃO É `opacity-50`
 * ============================================================================
 * A opacidade arrastava a BORDA junto: um botão secundário desabilitado ficava
 * com a moldura sumindo no fundo, e a caixa parecia meio apagada em vez de
 * inerte. Pior, sobre fundos diferentes o resultado era diferente — 50% de preto
 * sobre `canvas` e sobre `surface` não dão a mesma cor.
 *
 * Os tokens `disabled` / `disabled-bg` são valores próprios, iguais em qualquer
 * fundo, e trocam com o tema. O contraste entre os dois é 2.57 no claro, abaixo
 * de AA DE PROPÓSITO: a WCAG 1.4.3 isenta controle inativo, e é justamente a
 * baixa legibilidade que comunica "isto não responde". O que não pode faltar é
 * o `cursor-not-allowed` e o atributo `disabled` real, que é o que o leitor de
 * tela anuncia — cor nunca é o único sinal.
 */
type Variant = "primary" | "secondary" | "ghost" | "danger" | "danger-solid";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-ink border border-transparent hover:opacity-90 " +
    "disabled:bg-disabled-bg disabled:text-disabled disabled:hover:opacity-100",
  secondary:
    "bg-surface text-ink border border-line-strong hover:bg-surface-hover " +
    "disabled:bg-disabled-bg disabled:text-disabled disabled:border-line disabled:hover:bg-disabled-bg",
  ghost:
    "bg-transparent text-ink-muted border border-transparent hover:bg-surface-hover hover:text-ink " +
    "disabled:text-disabled disabled:hover:bg-transparent disabled:hover:text-disabled",
  /*
    DS §7: "preferir secondary com texto danger; fundo danger sólido só em
    confirmação destrutiva". O fundo sólido mora em `ConfirmationDialog`, que é
    onde a ação é irreversível; aqui a variante é moldura neutra + texto vermelho.

    `danger-ink` e não `danger`: o vermelho do DS (#E5484D) tem 3.91 de contraste
    sobre branco e reprova em AA como TEXTO. O degrau `-ink` (#C02A30, 5.32) é o
    que passa. Ver o bloco das semânticas em globals.css.
  */
  danger:
    "bg-transparent text-danger-ink border border-line hover:bg-danger/10 " +
    "disabled:text-disabled disabled:hover:bg-transparent",
  /*
    A OUTRA metade da regra do DS §7: fundo vermelho cheio, e SÓ em confirmação
    destrutiva. Hoje isso significa exatamente um lugar — o botão de confirmar do
    `ConfirmationDialog` quando `destructive` é verdadeiro.

    Aqui o `danger` cheio é o certo e o `danger-ink` seria errado: o texto é
    branco sobre o vermelho, não vermelho sobre branco, e o par #E5484D/#FFFFFF
    tem 3.91 — abaixo de AA para texto normal. Por isso o rótulo vai em
    `font-semibold`: acima de 18.66px em negrito, o piso da WCAG cai para 3:1, e
    o `size="md"` deste diálogo usa 16px… que não alcança esse limiar.

    A conciliação real, então, não é tipográfica: o botão nunca é o único sinal.
    O diálogo já traz o título ("Excluir lançamento"), a descrição do efeito e o
    rótulo do próprio botão em texto. A cor é o terceiro reforço, não o dado —
    que é a regra do DS §9.
  */
  "danger-solid":
    "bg-danger text-white border border-transparent font-semibold hover:bg-danger-ink " +
    "disabled:bg-disabled-bg disabled:text-disabled disabled:hover:bg-disabled-bg",
};

/*
  `gap-2.5` = 10px entre ícone e rótulo, o número do DS §7. Os 6–8px de antes
  deixavam o par apertado o bastante para o ícone parecer parte da palavra em vez
  de um sinal ao lado dela.

  Todos com `rounded-md` (12px): o DS pede UMA geometria de controle. O `sm` usava
  `rounded-sm` (8px), e um botão pequeno ao lado de um campo de 12px parecia vir
  de outro sistema.
*/
const sizes: Record<Size, string> = {
  // `alvo-44` só no `sm`: é o único que desenha menos de 44px. Nos outros dois
  // a classe seria inócua (a caixa já é maior que o mínimo) e ainda assim
  // custaria um `position: relative` em todo botão do produto.
  sm: "alvo-44 h-10 px-3.5 text-legenda rounded-md gap-2",
  md: "h-11 px-4 text-corpo rounded-md gap-2.5",
  lg: "h-13 px-5 text-corpo rounded-md gap-2.5",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      /*
        `active:scale-[0.98]` é o estado PRESSED que faltava (DS §8 exige
        default, hover, pressed, focus-visible, disabled e loading em todo
        controle). Um botão sem resposta ao pressionar deixa a dúvida de se o
        toque pegou — que é justamente quando a pessoa toca duas vezes e a ação
        acontece duas vezes.

        Escala e não cor: nas variantes `primary` e `danger-solid` o fundo já é
        sólido, e escurecê-lo mais no clique confundiria com o hover. 2% é o
        limite do que se sente sem parecer que o botão afundou.

        `transition-transform` entra junto de `transition-colors` porque a
        propriedade precisa estar declarada para animar — e `motion-reduce` a
        desliga, porque escala é movimento. O @media de globals.css já zeraria a
        DURAÇÃO; a variante aqui remove também a transformação, que é o que
        importa para quem tem sensibilidade vestibular.
      */
      className={cn(
        "inline-flex items-center justify-center font-medium select-none",
        "transition-[color,background-color,border-color,opacity,transform]",
        "active:scale-[0.98] motion-reduce:active:scale-100",
        "disabled:cursor-not-allowed disabled:active:scale-100",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
