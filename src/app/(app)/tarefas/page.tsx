import { PageHeader } from "@/components/layout/PageHeader";
import { BuscaNaPagina, CampoDeBusca } from "@/components/layout/BuscaNaPagina";
import { TasksView } from "@/components/features/tasks/TasksView";
import {
  getCaptureCandidates,
  getCategories,
  getEventCandidates,
  getClickUpConnection,
  getRelatedItems,
  getTasks,
} from "@/lib/data";
import { requireModule } from "@/lib/guards";

export default async function TarefasPage() {
  const ctx = await requireModule("tarefas");
  // Tudo numa onda só. Os vínculos entram AQUI, e não depois com os ids das
  // tarefas em mãos, justamente para não custar uma ida e volta em série a cada
  // navegação — ver a nota em `getRelatedItems`.
  const [tasks, categories, related, capturas, eventos, clickup] = await Promise.all([
    getTasks(),
    getCategories(),
    getRelatedItems("task"),
    getCaptureCandidates(),
    getEventCandidates(),
    // Consulta LOCAL (uma linha indexada por user_id), nao a API do ClickUp.
    // Ver getClickUpConnection: por a chamada externa aqui faria a lista
    // pessoal esperar pelo ClickUp a cada navegacao.
    getClickUpConnection(),
  ]);

  return (
    /*
      O provedor envolve o CABEÇALHO E A LISTA porque os dois são irmãos aqui, e
      o campo de busca mora num e o filtro no outro. Esta página continua sendo
      Componente de Servidor: o `PageHeader` é passado como filho e é renderizado
      no servidor do mesmo jeito — o provedor de cliente só embrulha a saída.

      A busca NÃO vai para a URL, e o motivo está escrito em `BuscaNaPagina.tsx`:
      o `Promise.all` acima seria re-executado inteiro a cada tecla, para
      devolver exatamente os mesmos dados.
    */
    <BuscaNaPagina>
      <PageHeader
        eyebrow="Execução"
        title="Faça o que importa."
        subtitle="Trabalho, estudos e vida pessoal na mesma visão."
        user={{ name: ctx.displayName, avatarUrl: ctx.avatarUrl }}
        busca={<CampoDeBusca placeholder="Buscar tarefas" rotulo="Buscar tarefas" />}
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
        clickup={clickup}
      />
    </BuscaNaPagina>
  );
}
