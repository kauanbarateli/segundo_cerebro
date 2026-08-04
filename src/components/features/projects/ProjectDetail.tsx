import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icons";
import type { ConteudoDoProjeto } from "@/lib/data";
import type { Project } from "@/lib/database.types";
import { rotuloDaPagina } from "@/lib/knowledge";
import { formatDayLabel, formatTime } from "@/lib/utils";

/**
 * A tela de um projeto.
 *
 * ============================================================================
 * ⚠️ AS PÁGINAS E OS ARQUIVOS NÃO TÊM `project_id` — E APARECEM MESMO ASSIM
 * ============================================================================
 * É o pagamento da decisão de pôr a coluna no CONTÊINER. "O conhecimento do
 * projeto" são as páginas dos CADERNOS do projeto; os arquivos, o conteúdo das
 * PASTAS do projeto. Sem coluna nova em `knowledge_pages`, sem trigger de
 * árvore, sem CTE recursiva — e `createPage`, `movePage`, `registerFile` e
 * `moveFile` não mudaram uma linha.
 *
 * ============================================================================
 * ⚠️ CAPTURAS E TAREFAS EM SEÇÕES SEPARADAS, DE PROPÓSITO
 * ============================================================================
 * A regra de desempate da 0017: o projeto de uma captura é `captures.project_id`
 * e só ele; vínculo da 0009 nunca implica pertencimento a projeto.
 *
 * A conversão copia o projeto no t0 e não define nada para o t1 — mover a
 * tarefa para outro projeto deixa a captura no antigo. Com as duas em seções
 * separadas, essa divergência fica VISÍVEL em vez de silenciosa: dá para ver a
 * captura aqui e a tarefa em outro projeto, e decidir.
 *
 * ============================================================================
 * A AGENDA SAI DAS TAREFAS, NÃO DOS VÍNCULOS
 * ============================================================================
 * O cabeçalho da 0009 define vínculo como PROCEDÊNCIA. Derivar a agenda dele
 * transformaria procedência em pertencimento: a 1:1 semanal ligada a tarefas de
 * três projetos apareceria nas três agendas.
 */
export function ProjectDetail({
  projeto,
  conteudo,
}: {
  projeto: Project;
  conteudo: ConteudoDoProjeto;
}) {
  const { tarefas, capturas, cadernos, paginas, pastas } = conteudo;

  const abertas = tarefas.filter((t) => t.status !== "done");
  const concluidas = tarefas.length - abertas.length;

  // A agenda: as tarefas COM data, em ordem. É o que responde "o que vem
  // primeiro neste projeto".
  const agenda = tarefas
    .filter((t) => (t.due_at ?? t.scheduled_start_at) != null)
    .sort((a, b) => {
      const qa = a.due_at ?? a.scheduled_start_at ?? "";
      const qb = b.due_at ?? b.scheduled_start_at ?? "";
      return qa.localeCompare(qb);
    })
    .slice(0, 10);

  const vazio =
    tarefas.length === 0 && capturas.length === 0 && cadernos.length === 0 && pastas.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Badge>{abertas.length} abertas</Badge>
        {concluidas > 0 && <Badge tone="outline">{concluidas} concluídas</Badge>}
        {capturas.length > 0 && <Badge tone="outline">{capturas.length} capturas</Badge>}
        {cadernos.length > 0 && <Badge tone="outline">{cadernos.length} cadernos</Badge>}
        {pastas.length > 0 && <Badge tone="outline">{pastas.length} pastas</Badge>}
      </div>

      {vazio && (
        <Card className="p-5">
          <p className="text-corpo text-ink-muted">
            Nada neste projeto ainda. Atribua o projeto ao criar ou editar uma tarefa, uma captura,
            um caderno ou uma pasta — nada é duplicado, só agrupado.
          </p>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Secao titulo="Tarefas" vazio="Nenhuma tarefa neste projeto." href="/tarefas">
            {abertas.length > 0 && (
              <ul className="divide-y divide-line">
                {abertas.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.title}</span>
                    <span className="shrink-0 text-legenda text-ink-subtle">
                      {formatDayLabel(t.due_at ?? t.scheduled_start_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Secao>

          <Secao titulo="Capturas" vazio="Nenhuma captura neste projeto." href="/capturar">
            {capturas.length > 0 && (
              <ul className="divide-y divide-line">
                {capturas.map((c) => (
                  <li key={c.id} className="px-4 py-3">
                    <p className="truncate text-sm text-ink">
                      {c.title ?? c.content?.slice(0, 80) ?? "(sem título)"}
                    </p>
                    {c.converted_task_id && (
                      /* O selo torna VISÍVEL a divergência que a regra de
                         desempate aceita: esta captura virou tarefa, e a tarefa
                         pode ter sido movida para outro projeto desde então. */
                      <p className="mt-0.5 text-legenda text-ink-subtle">já virou tarefa</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Secao>

          <Secao
            titulo="Conhecimento"
            vazio="Nenhum caderno neste projeto."
            href="/conhecimento"
            nota={
              cadernos.length > 0
                ? `${paginas.length} páginas nos cadernos deste projeto`
                : undefined
            }
          >
            {paginas.length > 0 && (
              <ul className="divide-y divide-line">
                {paginas.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/conhecimento/pagina/${p.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted"
                    >
                      <Icon.File width={14} height={14} className="shrink-0 text-ink-subtle" />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">
                        {rotuloDaPagina(p.title)}
                      </span>
                      <span className="shrink-0 text-legenda text-ink-subtle">
                        {formatDayLabel(p.updated_at)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Secao>

          <Secao titulo="Pastas" vazio="Nenhuma pasta neste projeto." href="/drive">
            {pastas.length > 0 && (
              <ul className="divide-y divide-line">
                {pastas.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 px-4 py-3">
                    <Icon.Folder width={14} height={14} className="shrink-0 text-ink-subtle" />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{f.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </Secao>
        </div>

        <aside>
          <Card className="p-5">
            <p className="eyebrow mb-3">Agenda</p>
            {agenda.length === 0 ? (
              <p className="text-corpo text-ink-subtle">
                Nenhuma tarefa deste projeto tem data.
              </p>
            ) : (
              <ul className="space-y-2.5">
                {agenda.map((t) => {
                  const quando = t.due_at ?? t.scheduled_start_at;
                  return (
                    <li key={t.id} className="flex items-start gap-2.5">
                      <Icon.Clock width={13} height={13} className="mt-1 shrink-0 text-ink-subtle" />
                      <div className="min-w-0">
                        <p className="truncate text-corpo text-ink">{t.title}</p>
                        <p className="text-legenda text-ink-subtle">
                          {formatDayLabel(quando)}
                          {quando && !t.all_day && ` · ${formatTime(quando)}`}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-legenda text-ink-subtle">
              Sai das datas das tarefas, não dos vínculos com eventos — vínculo diz de onde a
              tarefa veio, não a que projeto o evento pertence.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Secao({
  titulo,
  vazio,
  href,
  nota,
  children,
}: {
  titulo: string;
  vazio: string;
  href: string;
  nota?: string;
  children: ReactNode;
}) {
  const temConteudo = Boolean(children);
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">{titulo}</h2>
        <Link href={href} className="text-corpo text-ink-muted hover:text-ink">
          Abrir módulo
        </Link>
      </div>
      {nota && <p className="mb-2 text-legenda text-ink-subtle">{nota}</p>}
      <Card className="overflow-hidden">
        {temConteudo ? children : <p className="px-4 py-5 text-corpo text-ink-subtle">{vazio}</p>}
      </Card>
    </section>
  );
}
