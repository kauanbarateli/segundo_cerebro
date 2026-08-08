"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icons";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { TaskForm } from "@/components/features/tasks/TaskForm";
import { completeTask, reopenTask } from "@/app/(app)/tarefas/actions";
import type { Category, Project, Task } from "@/lib/database.types";
import { formatDayLabel, formatTime } from "@/lib/utils";

/**
 * Detalhe de uma tarefa INTERNA, aberto de onde ela estiver listada.
 *
 * ============================================================================
 * POR QUE ISTO EXISTE
 * ============================================================================
 * Na tela de um projeto, uma página de conhecimento sempre foi clicável (ela tem
 * `/conhecimento/pagina/{id}`) e uma tarefa nunca foi — o único caminho era
 * "Abrir módulo", que leva a `/tarefas` inteiro e obriga a procurar. Não era
 * regressão: é que `/tarefas/[id]` não existe, `/tarefas` é lista.
 *
 * ⚠️ E continua não existindo, de propósito. Criar a rota resolveria o mesmo
 * problema com mais superfície: um layout, um `notFound`, uma consulta por id e
 * mais um lugar de onde voltar. O painel reaproveita a lista que a tela já
 * carregou e não inventa navegação. Se um dia aparecer demanda por link
 * copiável, o passo seguinte é `/tarefas?tarefa=<id>` abrindo este mesmo painel
 * — o componente já está pronto para isso, porque não sabe de onde foi aberto.
 *
 * ============================================================================
 * ⚠️ UM NÍVEL SÓ — EDITAR SUBSTITUI, NÃO EMPILHA
 * ============================================================================
 * "Editar" troca o CONTEÚDO deste painel pelo formulário, em vez de abrir um
 * segundo modal por cima. Painel dentro de painel dentro da tela do projeto são
 * três camadas de Esc: a primeira fecha qual? O usuário não tem como saber, e a
 * armadilha de foco do `Modal` passa a disputar com ela mesma.
 */
export function TarefaSheet({
  tarefa,
  categorias,
  projetos,
  onFechar,
  onDesvincular,
}: {
  tarefa: Task;
  categorias: Category[];
  projetos: Project[];
  onFechar: () => void;
  /**
   * Opcional: só a tela de um projeto tem o que desvincular. Sem ela o botão
   * não aparece — e é o certo, porque em `/tarefas` "desvincular do projeto"
   * seria uma operação sem contexto visível.
   */
  onDesvincular?: () => void;
}) {
  const { toast } = useToast();
  const [editando, setEditando] = useState(false);
  const [pendente, iniciar] = useTransition();

  const concluida = tarefa.status === "done";
  const quando = tarefa.due_at ?? tarefa.scheduled_start_at;

  function alternarConclusao() {
    iniciar(async () => {
      const r = concluida ? await reopenTask(tarefa.id) : await completeTask(tarefa.id);
      if (r.ok) {
        toast(concluida ? "Tarefa reaberta" : "Tarefa concluída", "success");
        // Fecha porque a lista atrás foi revalidada e esta linha pode ter mudado
        // de seção (abertas → concluídas). Manter o painel aberto sobre um
        // estado que não existe mais é pior que fechá-lo.
        onFechar();
      } else {
        toast(r.error ?? "Erro ao atualizar", "error");
      }
    });
  }

  if (editando) {
    return (
      <Modal title={`Editar «${tarefa.title}»`} onClose={onFechar}>
        <TaskForm
          categories={categorias}
          projetos={projetos}
          task={tarefa}
          onDone={onFechar}
          onCancel={() => setEditando(false)}
        />
      </Modal>
    );
  }

  return (
    <Modal title={tarefa.title} onClose={onFechar}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={concluida ? "outline" : undefined}>
            {concluida ? "Concluída" : ROTULO_DO_STATUS[tarefa.status] ?? tarefa.status}
          </Badge>
          <Badge tone="outline">{ROTULO_DA_PRIORIDADE[tarefa.priority] ?? tarefa.priority}</Badge>
        </div>

        {tarefa.description && (
          <p className="whitespace-pre-wrap text-corpo text-ink-muted">{tarefa.description}</p>
        )}

        <dl className="space-y-2">
          <Linha rotulo="Vencimento" valor={descreverInstante(tarefa.due_at, tarefa.all_day)} />
          <Linha
            rotulo="Agendada"
            valor={descreverInstante(tarefa.scheduled_start_at, tarefa.all_day)}
          />
          {!quando && (
            <p className="text-legenda text-ink-subtle">Esta tarefa não tem data.</p>
          )}
        </dl>

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {onDesvincular && (
            <Button variant="ghost" size="sm" onClick={onDesvincular} disabled={pendente}>
              <Icon.X width={14} height={14} aria-hidden />
              Desvincular
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setEditando(true)} disabled={pendente}>
            Editar
          </Button>
          <Button variant="primary" size="sm" onClick={alternarConclusao} disabled={pendente}>
            {pendente ? "Salvando…" : concluida ? "Reabrir" : "Concluir"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const ROTULO_DO_STATUS: Record<string, string> = {
  todo: "A fazer",
  in_progress: "Em andamento",
  done: "Concluída",
  archived: "Arquivada",
};

const ROTULO_DA_PRIORIDADE: Record<string, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};

/**
 * `all_day` decide se a HORA aparece — nunca o valor guardado.
 *
 * O instante existe sempre (a coluna é `timestamptz`); o que "dia inteiro"
 * significa é que a hora não foi escolhida por ninguém e mostrá-la seria inventar
 * precisão. É a mesma regra que `TasksView` e `TarefasDeHoje` já aplicam.
 */
function descreverInstante(iso: string | null, diaInteiro: boolean): string | null {
  if (!iso) return null;
  return diaInteiro ? formatDayLabel(iso) : `${formatDayLabel(iso)} · ${formatTime(iso)}`;
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  if (!valor) return null;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-legenda text-ink-subtle">{rotulo}</dt>
      <dd className="text-corpo text-ink">{valor}</dd>
    </div>
  );
}
