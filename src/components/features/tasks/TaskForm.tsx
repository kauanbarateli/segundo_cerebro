"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { Category, Project, Task } from "@/lib/database.types";
import { SeletorDeProjeto } from "@/components/features/projects/SeletorDeProjeto";
import { createTask, updateTask } from "@/app/(app)/tarefas/actions";

const PRIORITIES = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Urgente" },
];

/** Converts a stored ISO datetime to the value a <input type=datetime-local> expects. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

export function TaskForm({
  categories,
  projetos = [],
  projetoInicial,
  task,
  onDone,
  onCancel,
}: {
  categories: Category[];
  /**
   * Os projetos vivos. Vazio (o padrão) some com o seletor — ver
   * `SeletorDeProjeto`. O default existe para que quem não passa a lista não
   * quebre: o campo simplesmente não aparece, e `projectId` chega ausente ao
   * schema, que o traduz para `null`.
   */
  projetos?: Project[];
  /**
   * Projeto já escolhido ao ABRIR o formulário — é o "Criar aqui" da tela de um
   * projeto, que abre este mesmo formulário com o campo preenchido.
   *
   * ⚠️ Três coisas que esta prop deliberadamente NÃO faz:
   *
   *   1. Não muda nada quando não vem. Sem ela o seletor continua começando
   *      em "Sem projeto" na criação, como sempre começou.
   *   2. Não vence o projeto da tarefa em EDIÇÃO (ver o `??` lá embaixo).
   *      Abrir uma tarefa que está no projeto A a partir da tela do projeto B
   *      e vê-la mudar sozinha para B seria reescrever uma decisão do usuário
   *      só porque ele foi olhar.
   *   3. Não TRAVA o campo. O seletor continua editável, e trocar ali dentro
   *      vale: o valor é apenas o ponto de partida. Um campo travado exigiria
   *      explicar por que ele está travado, e a explicação seria "porque você
   *      clicou naquele botão" — que a pessoa já sabe.
   */
  projetoInicial?: string | null;
  task?: Task;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [allDay, setAllDay] = useState(task?.all_day ?? false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = task ? await updateTask(task.id, formData) : await createTask(formData);
      if (result.ok) {
        toast(task ? "Tarefa atualizada" : "Tarefa criada", "success");
        onDone();
      } else {
        setError(result.error ?? "Erro ao salvar");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="title" className="mb-1.5 block text-corpo font-medium text-ink">
          Título
        </label>
        <input
          id="title"
          name="title"
          required
          defaultValue={task?.title ?? ""}
          className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2"
        />
      </div>

      <div>
        <label htmlFor="description" className="mb-1.5 block text-corpo font-medium text-ink">
          Descrição
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={task?.description ?? ""}
          className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-2"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="categoryId" className="mb-1.5 block text-corpo font-medium text-ink">
            Categoria
          </label>
          <select
            id="categoryId"
            name="categoryId"
            defaultValue={task?.category_id ?? ""}
            className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2"
          >
            <option value="">Sem categoria</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {/* Projeto é faceta ORTOGONAL à categoria, e por isso fica ao lado e
            não dentro dela: uma tarefa de "Trabalho" pode estar no projeto
            "Migração" ou em nenhum, e as duas perguntas são independentes. */}
        {/* O teste é `task ?`, e NÃO `task?.project_id ?? projetoInicial`. A
            diferença aparece na tarefa que está sendo EDITADA e não tem
            projeto: com `??`, o `null` dela cairia no valor inicial e o
            formulário passaria a sugerir o projeto de onde o clique veio —
            transformando "esta tarefa não tem projeto" em "tem". Editar mostra
            o que a tarefa diz, inclusive quando ela diz nada. */}
        <SeletorDeProjeto
          projetos={projetos}
          valorInicial={task ? task.project_id : projetoInicial}
        />
        <div>
          <label htmlFor="priority" className="mb-1.5 block text-corpo font-medium text-ink">
            Prioridade
          </label>
          <select
            id="priority"
            name="priority"
            defaultValue={task?.priority ?? "medium"}
            className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2"
          >
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="dueAt" className="mb-1.5 block text-corpo font-medium text-ink">
            Vencimento
          </label>
          <input
            id="dueAt"
            name="dueAt"
            type="datetime-local"
            defaultValue={toLocalInput(task?.due_at ?? null)}
            className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2"
          />
        </div>
        <div>
          <label htmlFor="scheduledStartAt" className="mb-1.5 block text-corpo font-medium text-ink">
            Horário agendado
          </label>
          <input
            id="scheduledStartAt"
            name="scheduledStartAt"
            type={allDay ? "date" : "datetime-local"}
            defaultValue={toLocalInput(task?.scheduled_start_at ?? null)}
            className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-corpo text-ink-muted">
        <input
          type="checkbox"
          name="allDay"
          value="true"
          checked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
          className="h-4 w-4 rounded border-line-strong"
        />
        Dia inteiro
      </label>

      {error && (
        <p role="alert" className="text-corpo text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel} type="button">
          Cancelar
        </Button>
        <Button variant="primary" size="sm" type="submit" disabled={pending}>
          {pending ? "Salvando…" : task ? "Salvar" : "Criar tarefa"}
        </Button>
      </div>
    </form>
  );
}
