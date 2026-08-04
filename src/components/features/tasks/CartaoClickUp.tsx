"use client";

import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icons";
import { ResponsaveisClickUp } from "@/components/features/tasks/ResponsaveisClickUp";
import type { TarefaClickUp } from "@/lib/clickup/types";
import { cn, formatDayLabel, formatTime } from "@/lib/utils";

/**
 * O cartão de uma tarefa do ClickUp — usado pela LISTA e pelo QUADRO.
 *
 * Saiu de dentro do `<li>` do `ClickUpPanel`, e não do `CardShell` do
 * `TaskBoard`: aquele desenha `Category`, `TaskPriority` e contagem de vínculos
 * do banco pessoal, que não existem aqui. O que as duas visões do ClickUp
 * mostram já estava escrito num lugar só; só faltava ter nome.
 *
 * `compacto` é a única diferença entre as duas: numa coluna de um terço da
 * largura, a lista de origem e os co-responsáveis empurram o prazo para uma
 * terceira linha e o cartão vira um parágrafo. Numa linha inteira, cabem.
 */
export function CartaoClickUp({
  tarefa,
  aoAbrir,
  compacto = false,
  agora,
}: {
  tarefa: TarefaClickUp;
  aoAbrir: () => void;
  compacto?: boolean;
  /**
   * O "agora" do render, vindo de fora.
   *
   * Chamar `Date.now()` aqui daria um instante DIFERENTE por cartão. Com trinta
   * cartões e uma tarefa vencendo naquele segundo, dois deles discordariam
   * sobre ela estar vencida — no mesmo quadro, na mesma tela.
   */
  agora: number;
}) {
  const vencida = tarefa.prazo != null && new Date(tarefa.prazo).getTime() < agora;

  return (
    <div className="rounded-md border border-line bg-surface px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={aoAbrir}
          className="min-w-0 flex-1 rounded-sm text-left text-sm font-medium text-ink hover:underline focus-visible:outline-2"
        >
          {tarefa.nome}
        </button>
        {tarefa.status && (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-meta font-medium"
            style={
              // A cor vem da API — cada Space define a sua paleta.
              // `borderColor`/`color` em vez de fundo sólido para não brigar
              // com o tema claro/escuro do aplicativo.
              //
              // ⚠️ No quadro, este rótulo é o que impede a coluna de mentir: as
              // colunas agrupam por FASE (`status.type`), e o status literal de
              // cada Space continua visível aqui. Nenhuma equivalência falsa
              // entre "revisão" de uma lista e "em teste" de outra é afirmada.
              tarefa.statusCor
                ? { color: tarefa.statusCor, border: `1px solid ${tarefa.statusCor}` }
                : undefined
            }
          >
            {tarefa.status}
          </span>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-legenda text-ink-subtle">
        {tarefa.listaNome && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <Icon.Folder width={12} height={12} className="shrink-0" />
            <span className="truncate">{tarefa.listaNome}</span>
          </span>
        )}
        {tarefa.prazo && (
          <span className={cn("inline-flex items-center gap-1", vencida && "text-red-500")}>
            <Icon.Clock width={12} height={12} />
            {formatDayLabel(tarefa.prazo)}
            {!compacto && ` ${formatTime(tarefa.prazo)}`}
            {vencida && " · vencida"}
          </span>
        )}
        {tarefa.prioridade && <Badge tone="outline">{tarefa.prioridade}</Badge>}
        <ResponsaveisClickUp
          pessoas={tarefa.responsaveis}
          className={compacto ? "max-w-full" : "max-w-[16rem]"}
        />
        {!compacto && tarefa.url && (
          /* O link vem da API; `external-link.ts` não é usado aqui porque o
             destino é fixo e conhecido (app.clickup.com), e o `rel` cobre o
             tabnabbing.

             Fora do quadro: numa coluna estreita, "Abrir no ClickUp" em todo
             cartão é a informação mais repetida e a menos útil da tela. No
             detalhe da tarefa ele continua. */
          <a
            href={tarefa.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink-muted hover:text-ink hover:underline"
          >
            Abrir no ClickUp
          </a>
        )}
      </div>
    </div>
  );
}
