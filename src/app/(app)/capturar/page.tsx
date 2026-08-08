import { PageHeader } from "@/components/layout/PageHeader";
import { CaptureView } from "@/components/features/capture/CaptureView";
import {
  getCaptures,
  getCategories,
  getEventCandidates,
  getImagensDasCapturas,
  getProjects,
  getRelatedItems,
  getTaskCandidates,
} from "@/lib/data";
import { requireModule } from "@/lib/guards";

export default async function CapturarPage() {
  const ctx = await requireModule("capturar");
  const [captures, categories, related, tarefas, eventos, projetos] = await Promise.all([
    getCaptures(),
    getCategories(),
    getRelatedItems("capture"),
    getTaskCandidates(),
    getEventCandidates(),
    getProjects(),
  ]);

  /*
    Fora do `Promise.all` acima porque DEPENDE dele: só dá para pedir as imagens
    depois de saber quais capturas estão na tela. É a única consulta encadeada
    desta página, e o custo é uma ida ao banco mais a assinatura das URLs.
  */
  const imagens = await getImagensDasCapturas(captures.map((c) => c.id));

  return (
    <>
      <PageHeader
        eyebrow="Caixa de entrada"
        title="Tire isso da cabeça."
        subtitle="Capture primeiro. Organize quando fizer sentido."
        user={{ name: ctx.displayName, avatarUrl: ctx.avatarUrl }}
      />
      <CaptureView
        captures={captures}
        categories={categories}
        related={related}
        linkCandidates={[...tarefas, ...eventos]}
        projetos={projetos}
        userId={ctx.userId}
        imagens={imagens}
      />
    </>
  );
}
