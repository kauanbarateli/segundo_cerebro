"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/utils";

/**
 * Diálogo modal genérico da aplicação.
 *
 * Nasceu dentro de `features/tasks/TasksView.tsx` e era importado por drive,
 * finance e vault — três features dependendo de uma quarta só para reaproveitar
 * uma caixa cinza. Aqui em `ui/` a dependência aponta para baixo, como deve ser.
 *
 * O visual é idêntico ao que existia antes (mesmo z-[90], mesmo max-h-[90dvh]);
 * o que mudou é tudo que estava faltando de acessibilidade: Esc, armadilha de
 * foco, devolução do foco, trava de rolagem e o título anunciado pelo leitor.
 */

type ModalSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-3xl",
};

/**
 * Elementos que a armadilha de foco considera "paráveis" pelo Tab.
 *
 * `[tabindex]:not([tabindex="-1"])` entra porque componentes podem tornar
 * focáveis nós que não são controles nativos; `-1` fica de fora porque é
 * focável por script, não pela navegação sequencial.
 */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Estado de módulo (não de componente) porque a trava de rolagem é uma
 * propriedade do documento, e o documento é um só.
 *
 * Se dois modais se sobrepõem — abrir um confirmar de exclusão por cima de um
 * formulário, por exemplo — e cada um restaurasse `overflow` cegamente ao
 * desmontar, o primeiro a fechar destravaria a página com o outro ainda aberto.
 * Por isso contamos quantos estão abertos e só devolvemos o valor original
 * quando o contador zera. O valor original é capturado na PRIMEIRA abertura:
 * na segunda, `document.body.style.overflow` já é "hidden" e guardá-lo de novo
 * gravaria a trava como se fosse o estado natural da página.
 */
let openModalCount = 0;
let bodyOverflowBeforeLock = "";

/**
 * Consulta os focáveis AGORA, não na montagem: o conteúdo do modal é dinâmico
 * (formulários revelam campos conforme o tipo escolhido, listas crescem), então
 * uma lista capturada uma vez envelhece e a armadilha passa a pular controles.
 *
 * `offsetParent === null` descarta o que está invisível (display none, ancestral
 * escondido) — a heurística barata que cobre os casos reais daqui.
 */
function focusablesIn(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null,
  );
}

/**
 * Onde a armadilha de foco realmente se fecha.
 *
 * O painel pode CONTER outro diálogo modal — a confirmação de exclusão da tela
 * de capturas é renderizada como filha do painel de propósito, e outras telas
 * podem fazer o mesmo. Enquanto esse diálogo de cima estiver aberto, ele é quem
 * manda: usar o painel inteiro como escopo jogaria os focáveis dos dois na mesma
 * lista, e o Tab levaria o foco para os botões do modal de baixo, que estão
 * atrás do fundo escuro. Foco invisível é ruim; foco invisível em cima de
 * "Excluir" é perigoso. Conteúdo atrás de um diálogo modal não pode ser
 * alcançável pelo teclado.
 *
 * O último em ordem de documento é o de cima: um diálogo aninhado é renderizado
 * depois do conteúdo que o abriu. Isso é uma aproximação, mas é a mesma que o
 * empilhamento visual usa aqui (todos partilham o mesmo z-index).
 */
function trapScopeIn(panel: HTMLElement | null): HTMLElement | null {
  if (!panel) return null;
  const nested = panel.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
  return nested.length > 0 ? nested[nested.length - 1] : panel;
}

/**
 * Campo de digitação: as setas pertencem ao cursor de texto, não à navegação.
 * Sem esta checagem, `onPrev`/`onNext` roubariam ArrowLeft/ArrowRight de quem
 * está corrigindo uma letra no meio de uma palavra.
 */
function isTextEntry(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

export function Modal({
  title,
  children,
  onClose,
  size = "md",
  footer,
  onPrev,
  onNext,
  initialFocus,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  size?: ModalSize;
  footer?: ReactNode;
  onPrev?: () => void;
  onNext?: () => void;
  /**
   * Quem recebe o foco ao abrir, quando a ordem do DOM não serve.
   *
   * O padrão — primeiro focável do painel — funciona enquanto o primeiro
   * controle é inofensivo. Deixou de funcionar quando a seção "Relacionado"
   * entrou nos modais: os botões "Remover vínculo" ficam antes do rodapé na
   * ordem do documento, então abrir o diálogo passaria a deixar o foco em cima
   * de uma exclusão sem confirmação, à distância de um Enter. Esta prop deixa a
   * escolha EXPLÍCITA em vez de dependente da ordem em que o JSX foi escrito.
   */
  initialFocus?: RefObject<HTMLElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<Element | null>(null);
  const titleId = useId();
  // O gesto de fechar só é válido se ele NASCEU e MORREU no fundo escuro. Ver o
  // comentário dos handlers do overlay, lá embaixo.
  const gestureStartedOnOverlayRef = useRef(false);

  // Trava a rolagem do fundo. Efeito separado (sem dependências) porque nada
  // aqui depende das props: é montar/desmontar, e só.
  useEffect(() => {
    if (openModalCount === 0) bodyOverflowBeforeLock = document.body.style.overflow;
    openModalCount += 1;
    document.body.style.overflow = "hidden";
    return () => {
      openModalCount -= 1;
      if (openModalCount === 0) document.body.style.overflow = bodyOverflowBeforeLock;
    };
  }, []);

  // Foco de entrada e de saída.
  useEffect(() => {
    // Quem tinha o foco antes do modal abrir precisa recebê-lo de volta: sem
    // isso, fechar o diálogo joga o teclado para o começo da página e a pessoa
    // perde o lugar onde estava.
    restoreFocusRef.current = document.activeElement;

    const panel = panelRef.current;
    // O alvo pedido vence a ordem do DOM. As refs já estão preenchidas quando
    // este efeito roda (o React atribui os refs antes de disparar efeitos), então
    // não há corrida com o render do rodapé.
    const [firstFocusable] = focusablesIn(panel);
    const target = initialFocus?.current ?? firstFocusable;
    // Se o modal não tem nenhum controle (só texto), o próprio painel recebe o
    // foco via tabIndex -1 — o leitor de tela precisa entrar no diálogo.
    if (target) target.focus();
    else panel?.focus();

    return () => {
      const previous = restoreFocusRef.current;
      // O elemento pode ter sumido junto com o que abriu o modal — é o caso
      // normal de excluir um item pelo próprio diálogo: a linha que tinha o
      // botão deixa de existir no revalidate.
      if (previous instanceof HTMLElement && document.contains(previous)) {
        previous.focus();
        return;
      }
      // Sem destino, o foco cai no <body> e o próximo Tab recomeça do topo da
      // página — depois de toda exclusão a pessoa perde o lugar. Devolvemos o
      // foco ao marco principal, que é o ancestral do conteúdo que o modal
      // editava: o Tab seguinte continua de dentro da página, não do cabeçalho.
      // `tabIndex = -1` é necessário porque <main> não é focável por natureza;
      // -1 o torna focável por script sem entrar na ordem do Tab.
      const main = document.querySelector("main");
      if (main instanceof HTMLElement) {
        main.tabIndex = -1;
        main.focus();
      }
    };
    // `initialFocus` é um objeto de useRef, estável entre renders: está na lista
    // para satisfazer a regra de dependências, não porque o efeito deva repetir.
  }, [initialFocus]);

  // Teclado: Esc fecha, Tab circula dentro do diálogo, setas navegam.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key === "Tab") {
        const panel = panelRef.current;
        // Escopo = o diálogo aninhado mais de cima, se houver; senão, o painel.
        const scope = trapScopeIn(panel);
        const items = focusablesIn(scope);
        if (items.length === 0) {
          event.preventDefault();
          panel?.focus();
          return;
        }

        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        // O próprio escopo conta como "fora": ele é focável só por tabIndex -1,
        // e sair dele com Shift+Tab levaria o foco para o que está atrás.
        const inside = active instanceof HTMLElement && active !== scope && scope?.contains(active);

        // Foco fora do escopo (container, o modal de baixo, ou escapou para o
        // resto da página): puxa de volta para a borda do sentido do Tab.
        if (!inside) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
          return;
        }

        // Só interceptamos nas bordas; no miolo o Tab nativo já faz o certo e
        // respeita ordens que o seletor não enxerga (grupos de radio, por ex.).
        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const move = event.key === "ArrowLeft" ? onPrev : onNext;
        if (!move || isTextEntry(document.activeElement)) return;
        event.preventDefault();
        move();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, onPrev, onNext]);

  return (
    /*
      Fechar pelo fundo escuro é um GESTO, não um clique solto.

      O evento `click` é despachado no ancestral comum do mousedown e do mouseup.
      Quem arrasta para selecionar texto dentro de um campo e solta o botão
      alguns pixels fora da caixa produz mousedown no campo e mouseup no
      overlay — e aí o alvo do `click` é o próprio overlay. Confiar só no
      `click` (mesmo com stopPropagation no painel, que nunca chega a rodar
      nesse caminho) fechava o modal no meio de uma seleção e descartava tudo
      que a pessoa tinha digitado, sem aviso e sem desfazer.

      Por isso exigimos que as três pontas do gesto sejam o fundo: o mousedown
      nasce nele, o mouseup morre nele, e o click resultante o tem como alvo.
      Qualquer perna que encoste no painel invalida o gesto.
    */
    <div
      /*
        `animate-overlay-in`: o véu escuro só esmaece para dentro (140ms). Ele
        não desliza — o fundo escuro não vem de canto nenhum da tela, ele
        simplesmente passa a existir. Movimento no véu chamaria atenção para a
        decoração em vez de para o diálogo.
      */
      className="fixed inset-0 z-[90] flex animate-overlay-in items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        gestureStartedOnOverlayRef.current = e.target === e.currentTarget;
      }}
      onMouseUp={(e) => {
        if (e.target !== e.currentTarget) gestureStartedOnOverlayRef.current = false;
      }}
      onClick={(e) => {
        const closes = gestureStartedOnOverlayRef.current && e.target === e.currentTarget;
        // Zerar sempre, inclusive quando não fecha: um mousedown que morreu no
        // painel não pode deixar a flag armada para o clique seguinte.
        gestureStartedOnOverlayRef.current = false;
        if (closes) onClose();
      }}
    >
      {/*
        role/aria ficam no painel, não no overlay: o diálogo é a caixa; o fundo
        escuro é decoração clicável. `aria-labelledby` apontando para o <h2>
        real faz o leitor anunciar o título que está na tela, em vez de um
        aria-label duplicado que pode divergir dele com o tempo.
      */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "max-h-[90dvh] w-full overflow-y-auto rounded-lg border border-line bg-surface p-5 shadow-raised outline-none",
          /*
            `animate-modal-in`: esmaece subindo 8px, em 180ms. É o nível 4 de
            elevação (ver tailwind.config.ts) e o deslocamento é o que o
            diferencia do véu — o painel VEM de algum lugar, o véu não.

            O deslocamento é de translateY e some ao fim da animação. Isso
            importa: um `transform` residual no painel criaria um contexto de
            posicionamento novo e faria `position: fixed` de qualquer filho
            passar a se ancorar no painel em vez de na janela. Como a animação
            não usa fill-mode, o transform não sobrevive ao último quadro.
          */
          "animate-modal-in",
          SIZE_CLASS[size],
        )}
      >
        <h2 id={titleId} className="mb-4 text-corpo-forte font-semibold text-ink">
          {title}
        </h2>
        {children}
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Nome antigo, mantido como alias para não quebrar nada que ainda importe
 * `FormModal`. Código novo deve usar `Modal`.
 */
export { Modal as FormModal };
