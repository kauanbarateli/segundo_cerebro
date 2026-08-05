"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { Icon } from "@/components/ui/Icons";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { CriarNoProjeto } from "@/components/features/projects/CriarNoProjeto";
import { VincularExistente } from "@/components/features/projects/VincularExistente";
import { ANEXAVEL, type TipoAnexavel } from "@/components/features/projects/anexaveis";
import { desvincularDoProjeto } from "@/app/(app)/projetos/actions";
import type { ConteudoDoProjeto } from "@/lib/data";
import type { Category, Project } from "@/lib/database.types";
import { rotuloDaPagina } from "@/lib/knowledge";
import { formatDayLabel, formatTime } from "@/lib/utils";

/**
 * A tela de um projeto.
 *
 * ============================================================================
 * ⚠️ ANEXAR AQUI NÃO DUPLICA NADA — é o ponto inteiro desta tela
 * ============================================================================
 * Cada seção tem duas portas, e as duas terminam na MESMA coluna:
 *
 *   "Criar aqui"          abre o formulário do módulo de origem com o projeto
 *                         já preenchido. Quem insere continua sendo `createTask`,
 *                         `createCapture`, `createNotebook`, `createFolder`.
 *   "Vincular existente"  marca itens que JÁ EXISTEM e grava `project_id` neles.
 *                         É um `update`; nenhuma linha é criada, copiada ou
 *                         movida de tabela.
 *
 * Por isso o botão diz VINCULAR e não "adicionar": a tarefa vinculada continua
 * a mesma tarefa, com o mesmo id, na mesma lista de Tarefas de sempre. Ela
 * apenas passa a ser vista também daqui. Desvincular é `project_id = null` e não
 * apaga coisa nenhuma.
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
 * CONSEQUÊNCIA DIRETA NA INTERFACE, e é por isso que a seção Conhecimento tem
 * duas listas: a de CADERNOS, que é onde os botões de vincular e desvincular
 * vivem, e a de PÁGINAS, que é só leitura. Uma página não pode ser desvinculada
 * porque ela nunca foi vinculada — ela vem junto com o caderno. Oferecer um "x"
 * ao lado dela prometeria uma operação que o modelo não tem.
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
  categorias,
  projetos,
}: {
  projeto: Project;
  conteudo: ConteudoDoProjeto;
  /** Para o formulário de tarefa do "Criar aqui" — ver `CriarNoProjeto`. */
  categorias: Category[];
  /** Os projetos vivos, para o seletor dentro daquele formulário. */
  projetos: Project[];
}) {
  const { tarefas, capturas, cadernos, paginas, pastas } = conteudo;
  const { toast } = useToast();
  const [, iniciar] = useTransition();

  const [criando, setCriando] = useState<TipoAnexavel | null>(null);
  const [vinculando, setVinculando] = useState<TipoAnexavel | null>(null);
  /* O alvo do desvínculo carrega o RÓTULO junto, e não só o id: a confirmação
     precisa dizer o nome da coisa, e depois de o item sair da lista revalidada
     não haveria onde reencontrá-lo para montar a frase. */
  const [desvinculando, setDesvinculando] = useState<{
    tipo: TipoAnexavel;
    id: string;
    rotulo: string;
  } | null>(null);

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

  function confirmarDesvinculo() {
    const alvo = desvinculando;
    setDesvinculando(null);
    if (!alvo) return;
    iniciar(async () => {
      const r = await desvincularDoProjeto({
        tipo: alvo.tipo,
        id: alvo.id,
        projectId: projeto.id,
      });
      toast(r.ok ? "Desvinculado do projeto" : (r.error ?? "Erro"), r.ok ? "success" : "error");
    });
  }

  const defDoDesvinculo = desvinculando ? ANEXAVEL[desvinculando.tipo] : null;

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
            Nada neste projeto ainda. Use <strong className="font-medium text-ink">Criar aqui</strong>{" "}
            para começar algo já dentro dele, ou{" "}
            <strong className="font-medium text-ink">Vincular existente</strong> para trazer o que já
            existe. Vincular não copia nada: o item continua no módulo de origem e passa a aparecer
            também aqui.
          </p>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Secao
            tipo="tarefa"
            aoCriar={() => setCriando("tarefa")}
            aoVincular={() => setVinculando("tarefa")}
          >
            {abertas.length > 0 && (
              <ul className="divide-y divide-line">
                {abertas.map((t) => (
                  <LinhaVinculada
                    key={t.id}
                    rotulo={t.title}
                    tipo="tarefa"
                    aoDesvincular={() =>
                      setDesvinculando({ tipo: "tarefa", id: t.id, rotulo: t.title })
                    }
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.title}</span>
                    <span className="shrink-0 text-legenda text-ink-subtle">
                      {formatDayLabel(t.due_at ?? t.scheduled_start_at)}
                    </span>
                  </LinhaVinculada>
                ))}
              </ul>
            )}
          </Secao>

          <Secao
            tipo="captura"
            aoCriar={() => setCriando("captura")}
            aoVincular={() => setVinculando("captura")}
          >
            {capturas.length > 0 && (
              <ul className="divide-y divide-line">
                {capturas.map((c) => {
                  const rotulo = c.title ?? c.content?.slice(0, 80) ?? "(sem título)";
                  return (
                    <LinhaVinculada
                      key={c.id}
                      rotulo={rotulo}
                      tipo="captura"
                      aoDesvincular={() =>
                        setDesvinculando({ tipo: "captura", id: c.id, rotulo })
                      }
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink">{rotulo}</p>
                        {c.converted_task_id && (
                          /* O selo torna VISÍVEL a divergência que a regra de
                             desempate aceita: esta captura virou tarefa, e a
                             tarefa pode ter sido movida para outro projeto
                             desde então. */
                          <p className="mt-0.5 text-legenda text-ink-subtle">já virou tarefa</p>
                        )}
                      </div>
                    </LinhaVinculada>
                  );
                })}
              </ul>
            )}
          </Secao>

          <Secao
            tipo="caderno"
            aoCriar={() => setCriando("caderno")}
            aoVincular={() => setVinculando("caderno")}
            nota={
              cadernos.length > 0
                ? `${paginas.length} páginas nos cadernos deste projeto — elas vêm junto com o caderno, uma a uma não se vincula.`
                : undefined
            }
          >
            {cadernos.length > 0 && (
              <ul className="divide-y divide-line">
                {cadernos.map((c) => (
                  <LinhaVinculada
                    key={c.id}
                    rotulo={c.name}
                    tipo="caderno"
                    aoDesvincular={() =>
                      setDesvinculando({ tipo: "caderno", id: c.id, rotulo: c.name })
                    }
                  >
                    <Icon.Book width={14} height={14} className="shrink-0 text-ink-subtle" />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.name}</span>
                  </LinhaVinculada>
                ))}
              </ul>
            )}
          </Secao>

          {/* As páginas ficam FORA da seção de cadernos, num bloco só de
              leitura: elas não têm `project_id` e portanto não têm o que
              desvincular. Ver o cabeçalho. */}
          {paginas.length > 0 && (
            <section>
              <p className="eyebrow mb-2">Páginas destes cadernos</p>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-line">
                  {paginas.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/conhecimento/pagina/${p.id}`}
                        className="flex min-h-11 items-center gap-3 px-4 py-3 hover:bg-surface-muted"
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
              </Card>
            </section>
          )}

          <Secao
            tipo="pasta"
            aoCriar={() => setCriando("pasta")}
            aoVincular={() => setVinculando("pasta")}
          >
            {pastas.length > 0 && (
              <ul className="divide-y divide-line">
                {pastas.map((f) => (
                  <LinhaVinculada
                    key={f.id}
                    rotulo={f.name}
                    tipo="pasta"
                    aoDesvincular={() =>
                      setDesvinculando({ tipo: "pasta", id: f.id, rotulo: f.name })
                    }
                  >
                    <Icon.Folder width={14} height={14} className="shrink-0 text-ink-subtle" />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{f.name}</span>
                  </LinhaVinculada>
                ))}
              </ul>
            )}
          </Secao>
        </div>

        <aside>
          <Card className="p-5">
            <p className="eyebrow mb-3">Agenda</p>
            {agenda.length === 0 ? (
              <p className="text-corpo text-ink-subtle">Nenhuma tarefa deste projeto tem data.</p>
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
              Sai das datas das tarefas, não dos vínculos com eventos — vínculo diz de onde a tarefa
              veio, não a que projeto o evento pertence.
            </p>
          </Card>
        </aside>
      </div>

      {criando && (
        <Modal
          title={`${ANEXAVEL[criando].rotuloDeCriar} em «${projeto.name}»`}
          onClose={() => setCriando(null)}
        >
          <CriarNoProjeto
            tipo={criando}
            projectId={projeto.id}
            nomeDoProjeto={projeto.name}
            categorias={categorias}
            projetos={projetos}
            onDone={() => setCriando(null)}
            onCancel={() => setCriando(null)}
          />
        </Modal>
      )}

      {vinculando && (
        <Modal
          title={`Vincular ${ANEXAVEL[vinculando].plural} a «${projeto.name}»`}
          onClose={() => setVinculando(null)}
        >
          <VincularExistente
            projectId={projeto.id}
            nomeDoProjeto={projeto.name}
            tipo={vinculando}
            onDone={() => setVinculando(null)}
            onCancel={() => setVinculando(null)}
          />
        </Modal>
      )}

      <ConfirmationDialog
        open={desvinculando !== null}
        title="Desvincular do projeto"
        /*
          A frase diz o que REALMENTE acontece, e `destructive` fica de fora de
          propósito: neste app vermelho significa ERRO ou perda de dado, e aqui
          não há perda nenhuma. Desvincular grava `null` numa coluna; o item
          continua inteiro no módulo dele. Pintar o botão de vermelho ensinaria
          a pessoa a hesitar diante de uma operação inofensiva — e, pior,
          rebaixaria o vermelho das operações que realmente apagam.
        */
        description={
          desvinculando && defDoDesvinculo
            ? `"${desvinculando.rotulo}" sai deste projeto e continua em ${defDoDesvinculo.modulo}. Nada é apagado — o vínculo é uma coluna no próprio item, não uma cópia.`
            : undefined
        }
        confirmLabel="Desvincular"
        onCancel={() => setDesvinculando(null)}
        onConfirm={confirmarDesvinculo}
      />
    </div>
  );
}

/**
 * Uma seção da tela: título, as duas portas de entrada e a lista.
 *
 * As portas ficam no CABEÇALHO da seção, e não dentro do cartão, porque elas
 * pertencem à seção inteira — inclusive quando ela está vazia, que é
 * exatamente quando alguém mais precisa delas. Um botão que só aparece quando
 * já existe conteúdo obriga a ir ao módulo para criar o primeiro item.
 */
function Secao({
  tipo,
  nota,
  aoCriar,
  aoVincular,
  children,
}: {
  tipo: TipoAnexavel;
  nota?: string;
  aoCriar: () => void;
  aoVincular: () => void;
  children: ReactNode;
}) {
  const def = ANEXAVEL[tipo];
  const temConteudo = Boolean(children);

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">{def.tituloDaSecao}</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="secondary" size="sm" onClick={aoCriar}>
            <Icon.Capture width={14} height={14} aria-hidden />
            Criar aqui
          </Button>
          {/* "Vincular" e não "Adicionar": o item já existe e continua existindo
              uma vez só. Ver `anexaveis.tsx`. */}
          <Button variant="ghost" size="sm" onClick={aoVincular}>
            <Icon.Link width={14} height={14} aria-hidden />
            Vincular existente
          </Button>
          <Link
            href={def.rotaDoModulo}
            className="rounded-sm px-2 py-1 text-corpo text-ink-muted hover:text-ink focus-visible:outline-2"
          >
            Abrir módulo
          </Link>
        </div>
      </div>
      {nota && <p className="mb-2 text-legenda text-ink-subtle">{nota}</p>}
      <Card className="overflow-hidden">
        {temConteudo ? children : <p className="px-4 py-5 text-corpo text-ink-subtle">{def.vazio}</p>}
      </Card>
    </section>
  );
}

/**
 * Uma linha da lista, com o botão de desvincular à direita.
 *
 * O botão é só ícone, então ele carrega `aria-label` com o nome do item —
 * "Desvincular" sozinho, repetido dez vezes, não diz ao leitor de tela qual das
 * dez tarefas ele vai tirar. E tem 44×44 de área de toque mesmo com o ícone de
 * 15px: um alvo do tamanho do desenho erra o dedo, e errar aqui abre um diálogo
 * que ninguém pediu.
 *
 * O "x" não é vermelho. Ver o comentário do `ConfirmationDialog` lá em cima.
 */
function LinhaVinculada({
  rotulo,
  tipo,
  aoDesvincular,
  children,
}: {
  rotulo: string;
  tipo: TipoAnexavel;
  aoDesvincular: () => void;
  children: ReactNode;
}) {
  return (
    <li className="flex items-center gap-2 py-0.5 pl-4 pr-1">
      <div className="flex min-w-0 flex-1 items-center gap-3 py-2">{children}</div>
      <button
        type="button"
        onClick={aoDesvincular}
        aria-label={`Desvincular ${ANEXAVEL[tipo].singular} "${rotulo}" deste projeto`}
        title="Desvincular deste projeto"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-2"
      >
        <Icon.X width={15} height={15} aria-hidden />
      </button>
    </li>
  );
}
