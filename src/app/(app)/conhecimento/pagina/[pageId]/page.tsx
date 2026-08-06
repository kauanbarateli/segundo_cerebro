import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import EditorDePagina from "@/components/features/knowledge/EditorLoader";
import { KnowledgeSidebar } from "@/components/features/knowledge/KnowledgeSidebar";
import { Icon } from "@/components/ui/Icons";
import { getNotebookPages, getNotebooks, getPage } from "@/lib/data";
import { caminhoDaPagina, rotuloDaPagina } from "@/lib/knowledge";
import { requireModule } from "@/lib/guards";

/**
 * Uma página do caderno.
 *
 * O endereço é `/conhecimento/pagina/<uuid>` — com o segmento estático "pagina"
 * no meio de propósito. Um `[pageId]` colado na raiz do módulo capturaria
 * qualquer segmento, e a primeira rota irmã que aparecesse (uma "/busca", uma
 * "/caderno/x") passaria a colidir com ele. É também o endereço já documentado
 * na seção 2.4 de 0011.
 *
 * O que precisa sobreviver a qualquer reforma desta tela: `requireModule`
 * primeiro e o parâmetro validado antes de virar consulta. Ver o comentário de
 * `(app)/conhecimento/page.tsx`.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PaginaDeConhecimento({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  const ctx = await requireModule("conhecimento");
  const { pageId } = await params;

  // Id malformado é 404, não consulta. Sem esta guarda o valor iria para o
  // PostgREST, o Postgres recusaria o cast para uuid (22P02) e o usuário veria
  // uma página de erro do servidor no lugar de "não encontrado".
  if (!UUID_RE.test(pageId)) notFound();

  const pagina = await getPage(pageId);
  // `null` cobre os três casos de uma vez: id inexistente, página apagada e
  // página de outro usuário (invisível sob a RLS). Os três são 404 — responder
  // "sem permissão" a uma página alheia confirmaria que ela existe.
  if (!pagina) notFound();

  // A lista de cadernos é da barra lateral (que é a mesma do índice, com o
  // mesmo CRUD); a de páginas serve à árvore E ao caminho até aqui. As duas não
  // dependem uma da outra: em paralelo.
  const [cadernos, paginas] = await Promise.all([
    getNotebooks(),
    getNotebookPages(pagina.notebook_id),
  ]);
  const caminho = caminhoDaPagina(paginas, pagina.id);

  return (
    <>
      <PageHeader
        eyebrow="Conhecimento"
        title={rotuloDaPagina(pagina.title)}
        user={{ name: ctx.displayName, avatarUrl: ctx.avatarUrl }}
      />

      <div className="grid gap-8 md:grid-cols-[260px_1fr]">
        <KnowledgeSidebar
          cadernos={cadernos}
          cadernoAtivoId={pagina.notebook_id}
          paginas={paginas}
          paginaAtivaId={pagina.id}
        />

        <article className="min-w-0">
          {caminho.length > 1 && (
            <nav
              aria-label="Caminho"
              className="mb-4 flex flex-wrap items-center gap-1 text-legenda text-ink-subtle"
            >
              {caminho.map((no, i) => (
                <span key={no.id} className="flex items-center gap-1">
                  {i > 0 && <Icon.ChevronRight width={13} height={13} aria-hidden="true" />}
                  {no.id === pagina.id ? (
                    // A página atual não é link para ela mesma: `aria-current`
                    // marca onde se está, e um link que não sai do lugar é uma
                    // parada de teclado que não leva a nada.
                    <span aria-current="page" className="text-ink-muted">
                      {rotuloDaPagina(no.title)}
                    </span>
                  ) : (
                    <Link href={`/conhecimento/pagina/${no.id}`} className="hover:text-ink">
                      {rotuloDaPagina(no.title)}
                    </Link>
                  )}
                </span>
              ))}
            </nav>
          )}

          {/* O EDITOR.
              Vem de `EditorLoader` e NUNCA de `Editor`: o primeiro é o invólucro
              com `dynamic(..., { ssr: false })` que mantém os ~150 kB do
              ProseMirror num chunk à parte. Importar o segundo daqui colocaria o
              editor no bundle comum de todas as rotas. Ver o cabeçalho de
              `EditorLoader.tsx`.

              `key={pagina.id}` NÃO É DECORAÇÃO. Ao navegar de
              `/conhecimento/pagina/A` para `/conhecimento/pagina/B` o React
              reaproveitaria a instância — mesma posição na árvore, mesmo tipo de
              componente — e o editor, que guarda conteúdo e carimbo de
              concorrência em refs, continuaria com o texto de A enquanto a URL
              já diz B. O primeiro autosave gravaria A por cima de B. Com a
              `key`, a troca de página é remontagem, e a desmontagem ainda
              dispara a gravação do que estava pendente. */}
          <EditorDePagina
            key={pagina.id}
            pageId={pagina.id}
            titulo={pagina.title}
            conteudo={pagina.content}
            atualizadoEm={pagina.updated_at}
          />
        </article>
      </div>
    </>
  );
}
