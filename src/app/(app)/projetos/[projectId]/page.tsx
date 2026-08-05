import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { ProjectDetail } from "@/components/features/projects/ProjectDetail";
import { getCategories, getProject, getProjectContents, getProjects } from "@/lib/data";
import { requireModule } from "@/lib/guards";
import { lerUuid } from "@/lib/validation";

/**
 * A tela de um projeto: Tarefas, Capturas, Cadernos, Pastas e Agenda.
 *
 * ⚠️ Duas coisas que não podem sair daqui:
 *
 *   1. `requireModule` na PRIMEIRA linha. Esta rota responde a quem digitar o
 *      endereço com o módulo desligado, se o guard sair.
 *   2. A validação do parâmetro da URL ANTES de usá-lo como id. Ele vem da
 *      barra de endereços, não de um `<Link>` que a aplicação gerou — e um id
 *      malformado chega ao Postgres como "invalid input syntax for type uuid",
 *      que vira 500 em vez de 404.
 *
 * ⚠️ POR QUE ESTA PÁGINA CARREGA CATEGORIAS E A LISTA DE PROJETOS. Elas não
 * aparecem em lugar nenhum da tela — são para o "Criar aqui" da seção Tarefas,
 * que abre o `TaskForm` de verdade (o mesmo do módulo) dentro de um modal, e
 * aquele formulário tem os campos Categoria e Projeto. Buscá-las só quando o
 * modal abrisse exigiria uma segunda ida ao servidor no meio de um clique;
 * aqui elas vêm no mesmo `Promise.all` das outras três consultas, que já
 * acontecem de qualquer forma.
 */
export default async function ProjetoPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const ctx = await requireModule("projetos");
  const { projectId } = await params;

  const id = lerUuid(projectId);
  if (!id) notFound();

  // `getProject` já filtra `deleted_at is null` — projeto apagado é 404, não
  // uma tela vazia com aparência de projeto legítimo.
  const projeto = await getProject(id);
  if (!projeto) notFound();

  const [conteudo, categorias, projetos] = await Promise.all([
    getProjectContents(id),
    getCategories(),
    getProjects(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Projeto"
        title={projeto.name}
        subtitle={projeto.description ?? undefined}
        user={{ name: ctx.displayName, avatarUrl: ctx.avatarUrl }}
      />
      <ProjectDetail
        projeto={projeto}
        conteudo={conteudo}
        categorias={categorias}
        projetos={projetos}
      />
    </>
  );
}
