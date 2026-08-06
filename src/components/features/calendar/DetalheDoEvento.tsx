"use client";

import { useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icons";
import { Modal } from "@/components/ui/Modal";
import { CalendarEventCard } from "@/components/features/calendar/CalendarEventCard";
import type { TomDaConta } from "@/lib/calendar-colors";
import type { CalendarEvent } from "@/lib/database.types";
import { analisarLinkExterno } from "@/lib/external-link";

/**
 * O DETALHE DE UM EVENTO — um diálogo, duas telas.
 *
 * Nasceu dentro de `CalendarViews.tsx` e saiu de lá quando o Início passou a
 * precisar do mesmo painel. A alternativa era escrever um segundo modal de
 * evento na tela inicial, e é justamente o que não pode acontecer: o diálogo do
 * Calendário já resolve Esc, armadilha de foco, devolução do foco e o foco
 * inicial no "Fechar" (ver o comentário de `initialFocus`, logo abaixo). Uma
 * cópia começa igual e envelhece diferente — a correção de acessibilidade que
 * um receber, o outro não recebe, e ninguém percebe porque as duas telas
 * "funcionam".
 *
 * O CORPO CONTINUA SENDO O PRÓPRIO CARTÃO do evento, sem `onOpen`: dentro do
 * modal não há para onde abrir, e passar o callback transformaria o título num
 * botão que reabre o que já está aberto.
 *
 * SEM EDIÇÃO E SEM EXCLUSÃO, nas duas telas. O evento é espelho do Google e
 * continua sendo editado lá — daí o único caminho de saída ser o link do fim.
 */
export function DetalheDoEvento({
  evento,
  contaRotulo,
  tom,
  onFechar,
  mostrarDetalhes = false,
  children,
}: {
  evento: CalendarEvent;
  /** Nome da conta de origem. Ver `rotuloDaConta` em lib/calendar-colors.ts. */
  contaRotulo?: string;
  /**
   * A cor da conta. SEMPRE acompanhada de `contaRotulo` — a regra "nunca só por
   * cor" vale aqui como vale no cartão e na visão de mês.
   */
  tom?: TomDaConta | null;
  onFechar: () => void;
  /**
   * Acrescenta descrição e o link para o Google Agenda.
   *
   * ⚠️ DESLIGADO POR PADRÃO, e isso é deliberado: a extração deste componente
   * foi refatoração, não redesenho. O Calendário abria este diálogo sem esses
   * dois blocos e continua abrindo — ligá-los ali "de brinde" mudaria uma tela
   * que ninguém pediu para mudar, no mesmo commit que promete não mudá-la.
   *
   * No Início ele vem ligado porque lá o diálogo é o ÚNICO lugar onde o evento
   * existe por inteiro: não há visão de dia para clicar depois, e "abrir no
   * Google" é a única forma de chegar ao evento de verdade.
   */
  mostrarDetalhes?: boolean;
  /**
   * Conteúdo extra abaixo do cartão — na prática, a seção "Relacionado" do
   * Calendário. Entra como filho, e não como prop tipada, porque `RelatedSection`
   * precisa do mapa de vínculos e da lista de candidatos que só a página do
   * Calendário carrega; exigi-los aqui obrigaria o Início a inventar dois
   * argumentos vazios para um recurso que ele não tem.
   */
  children?: ReactNode;
}) {
  const fecharRef = useRef<HTMLButtonElement>(null);

  const descricao = evento.description?.trim();
  /*
    O `html_link` é gravado pela sincronização, mas passa pela MESMA validação do
    link de videoconferência — ver src/lib/external-link.ts. Não é desconfiança
    do Google: é que este campo é uma coluna de texto no nosso banco como
    qualquer outra, e a função devolve `null` para tudo que não for um https
    legítimo. O custo de validar é uma chamada; o de confiar é um `href` que
    ninguém inspecionou dentro de uma aplicação onde a pessoa está logada.
  */
  const linkDoGoogle = analisarLinkExterno(evento.html_link);

  return (
    <Modal
      title={evento.summary ?? "(sem título)"}
      size="lg"
      onClose={onFechar}
      // "Fechar" é o único controle inofensivo do painel: o primeiro focável na
      // ordem do DOM seria um "Remover vínculo", e Enter logo ao abrir apagaria
      // um vínculo sem confirmação. Aqui o pior que Enter faz é desfazer a
      // abertura.
      initialFocus={fecharRef}
      footer={
        <Button ref={fecharRef} variant="ghost" size="sm" onClick={onFechar}>
          Fechar
        </Button>
      }
    >
      <CalendarEventCard event={evento} accountBadge={contaRotulo} tom={tom} />

      {mostrarDetalhes && descricao && (
        <section className="mt-4">
          <h3 className="eyebrow mb-1.5">Descrição</h3>
          {/*
            TEXTO PURO, NUNCA HTML. A descrição vem do convite, e o convite é
            conteúdo de terceiro: quem sabe o seu e-mail cria um evento e te
            convida. Um `dangerouslySetInnerHTML` aqui executaria marcação
            escolhida por quem mandou o convite dentro da origem da aplicação —
            o mesmo vetor que `external-link.ts` fecha do lado dos links.

            O preço honesto de renderizar como texto é que uma descrição em HTML
            aparece com as tags à mostra. É melhor que a alternativa, e o link
            do fim leva ao Google, onde ela está formatada.

            `max-h-48` + rolagem própria: convite de reunião recorrente traz
            páginas de rodapé jurídico, e sem teto o botão "Fechar" some para
            baixo da dobra do modal.
          */}
          <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-corpo text-ink-muted">
            {descricao}
          </p>
        </section>
      )}

      {mostrarDetalhes && linkDoGoogle && (
        <a
          href={linkDoGoogle.href}
          target="_blank"
          rel="noopener noreferrer"
          /* `min-h-11` = 44px, o alvo de toque mínimo. É o único link de saída
             do diálogo e ele é usado no celular, onde o modal ocupa a tela. */
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md border border-line-strong px-3.5 text-corpo font-medium text-ink transition-colors hover:bg-surface-muted"
        >
          <Icon.Calendar width={15} height={15} aria-hidden />
          Abrir no Google Agenda
          {/* O `target="_blank"` esconde de quem não vê a aba nova aparecer que
              acabou de aparecer uma aba nova. */}
          <span className="sr-only">(abre em nova aba)</span>
        </a>
      )}

      {children}
    </Modal>
  );
}
