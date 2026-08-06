import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/states";
import { Icon } from "@/components/ui/Icons";
import { KnowledgeSearch } from "@/components/features/knowledge/KnowledgeSearch";
import {
  KnowledgeSidebar,
  NovoCadernoBotao,
} from "@/components/features/knowledge/KnowledgeSidebar";
import { getNotebooks, getNotebookPages, searchKnowledge } from "@/lib/data";
import { destacarOcorrencias, rotuloDaPagina } from "@/lib/knowledge";
import { requireModule } from "@/lib/guards";
import { formatDayLabel } from "@/lib/utils";

/**
 * Índice do módulo Conhecimento: cadernos, árvore do caderno aberto e busca.
 *
 * O QUE NÃO PODE MUDAR AQUI (herdado da casca de servidor original):
 *
 *   1. `await requireModule("conhecimento")` na PRIMEIRA linha. Esconder o link
 *      da barra lateral não é controle de acesso — esta rota responde a quem
 *      digitar o endereço, com o módulo desligado, se o guard sair daqui.
 *   2. A validação dos parâmetros da URL antes de usá-los como id. Eles vêm da
 *      barra de endereços, não de um `<Link>` que a aplicação gerou.
 *
 * A árvore e o CRUD vivem em `KnowledgeSidebar` (componente de cliente, porque
 * expandir, renomear e mover são interação); a BUSCA continua sendo executada
 * aqui, no servidor. O campo é que é cliente — ele só troca o `q` da URL. Trazer
 * a busca para o cliente exigiria uma action nova e tiraria o termo da URL, que
 * é o que a torna compartilhável e reversível pelo botão "voltar".
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quantas páginas recentes aparecem quando não há busca em andamento. */
const RECENTES = 6;

/**
 * Título com o termo buscado em destaque.
 *
 * Recebe SEGMENTOS de `destacarOcorrencias` e monta `<mark>` com eles, em vez de
 * receber marcação pronta: o título vem do banco e é texto que o usuário
 * escreveu. Montar HTML e injetar com `dangerouslySetInnerHTML` seria abrir um
 * XSS por causa de um grifo.
 */
function TituloComDestaque({ texto, termo }: { texto: string; termo: string }) {
  return (
    <>
      {destacarOcorrencias(texto, termo).map((trecho, i) =>
        trecho.destaque ? (
          <mark key={i} className="rounded-xs bg-ink/15 px-0.5 text-ink">
            {trecho.texto}
          </mark>
        ) : (
          <span key={i}>{trecho.texto}</span>
        ),
      )}
    </>
  );
}

export default async function ConhecimentoPage({
  searchParams,
}: {
  searchParams: Promise<{ caderno?: string; q?: string }>;
}) {
  const ctx = await requireModule("conhecimento");
  const sp = await searchParams;

  const cadernos = await getNotebooks();

  // Caderno da URL só é aceito se for uuid E pertencer ao usuário — a segunda
  // parte sai de graça, porque `cadernos` já veio filtrado pela RLS. Sem esse
  // cruzamento, um id de outra pessoa passaria adiante e produziria uma árvore
  // vazia com aparência de caderno legítimo.
  const cadernoDaUrl = sp.caderno && UUID_RE.test(sp.caderno) ? sp.caderno : null;
  const cadernoAtivo =
    (cadernoDaUrl && cadernos.some((c) => c.id === cadernoDaUrl) ? cadernoDaUrl : null) ??
    cadernos[0]?.id ??
    null;

  const termo = (sp.q ?? "").trim();

  // As duas leituras não dependem uma da outra: em paralelo, não em série.
  const [paginas, resultados] = await Promise.all([
    cadernoAtivo ? getNotebookPages(cadernoAtivo) : Promise.resolve([]),
    /**
     * Busca em TODOS os cadernos, e não só no aberto.
     *
     * Quem busca costuma não lembrar em qual caderno guardou — é justamente por
     * isso que está buscando. Restringir ao caderno atual devolveria "nada
     * encontrado" para uma página que existe, que é o pior resultado possível de
     * uma busca. O caderno de cada acerto vai escrito na linha do resultado.
     *
     * Termo vazio nem chega ao banco — ver `searchKnowledge`.
     */
    searchKnowledge(termo, null),
  ]);

  const nomeDoCaderno = new Map(cadernos.map((c) => [c.id, c.name]));

  // `updated_at` desce; a lista veio ordenada por `position`, que é outra coisa.
  // `slice` antes do `sort` não serve: ordenar depois de cortar ordena o pedaço
  // errado.
  const recentes = [...paginas]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, RECENTES);

  return (
    <>
      <PageHeader
        eyebrow="Conhecimento"
        title="O que você aprendeu, escrito."
        subtitle="Cadernos, páginas aninhadas e busca no texto inteiro."
        user={{ name: ctx.displayName, avatarUrl: ctx.avatarUrl }}
        /*
          A busca subiu para o cabeçalho. Antes ficava aqui embaixo, e o
          `PageHeader` desenhava logo acima dela um campo decorativo idêntico
          que não fazia nada — duas barras de busca a um dedo de distância, uma
          funcionando e outra não.

          Continua sendo o MESMO componente e o mesmo mecanismo: o termo vai
          para o `?q=` da URL e quem busca é `searchKnowledge` no servidor. Só o
          lugar na tela mudou.

          Fica FORA do `cadernos.length === 0`: sem caderno não há o que buscar,
          e um campo de busca ao lado de "Nenhum caderno ainda" convidaria a
          procurar o que se sabe não existir.
        */
        busca={
          cadernos.length > 0 ? (
            <KnowledgeSearch
              termo={termo}
              cadernoAtivoId={cadernoAtivo}
              // `null` quando não há termo: é o que separa "ainda não busquei"
              // de "busquei e não achei". Mostrar "nenhum resultado" para quem
              // nem digitou é o erro clássico deste tipo de tela.
              total={termo.length > 0 ? resultados.length : null}
            />
          ) : undefined
        }
      />

      {cadernos.length === 0 ? (
        <EmptyState
          icon="Book"
          title="Nenhum caderno ainda"
          description="Um caderno guarda páginas, e as páginas podem ter subpáginas. Comece por um."
          action={<NovoCadernoBotao variante="primary" />}
        />
      ) : (
        <div className="grid gap-8 md:grid-cols-[260px_1fr]">
          <KnowledgeSidebar
            cadernos={cadernos}
            cadernoAtivoId={cadernoAtivo}
            paginas={paginas}
            paginaAtivaId={null}
          />

          <section className="min-w-0 space-y-4">
            {termo.length > 0 ? (
              resultados.length === 0 ? (
                <EmptyState
                  icon="Search"
                  title={`Nenhum resultado para “${termo}”`}
                  description="A busca procura no texto inteiro das páginas, com as palavras do português. Tente outro termo."
                />
              ) : (
                <ul className="divide-y divide-line rounded-md border border-line bg-surface">
                  {resultados.map((hit) => (
                    /*
                      ENTRADA DE ITEM DE LISTA — custo zero de re-render.

                      `animate-list-in` é uma classe CSS num componente de
                      servidor: não há estado, efeito, biblioteca nem um único
                      byte de JavaScript no cliente por causa dela.

                      A animação dispara na MONTAGEM do nó. Como a chave é
                      `hit.id`, trocar o termo de busca produz chaves novas, o
                      React monta <li> novos e cada um entra. Se um resultado se
                      repete entre duas buscas, o React reaproveita o mesmo nó e
                      ele NÃO reanima — que é exatamente o certo: o que já estava
                      na tela não deve piscar.

                      Sem escalonamento (`animation-delay`). O motivo está em
                      tailwind.config.ts: atraso sobrevive ao
                      `prefers-reduced-motion` e viraria falha de acessibilidade.
                    */
                    <li key={hit.id} className="animate-list-in">
                      <Link
                        href={`/conhecimento/pagina/${hit.id}`}
                        className="flex items-start gap-3 px-4 py-3 hover:bg-surface-muted"
                      >
                        <Icon.File
                          width={15}
                          height={15}
                          aria-hidden="true"
                          className="mt-0.5 shrink-0 text-ink-subtle"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-legenda text-ink">
                            <TituloComDestaque texto={rotuloDaPagina(hit.title)} termo={termo} />
                          </span>
                          {/* Caderno + data em vez de um trecho do texto: o
                              trecho exigiria trazer `content_text` inteiro de
                              cada acerto (uma página longa são dezenas de KB, e
                              são até 30 acertos) ou uma função `ts_headline` no
                              banco, que é migration nova. O caderno é o que
                              responde "é esta mesmo?" quando dois títulos se
                              parecem. */}
                          <span className="mt-0.5 block text-legenda text-ink-subtle">
                            {nomeDoCaderno.get(hit.notebook_id) ?? "Caderno"} ·{" "}
                            {formatDayLabel(hit.updated_at)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )
            ) : recentes.length === 0 ? (
              <EmptyState
                icon="File"
                title="Caderno vazio"
                description="Use “Nova página” na barra lateral para escrever a primeira."
              />
            ) : (
              <div>
                <h2 className="eyebrow mb-2">Editadas recentemente</h2>
                <ul className="divide-y divide-line rounded-md border border-line bg-surface">
                  {recentes.map((pagina) => (
                    <li key={pagina.id} className="animate-list-in">
                      <Link
                        href={`/conhecimento/pagina/${pagina.id}`}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted"
                      >
                        <Icon.File
                          width={15}
                          height={15}
                          aria-hidden="true"
                          className="shrink-0 text-ink-subtle"
                        />
                        <span className="min-w-0 flex-1 truncate text-legenda text-ink">
                          {rotuloDaPagina(pagina.title)}
                        </span>
                        <span className="shrink-0 text-legenda text-ink-subtle">
                          {formatDayLabel(pagina.updated_at)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
