"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Menu suspenso de ações — o dos três pontinhos.
 *
 * ============================================================================
 * O DEFEITO QUE ESTE COMPONENTE EXISTE PARA FECHAR
 * ============================================================================
 * O menu da lista de tarefas era um `position: absolute` filho do `<Card
 * className="overflow-hidden">` que envolve a tabela. `overflow: hidden`
 * RECORTA qualquer descendente posicionado que ultrapasse a borda do
 * ancestral — então, nas últimas linhas da tabela, o menu era cortado pela base
 * do cartão. Quanto mais perto do fim da lista, menos menu sobrava.
 *
 * Não dava para resolver do lado de dentro: `z-index` não vence recorte
 * (empilhamento e clipe são coisas diferentes), e tirar o `overflow-hidden` do
 * cartão vazaria os cantos arredondados por baixo da tabela.
 *
 * ============================================================================
 * A SAÍDA: SAIR DA ÁRVORE
 * ============================================================================
 * O painel é renderizado em `document.body` por `createPortal` e posicionado em
 * `position: fixed` com coordenadas de viewport medidas do botão. Fora da
 * subárvore do cartão, não existe ancestral para recortá-lo.
 *
 * POR QUE PORTAL E NÃO SÓ `position: fixed`: `fixed` sozinho também escaparia do
 * `overflow` de hoje, mas se ancora no ancestral mais próximo que tiver
 * `transform`, `filter` ou `contain` — e passaria a se posicionar em relação a
 * ele, em silêncio. Um `hover:scale` num cartão, meses adiante, quebraria o menu
 * sem que ninguém ligasse uma coisa à outra. O portal remove a classe inteira de
 * problema: não há ancestral nenhum.
 *
 * O PREÇO DO PORTAL, e por isso o menu FECHA AO ROLAR: as coordenadas são
 * capturadas na abertura. Fora da árvore, o painel não acompanha a rolagem do
 * contêiner que o originou, e um menu parado enquanto a lista desliza por baixo
 * aponta para a linha errada — pior que fechar. Fechar é o comportamento
 * honesto, e é o que a maioria dos sistemas de design faz.
 */

export interface DropdownItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

/** Precisa bater com `w-40` da classe: a posição é calculada antes da pintura. */
const MENU_WIDTH = 160;
/** Respiro entre o botão e o painel (o antigo `mt-1`). */
const GAP = 4;
/** Distância mínima das bordas da janela. */
const MARGIN = 8;

interface Coords {
  top: number;
  left: number;
  /** Falso até a medição real do painel; enquanto isso ele fica invisível. */
  medido: boolean;
}

export function DropdownMenu({
  label,
  items,
  children,
  className,
}: {
  /** Nome acessível do botão. Um gatilho só com ícone é anunciado como "botão". */
  label: string;
  items: DropdownItem[];
  /** Conteúdo do gatilho (normalmente um ícone). */
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const fechar = useCallback((devolverFoco = true) => {
    setOpen(false);
    setCoords(null);
    // Sem isto, fechar pelo Esc deixa o foco no <body> e o próximo Tab recomeça
    // do topo da página — a pessoa perde o lugar na tabela.
    if (devolverFoco) triggerRef.current?.focus();
  }, []);

  function abrir() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Alinhado à direita do botão, como era. A posição vertical definitiva sai
    // do efeito de layout abaixo, depois de saber a altura real do painel.
    setCoords({
      top: rect.bottom + GAP,
      left: clamp(rect.right - MENU_WIDTH, MARGIN, window.innerWidth - MENU_WIDTH - MARGIN),
      medido: false,
    });
    setOpen(true);
  }

  /**
   * Segundo passo do posicionamento: medir e, se não couber para baixo, virar
   * para cima.
   *
   * `useLayoutEffect` e não `useEffect`: roda antes da pintura, então o painel
   * nunca aparece no lugar errado para depois pular. Enquanto `medido` é falso o
   * painel está com `visibility: hidden` — ocupa espaço para poder ser medido,
   * mas não pisca na tela.
   */
  useLayoutEffect(() => {
    if (!open || !coords || coords.medido) return;
    const panel = panelRef.current;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!panel || !rect) return;

    const altura = panel.offsetHeight;
    const cabeAbaixo = rect.bottom + GAP + altura <= window.innerHeight - MARGIN;
    const cabeAcima = rect.top - GAP - altura >= MARGIN;

    const top = cabeAbaixo
      ? rect.bottom + GAP
      : cabeAcima
        ? rect.top - GAP - altura
        : // Não cabe de jeito nenhum (janela muito baixa): encosta no topo e
          // deixa o próprio painel rolar, em vez de sair da tela.
          MARGIN;

    setCoords({ top, left: coords.left, medido: true });
  }, [open, coords]);

  // Teclado, rolagem e redimensionamento.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        fechar();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") {
        return;
      }
      const focaveis = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
      );
      if (focaveis.length === 0) return;
      e.preventDefault();
      const atual = focaveis.indexOf(document.activeElement as HTMLElement);
      const proximo =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? focaveis.length - 1
            : e.key === "ArrowDown"
              ? (atual + 1 + focaveis.length) % focaveis.length
              : (atual - 1 + focaveis.length) % focaveis.length;
      focaveis[proximo]?.focus();
    }

    // `capture: true` porque a rolagem que importa pode acontecer em qualquer
    // contêiner interno, e eventos de scroll não sobem por bubbling.
    const aoRolar = () => fechar(false);

    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", aoRolar, true);
    window.addEventListener("resize", aoRolar);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", aoRolar, true);
      window.removeEventListener("resize", aoRolar);
    };
  }, [open, fechar]);

  // Foco entra no menu assim que ele é posicionado.
  useEffect(() => {
    if (!open || !coords?.medido) return;
    panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open, coords?.medido]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? fechar() : abrir())}
        className={cn(
          // `alvo-44`: o gatilho continua desenhando 32px (ele mora no canto de
          // linhas de lista densas), mas a área tocável vai a 44px. Ver globals.css.
          "alvo-44 flex h-8 w-8 items-center justify-center rounded-md text-ink-muted hover:bg-surface-hover hover:text-ink",
          className,
        )}
      >
        {children}
      </button>

      {/* `open && coords` garante que nada disto existe no servidor: `open`
          nasce falso, então o portal nunca é avaliado durante o SSR. */}
      {open &&
        coords &&
        createPortal(
          <>
            {/* Fundo invisível que captura o clique fora. z-[88]: acima do
                conteúdo, abaixo do z-[90] dos modais — um menu de linha não
                pode flutuar por cima de um diálogo. */}
            <div className="fixed inset-0 z-[88]" onClick={() => fechar(false)} />
            <div
              ref={panelRef}
              role="menu"
              aria-label={label}
              style={{
                position: "fixed",
                top: coords.top,
                left: coords.left,
                width: MENU_WIDTH,
                visibility: coords.medido ? "visible" : "hidden",
              }}
              /* `animate-popover-in`: 4px vindos de cima, 120ms. Menor e mais
                 rápido que a entrada do modal de propósito — o menu nasce colado
                 no botão que o abriu, então a distância percorrida na tela
                 também é menor.

                 A animação é translateY e a posição vem de `top`/`left` no
                 style, nunca de transform: as duas coisas não brigam, e o
                 deslocamento zera no último quadro. Se o posicionamento um dia
                 passar a usar transform, esta classe sai junto. */
              className="z-[89] animate-popover-in overflow-hidden rounded-md border border-line bg-surface py-1.5 shadow-raised"
            >
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    // Fecha ANTES de agir: a ação costuma abrir um modal ou
                    // remover a linha, e um menu sobrevivendo ao próprio gatilho
                    // ficaria órfão flutuando sobre a tela seguinte.
                    fechar(false);
                    item.onClick();
                  }}
                  className={cn(
                    "block w-full px-3.5 py-2.5 text-left text-corpo hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none",
                    item.danger ? "text-danger-ink" : "text-ink",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

function clamp(value: number, min: number, max: number): number {
  // `max` pode ser menor que `min` em janela muito estreita; o Math.max externo
  // garante que o resultado nunca fique à esquerda da margem.
  return Math.max(min, Math.min(value, Math.max(min, max)));
}
