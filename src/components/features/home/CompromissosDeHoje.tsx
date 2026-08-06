"use client";

import { useState } from "react";
import { CalendarEventCard } from "@/components/features/calendar/CalendarEventCard";
import { DetalheDoEvento } from "@/components/features/calendar/DetalheDoEvento";
import { rotuloDaConta, tomDaConta } from "@/lib/calendar-colors";
import type { CalendarAccount, CalendarEvent } from "@/lib/database.types";
import { plural } from "@/lib/utils";

/**
 * Quantos compromissos aparecem antes do "+N".
 *
 * Cinco não é número redondo escolhido no olho: o cartão da agenda divide a
 * coluna da direita com hábitos e com o resumo do cérebro. Com sete ou oito
 * eventos empilhados, tudo que vem depois deles sai da primeira tela — e o
 * Início existe justamente para caber numa olhada. Um dia cheio passa a ser
 * "cinco e mais N", que é a informação honesta: há muita coisa hoje.
 */
const LIMITE = 5;

/**
 * A AGENDA DE HOJE NO INÍCIO — a única parte da tela inicial que é cliente.
 *
 * ⚠️ ELA É DE CLIENTE POR UM MOTIVO SÓ: o popup. `Modal` é componente de
 * cliente (Esc, armadilha de foco, trava de rolagem — tudo depende do DOM), e a
 * página Início é de servidor. Em vez de transformar a página inteira em
 * cliente para poder abrir um diálogo, o recorte que precisa de estado vira
 * este componente e recebe os eventos JÁ CARREGADOS por prop. O servidor
 * continua fazendo o trabalho de dados; o navegador só cuida de abrir e fechar.
 */
export function CompromissosDeHoje({
  eventos,
  contas,
  agora,
}: {
  /** Já recortados no dia civil de São Paulo — ver `getEventsForToday`. */
  eventos: CalendarEvent[];
  contas: CalendarAccount[];
  /**
   * O "agora" do render, vindo do servidor — mesmo padrão de `CartaoClickUp`.
   *
   * Aqui ele resolve um problema a mais que lá: este componente é renderizado no
   * servidor E hidratado no navegador. Um `Date.now()` no corpo daria instantes
   * diferentes nos dois lados, e um evento que acabou de terminar apareceria
   * opaco num e não no outro — o React acusaria a divergência de hidratação numa
   * tela que não tem defeito nenhum.
   */
  agora: number;
}) {
  const [expandido, setExpandido] = useState(false);
  // Só o id no estado, e o objeto derivado da prop a cada render: é o mesmo
  // cuidado do Calendário. Uma sincronização do Google pode reescrever o evento
  // enquanto o detalhe está aberto, e guardar a cópia congelaria o modal no
  // texto velho.
  const [detalheId, setDetalheId] = useState<string | null>(null);

  const contaPorId = new Map(contas.map((c) => [c.id, c]));
  // Com UMA conta só não há o que distinguir e a cor vira ruído — a mesma regra
  // de `CalendarViews`. `null` faz cada ponto de aplicação cair no visual
  // anterior, sem caso especial em nenhum deles.
  const colorir = contas.length > 1;
  const tomDe = (ev: CalendarEvent) =>
    colorir ? tomDaConta(contaPorId.get(ev.calendar_account_id)?.slot) : null;
  const rotuloDe = (ev: CalendarEvent) => rotuloDaConta(contaPorId.get(ev.calendar_account_id));

  /**
   * Já terminou? Só para esmaecer — o evento continua na lista.
   *
   * Dia inteiro nunca "termina" no meio do dia: ele vale para o dia todo, então
   * esmaecê-lo às 14h seria dizer que o feriado acabou. Sem `end_at` (evento sem
   * duração declarada), o critério cai para o próprio início.
   */
  const jaTerminou = (ev: CalendarEvent): boolean => {
    if (ev.all_day) return false;
    const fim = ev.end_at ?? ev.start_at;
    return fim != null && new Date(fim).getTime() < agora;
  };

  const detalhe = eventos.find((e) => e.id === detalheId) ?? null;
  const visiveis = expandido ? eventos : eventos.slice(0, LIMITE);
  const restante = eventos.length - visiveis.length;

  if (eventos.length === 0) {
    return (
      <p className="py-4 text-center text-corpo text-ink-subtle">
        {contas.length === 0
          ? "Nenhum evento. Conecte uma conta no Calendário."
          : "Sem compromissos hoje."}
      </p>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {visiveis.map((ev) => (
          <CalendarEventCard
            key={ev.id}
            event={ev}
            compact
            ended={jaTerminou(ev)}
            accountBadge={rotuloDe(ev)}
            // O mesmo código de cores do Calendário. Sem isto, o Início seria a
            // única tela em que as duas contas parecem a mesma coisa — e é a
            // tela que se abre primeiro.
            tom={tomDe(ev)}
            onOpen={() => setDetalheId(ev.id)}
          />
        ))}
      </div>

      {(restante > 0 || expandido) && (
        /*
          O botão diz QUANTOS faltam, não "ver mais".

          "+3 compromissos" responde à pergunta antes do clique: dá para decidir
          se vale a pena abrir. Um "ver mais" genérico obriga a clicar para
          descobrir se o que falta é um compromisso ou seis. E o recolher precisa
          existir: sem ele, expandir num dia de doze eventos empurra hábitos e
          resumo para fora da tela sem volta.

          `aria-expanded` é o que conta a mesma coisa para quem usa leitor de
          tela; sem ele o botão é anunciado como um botão qualquer, e o conteúdo
          novo aparece sem aviso.
        */
        <button
          type="button"
          onClick={() => setExpandido((v) => !v)}
          aria-expanded={expandido}
          className="mt-2 flex min-h-11 w-full items-center justify-center rounded-md border border-line px-3 text-corpo font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
        >
          {expandido ? "Mostrar menos" : `+${plural(restante, "compromisso", "compromissos")}`}
        </button>
      )}

      {detalhe && (
        <DetalheDoEvento
          evento={detalhe}
          contaRotulo={rotuloDe(detalhe)}
          tom={tomDe(detalhe)}
          // Ligado só aqui: no Início este diálogo é o único lugar onde o evento
          // existe por inteiro. Ver a prop em `DetalheDoEvento`.
          mostrarDetalhes
          onFechar={() => setDetalheId(null)}
        />
      )}
    </>
  );
}
