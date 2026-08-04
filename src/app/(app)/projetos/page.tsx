import { PageHeader } from "@/components/layout/PageHeader";
import { ProjectsView } from "@/components/features/projects/ProjectsView";
import { getProjects } from "@/lib/data";
import { requireModule } from "@/lib/guards";

/** ⚠️ `requireModule` na PRIMEIRA linha — esconder o link não é controle de acesso. */
export default async function ProjetosPage() {
  const ctx = await requireModule("projetos");
  const projetos = await getProjects();

  return (
    <>
      <PageHeader
        eyebrow="Projetos"
        title="O que você está tocando."
        subtitle="Agrupa tarefas, capturas, cadernos e pastas — sem duplicar nada."
        user={{ name: ctx.displayName, avatarUrl: ctx.avatarUrl }}
      />
      <ProjectsView projetos={projetos} />
    </>
  );
}
