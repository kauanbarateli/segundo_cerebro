import { PageHeader } from "@/components/layout/PageHeader";
import { TasksView } from "@/components/features/tasks/TasksView";
import {
  getCaptureCandidates,
  getCategories,
  getEventCandidates,
  getRelatedItems,
  getTasks,
} from "@/lib/data";
import { requireModule } from "@/lib/guards";

export default async function TarefasPage() {
  const ctx = await requireModule("tarefas");
  // Tudo numa onda só. Os vínculos entram AQUI, e não depois com os ids das
  // tarefas em mãos, justamente para não custar uma ida e volta em série a cada
  // navegação — ver a nota em `getRelatedItems`.
  const [tasks, categories, related, capturas, eventos] = await Promise.all([
    getTasks(),
    getCategories(),
    getRelatedItems("task"),
    getCaptureCandidates(),
    getEventCandidates(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Execução"
        title="Faça o que importa."
        subtitle="Trabalho, estudos e vida pessoal na mesma visão."
        user={{ name: ctx.displayName, avatarUrl: ctx.avatarUrl }}
      />
      <TasksView
        tasks={tasks}
        categories={categories}
        initialView={ctx.preferences?.default_task_view ?? "list"}
        related={related}
        // Uma tarefa vincula com captura e com evento — nunca com outra tarefa
        // (não existe tabela para isso). Por isso a lista de candidatos junta
        // exatamente os outros dois tipos.
        linkCandidates={[...capturas, ...eventos]}
      />
    </>
  );
}
