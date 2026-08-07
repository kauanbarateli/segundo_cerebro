"use client";

import { useMemo, useState, useTransition } from "react";
import { Badge, PillButton } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/states";
import { Icon } from "@/components/ui/Icons";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { TaskForm } from "@/components/features/tasks/TaskForm";
import { TaskBoard } from "@/components/features/tasks/TaskBoard";
import { LinkCountBadge } from "@/components/features/links/LinkCountBadge";
import { RelatedSection } from "@/components/features/links/RelatedSection";
import { ClickUpPanel } from "@/components/features/tasks/ClickUpPanel";
import { useBuscaAplicavel, useTermoDeBusca } from "@/components/layout/BuscaNaPagina";
import { semAcento } from "@/lib/knowledge";
import type { Category, ClickUpConnection, Project, Task, TaskPriority } from "@/lib/database.types";
import type { RelatedItem } from "@/lib/links";
import { formatDayLabel, formatTime, cn } from "@/lib/utils";
import { completeTask, reopenTask, deleteTask, archiveTask } from "@/app/(app)/tarefas/actions";
import { startOfDay, endOfDay } from "@/lib/utils";

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};

type Filter = "all" | "Trabalho" | "Estudos" | "Pessoal" | "today" | "overdue" | "done";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "Trabalho", label: "Trabalho" },
  { key: "Estudos", label: "Estudos" },
  { key: "Pessoal", label: "Pessoal" },
  { key: "today", label: "Hoje" },
  { key: "overdue", label: "Atrasadas" },
  { key: "done", label: "Concluídas" },
];

export function TaskCheckbox({ task }: { task: Task }) {
  const [pending, start] = useTransition();
  const { toast } = useToast();
  const done = task.status === "done";
  return (
    <button
      type="button"
      aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"}
      aria-pressed={done}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = done ? await reopenTask(task.id) : await completeTask(task.id);
          if (!r.ok) toast(r.error ?? "Erro", "error");
        })
      }
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
        done
          ? "border-transparent bg-accent text-accent-ink"
          : "border-line-strong text-transparent hover:border-ink",
      )}
    >
      <Icon.Check width={13} height={13} />
    </button>
  );
}

export function TasksView({
  tasks,
  categories,
  initialView = "list",
  related,
  linkCandidates,
  projetos = [],
  clickup,
}: {
  tasks: Task[];
  categories: Category[];
  /**
   * ⚠️ NÃO inclui "clickup" de propósito.
   *
   * Vem de `preferences.default_task_view`, que tem um CHECK de dois valores no
   * banco. Gravar "clickup" ali exigiria uma migration ampliando o CHECK — e a
   * recomendação é não gravar mesmo assim: a aba do TRABALHO não deve ser a que
   * abre por padrão numa aplicação pessoal.
   */
  initialView?: "list" | "board";
  /**
   * Vínculos de TODAS as tarefas, carregados de uma vez pela página. Chega como
   * Map porque a busca é por id, uma vez por linha renderizada — e porque o
   * payload do RSC serializa Map nativamente desde o React 19.
   */
  related: Map<string, RelatedItem[]>;
  /** Capturas e eventos oferecidos no autocomplete. */
  linkCandidates: RelatedItem[];
  /** Projetos vivos, para o seletor do formulário. Vazio some com o campo. */
  projetos?: Project[];
  /**
   * Estado da conexão com o ClickUp. `null` = nunca conectou.
   *
   * Vem do Postgres, não da API do ClickUp — a página não espera por rede
   * externa. Ver `getClickUpConnection` em data.ts.
   */
  clickup?: ClickUpConnection | null;
}) {
  const { toast } = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<"list" | "board" | "clickup">(initialView);

  // A aba só existe quando há conexão ATIVA. Desligar no painel de
  // Configurações a faz sumir sem apagar o token.
  const mostrarClickUp = clickup?.ativo === true;
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [, startDelete] = useTransition();

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  /*
    A BUSCA NÃO ALCANÇA A ABA DO CLICKUP, e a linha abaixo é o que garante isso —
    o campo do cabeçalho some quando aquela aba está aberta.

    Três motivos, e o primeiro sozinho já bastaria:

      1. A lista do ClickUp é TRUNCADA nas primeiras 500. Dizer "nada
         encontrado" sobre uma tarefa que existe e não veio é uma resposta
         falsa, e quem lê não tem como saber.
      2. Na primeira montagem daquela aba a lista está vazia por uma rede
         inteira — buscar ali devolveria vazio por um motivo que nada tem a ver
         com o termo.
      3. É exatamente o defeito das pills, que acabou de ser corrigido logo
         abaixo. Repeti-lo com a busca seria trocar uma affordance falsa por
         outra.

    A aba do ClickUp tem o filtro dela, dentro do painel.
  */
  useBuscaAplicavel(view !== "clickup");
  const termoDeBusca = useTermoDeBusca();

  const filtered = useMemo(() => {
    const todayStart = startOfDay(new Date()).getTime();
    const todayEnd = endOfDay(new Date()).getTime();
    /*
      `semAcento` dos DOIS lados: sem isso, "reuniao" não acha "reunião" — e
      quem digita rápido não põe acento. É o mesmo helper que a busca do
      Conhecimento usa, já testado.

      Busca em `title` e `description`. Não existe campo `notes` na tabela.
    */
    const alvo = semAcento(termoDeBusca.trim());
    return tasks.filter((t) => {
      if (alvo.length > 0) {
        const casa =
          semAcento(t.title).includes(alvo) ||
          semAcento(t.description ?? "").includes(alvo);
        if (!casa) return false;
      }
      const when = t.due_at ?? t.scheduled_start_at;
      const ts = when ? new Date(when).getTime() : null;
      switch (filter) {
        case "all":
          return true;
        case "today":
          return ts != null && ts >= todayStart && ts <= todayEnd;
        case "overdue":
          return ts != null && ts < todayStart && t.status !== "done";
        case "done":
          return t.status === "done";
        default:
          return catById.get(t.category_id ?? "") === filter;
      }
    });
  }, [tasks, filter, catById, termoDeBusca]);

  const buscando = termoDeBusca.trim().length > 0;

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(task: Task) {
    setEditing(task);
    setFormOpen(true);
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        {/*
          AS PILLS SOMEM NA ABA DO CLICKUP, e isso não é economia de espaço.

          Elas são categorias da tabela `tasks` deste aplicativo — Trabalho,
          Estudos, Pessoal vêm do banco local e não existem no ClickUp. Ficando
          visíveis com aquela aba aberta, eram controles que não afetavam nada
          do que estava sendo mostrado: uma affordance falsa, e a pior espécie,
          porque clicar não dá erro nenhum — simplesmente não acontece nada e a
          conclusão razoável é que o aplicativo está quebrado.

          O lugar de filtrar tarefas do ClickUp é dentro do próprio painel, com
          as dimensões que existem lá (`ClickUpFiltros`).

          A `<div>` continua no lugar quando some, para o grupo de visões não
          pular da direita para a esquerda ao trocar de aba.
        */}
        <div className="flex flex-wrap gap-2">
          {view !== "clickup" &&
            FILTERS.map((f) => (
              <PillButton key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}
              </PillButton>
            ))}
        </div>
        <div className="flex items-center gap-2">
          {/*
            O GRUPO em si só aparecia a partir de `md`, porque as duas únicas
            visões eram Lista e Quadro e o Quadro é desktop-only (arrastar em
            tela pequena é ruim). Com o ClickUp, esconder o grupo inteiro no
            celular tornaria a aba INALCANÇÁVEL ali — e ler tarefas do trabalho
            no celular é justamente onde a integração mais serve.

            Então a regra passou a ser por BOTÃO: o grupo aparece no celular
            quando há ClickUp, e é o Quadro que fica escondido lá.
          */}
          <div
            className={cn(
              "items-center gap-1 rounded-md border border-line-strong p-0.5 md:flex",
              mostrarClickUp ? "flex" : "hidden",
            )}
          >
            <button
              type="button"
              aria-label="Ver em lista"
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
              className={cn(
                "flex h-7 w-8 items-center justify-center rounded-sm transition-colors",
                view === "list" ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              <Icon.List width={15} height={15} />
            </button>
            <button
              type="button"
              aria-label="Ver em quadro"
              aria-pressed={view === "board"}
              onClick={() => setView("board")}
              className={cn(
                "hidden h-7 w-8 items-center justify-center rounded-sm transition-colors md:flex",
                view === "board" ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              <Icon.Board width={15} height={15} />
            </button>
            {mostrarClickUp && (
              <button
                type="button"
                aria-label="Ver tarefas do ClickUp"
                aria-pressed={view === "clickup"}
                onClick={() => setView("clickup")}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-sm px-2 transition-colors",
                  view === "clickup" ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink",
                )}
              >
                <Icon.Link width={14} height={14} />
                <span className="text-meta font-medium">ClickUp</span>
              </button>
            )}
          </div>
          <Button variant="primary" size="sm" onClick={openCreate}>
            <Icon.Capture width={15} height={15} /> Nova tarefa
          </Button>
        </div>
      </div>

      {view === "board" ? (
        <div className="hidden p-4 md:block">
          <TaskBoard tasks={filtered} categories={categories} related={related} />
        </div>
      ) : null}

      {/*
        A aba do ClickUp busca ao montar, por Server Action. Ela é renderizada
        só quando selecionada — e permanece montada enquanto estiver, o que é o
        que faz o cache de 60 s dela sobreviver a ir e voltar para a Lista.
      */}
      {view === "clickup" && mostrarClickUp && <ClickUpPanel />}

      {view === "board" && (
        <div className="md:hidden">
          <EmptyState
            icon="Board"
            title="Quadro disponível no desktop"
            description="Em telas pequenas, use a lista."
            action={
              <Button variant="secondary" size="sm" onClick={() => setView("list")}>
                Voltar para lista
              </Button>
            }
          />
        </div>
      )}

      {view === "list" && filtered.length === 0 ? (
        /* Vazio por BUSCA e vazio por não ter tarefa são coisas diferentes, e
           oferecer "Nova tarefa" a quem está procurando uma existente é
           responder outra pergunta. */
        buscando ? (
          <EmptyState
            icon="Search"
            title={`Nenhuma tarefa para “${termoDeBusca.trim()}”`}
            description="A busca olha o título e a descrição, e ignora acentos. Os filtros acima também estão valendo."
          />
        ) : (
          <EmptyState
            icon="Tasks"
            title="Nenhuma tarefa aqui"
            description="Crie uma tarefa manual para começar a organizar o que importa."
            action={
              <Button variant="secondary" size="sm" onClick={openCreate}>
                Nova tarefa
              </Button>
            }
          />
        )
      ) : view === "list" ? (
        <>
          {/*
            Desktop table

            O contêiner rolável não é enfeite. A tabela só existe a partir de
            `md` (768px), mas EM 768px ela ainda não cabe: cinco colunas de
            largura própria (a de "Quando" é `whitespace-nowrap` e não encolhe)
            mais os `px-4` de cada célula somam mais que os ~728px úteis. Sem
            este `overflow-x-auto` quem estoura não é a tabela — é a PÁGINA, que
            passa a rolar na horizontal inteira, cabeçalho e barra lateral
            junto. Com ele, o excesso rola dentro do cartão e só ele se mexe.

            Seguro por causa do portal: o `RowMenu` renderiza o painel em
            document.body (ver ui/DropdownMenu.tsx), então criar aqui um contexto
            de rolagem não corta o menu das últimas linhas.
          */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full">
              <thead>
                <tr className="border-b border-line text-left">
                  {["Quando", "Tarefa", "Área", "Prioridade", "Status", ""].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-meta font-medium uppercase tracking-wide text-ink-subtle"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const when = t.due_at ?? t.scheduled_start_at;
                  return (
                    <tr key={t.id} className="border-b border-line last:border-0 hover:bg-surface-muted">
                      <td className="whitespace-nowrap px-4 py-3 text-corpo text-ink-muted">
                        {formatDayLabel(when)}
                        {when && !t.all_day && (
                          <span className="ml-1 text-ink-subtle">{formatTime(when)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <TaskCheckbox task={t} />
                          <button
                            onClick={() => openEdit(t)}
                            className={cn(
                              "text-left text-sm font-medium hover:underline",
                              t.status === "done" ? "text-ink-subtle line-through" : "text-ink",
                            )}
                          >
                            {t.title}
                          </button>
                          <LinkCountBadge count={related.get(t.id)?.length ?? 0} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {t.category_id && <Badge tone="outline">{catById.get(t.category_id)}</Badge>}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={t.priority === "high" || t.priority === "urgent" ? "solid" : "default"}>
                          {PRIORITY_LABEL[t.priority]}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-corpo text-ink-muted">
                        {t.status === "done" ? "Concluída" : t.status === "in_progress" ? "Em andamento" : "A fazer"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <RowMenu
                          onEdit={() => openEdit(t)}
                          onArchive={() =>
                            startDelete(async () => {
                              const r = await archiveTask(t.id);
                              toast(r.ok ? "Arquivada" : r.error ?? "Erro", r.ok ? "success" : "error");
                            })
                          }
                          onDelete={() => setDeleteTarget(t)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="divide-y divide-line md:hidden">
            {filtered.map((t) => {
              const when = t.due_at ?? t.scheduled_start_at;
              return (
                <li key={t.id} className="flex items-start gap-3 px-4 py-3.5">
                  <TaskCheckbox task={t} />
                  <button onClick={() => openEdit(t)} className="min-w-0 flex-1 text-left">
                    <p
                      className={cn(
                        "text-sm font-medium",
                        t.status === "done" ? "text-ink-subtle line-through" : "text-ink",
                      )}
                    >
                      {t.title}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-legenda text-ink-subtle">
                      <span>{formatDayLabel(when)}</span>
                      {t.category_id && <Badge tone="outline">{catById.get(t.category_id)}</Badge>}
                      <Badge>{PRIORITY_LABEL[t.priority]}</Badge>
                      <LinkCountBadge count={related.get(t.id)?.length ?? 0} />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {formOpen && (
        <Modal title={editing ? "Editar tarefa" : "Nova tarefa"} onClose={() => setFormOpen(false)}>
          <TaskForm
            categories={categories}
            projetos={projetos}
            task={editing ?? undefined}
            onDone={() => setFormOpen(false)}
            onCancel={() => setFormOpen(false)}
          />
          {/*
            FORA do <form> do TaskForm, e é de propósito: os controles da seção
            (o campo de busca e os botões de remover) dentro do formulário
            entrariam na submissão da tarefa — Enter no autocomplete salvaria a
            tarefa, e cada "Remover vínculo" viraria um botão a mais competindo
            pelo envio implícito. Como irmão, o formulário nem enxerga a seção.

            Só aparece na EDIÇÃO: vincular exige um uuid, e a tarefa nova ainda
            não tem um. Oferecer o campo antes de salvar prometeria um vínculo
            que não teria onde ser gravado.
          */}
          {editing && (
            <RelatedSection
              className="mt-5"
              entity={{ kind: "task", id: editing.id }}
              related={related.get(editing.id) ?? []}
              candidates={linkCandidates}
            />
          )}
        </Modal>
      )}

      <ConfirmationDialog
        open={deleteTarget !== null}
        title="Excluir tarefa"
        description={`"${deleteTarget?.title ?? ""}" será removida permanentemente.`}
        confirmLabel="Excluir"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (!target) return;
          startDelete(async () => {
            const r = await deleteTask(target.id);
            toast(r.ok ? "Tarefa excluída" : r.error ?? "Erro", r.ok ? "success" : "error");
          });
        }}
      />
    </Card>
  );
}

/**
 * O menu de ações da linha.
 *
 * Era um `position: absolute` dentro do `<Card className="overflow-hidden">`
 * desta tela, e por isso vinha CORTADO nas últimas linhas da tabela: o
 * `overflow: hidden` do cartão recorta descendentes posicionados que passem da
 * borda. Agora o painel é renderizado em `document.body` por portal — ver
 * `ui/DropdownMenu.tsx` para o raciocínio completo.
 */
function RowMenu({
  onEdit,
  onArchive,
  onDelete,
}: {
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu
      label="Ações da tarefa"
      items={[
        { label: "Editar", onClick: onEdit },
        { label: "Arquivar", onClick: onArchive },
        { label: "Excluir", onClick: onDelete, danger: true },
      ]}
    >
      <Icon.Dots width={16} height={16} />
    </DropdownMenu>
  );
}
