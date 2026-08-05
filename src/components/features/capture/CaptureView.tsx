"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Badge, PillButton } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/ui/Toast";
import { LinkCountBadge } from "@/components/features/links/LinkCountBadge";
import { RelatedSection } from "@/components/features/links/RelatedSection";
import type { Capture, CaptureType, Category, Project } from "@/lib/database.types";
import type { RelatedItem } from "@/lib/links";
import { formatDayLabel } from "@/lib/utils";
import {
  apagarRascunho,
  gravarRascunho,
  lerRascunho,
  limparResiduoLegado,
} from "@/lib/capture-draft";
import {
  archiveCapture,
  convertCaptureToTask,
  createCapture,
  deleteCapturePermanently,
  updateCapture,
} from "@/app/(app)/capturar/actions";

const TYPES: { value: CaptureType; label: string }[] = [
  { value: "idea", label: "Ideia" },
  { value: "task", label: "Tarefa" },
  { value: "note", label: "Nota" },
  { value: "reminder", label: "Lembrete" },
];

function typeLabel(type: CaptureType): string {
  return TYPES.find((t) => t.value === type)?.label ?? type;
}

interface Draft {
  type: CaptureType;
  title: string;
  content: string;
  categoryId: string;
  /** "" = sem projeto. Ver `projectIdOpcional` em validation.ts. */
  projectId: string;
}

const emptyDraft: Draft = { type: "idea", title: "", content: "", categoryId: "", projectId: "" };

export function CaptureView({
  captures,
  categories,
  related,
  linkCandidates,
  projetos = [],
  userId,
}: {
  captures: Capture[];
  categories: Category[];
  /** Vínculos de todas as capturas, em lote (ver getRelatedItems). */
  related: Map<string, RelatedItem[]>;
  /** Tarefas e eventos oferecidos no autocomplete. */
  linkCandidates: RelatedItem[];
  /** Projetos vivos, para os seletores. Vazio some com os campos. */
  projetos?: Project[];
  /**
   * Dono da sessão. Entra só para compor a chave do rascunho — ver
   * `src/lib/capture-draft.ts`. Sem ele a chave é global e o rascunho de uma
   * conta aparece no compositor da outra.
   */
  userId: string;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [restored, setRestored] = useState(false);
  const [pending, start] = useTransition();
  const [typeFilter, setTypeFilter] = useState<CaptureType | "all">("all");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Só o ID da captura aberta mora no estado. O objeto é derivado da prop a
  // cada render (ver `selected` abaixo) porque `captures` vem do servidor e é
  // reconstruída pelo revalidatePath depois de cada mutação: copiar o objeto
  // para o estado congelaria o modal na versão antiga do texto logo após salvar.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // `edit` é nulo em modo leitura e vira o rascunho da captura aberta em modo
  // edição — o mesmo formato do compositor da esquerda, de propósito: os dois
  // mandam os mesmos quatro campos para as actions.
  const [edit, setEdit] = useState<Draft | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();
  const editButtonRef = useRef<HTMLButtonElement>(null);

  // Restaura o rascunho em andamento para que um F5 nunca perca texto digitado.
  //
  // A leitura acontece DEPOIS da varredura de resíduo, e a ordem importa: a
  // varredura apaga a chave global da versão antiga, então ler antes dela
  // ressuscitaria em `sessionStorage` o rascunho que se está tentando eliminar
  // de `localStorage`.
  useEffect(() => {
    limparResiduoLegado();
    const raw = lerRascunho(userId);
    if (raw) {
      try {
        setDraft({ ...emptyDraft, ...(JSON.parse(raw) as Partial<Draft>) });
      } catch {
        /* rascunho corrompido: começa vazio em vez de derrubar a tela */
      }
    }
    setRestored(true);
  }, [userId]);

  // Autosave com atraso.
  useEffect(() => {
    if (!restored) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (draft.title || draft.content) {
        gravarRascunho(userId, JSON.stringify(draft));
      } else {
        apagarRascunho(userId);
      }
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [draft, restored, userId]);

  function submit() {
    start(async () => {
      const r = await createCapture({
        type: draft.type,
        title: draft.title || undefined,
        content: draft.content || undefined,
        categoryId: draft.categoryId || undefined,
        projectId: draft.projectId || undefined,
      });
      if (r.ok) {
        toast("Enviado ao cérebro", "success");
        setDraft({ ...emptyDraft, type: draft.type });
        apagarRascunho(userId);
      } else {
        toast(r.error ?? "Erro", "error");
      }
    });
  }

  const visible =
    typeFilter === "all" ? captures : captures.filter((c) => c.type === typeFilter);

  // Buscar por ID a cada render é o que fecha o modal sozinho: arquivar ou
  // excluir tira a linha de `captures`, `selected` vira null e o diálogo
  // simplesmente deixa de ser renderizado — sem efeito, sem estado espelhado.
  const selected = captures.find((c) => c.id === selectedId) ?? null;
  const selectedCategory = categories.find((c) => c.id === selected?.category_id)?.name ?? null;
  // A navegação segue a lista FILTRADA e na ordem exibida, senão a seta levaria
  // para uma nota que não está na tela. Pode dar -1 quando a edição troca o tipo
  // da captura com um filtro ativo: aí a nota continua aberta (acabou de ser
  // salva, fechá-la seria hostil), só sem vizinhos para onde ir.
  const selectedIndex = selected ? visible.findIndex((c) => c.id === selected.id) : -1;
  // "Sujo" é comparado contra a prop, não contra um snapshot: se o texto voltou
  // a ser igual ao salvo, não há o que perder e a seta pode navegar.
  const dirty =
    edit !== null &&
    selected !== null &&
    (edit.type !== selected.type ||
      edit.title !== (selected.title ?? "") ||
      edit.content !== (selected.content ?? "") ||
      edit.categoryId !== (selected.category_id ?? ""));

  const isEditing = edit !== null;
  useEffect(() => {
    // Sair do modo de edição desmonta "Salvar"/"Cancelar" e o foco cai no
    // <body>, que a armadilha do modal considera fora do painel — o Tab
    // seguinte jogaria a pessoa para o começo do diálogo. Devolver o foco ao
    // "Editar" mantém o lugar. Só dispara na virada de edição para leitura;
    // abrir o modal não mexe em `isEditing`, então não briga com o foco inicial.
    if (!isEditing) editButtonRef.current?.focus();
  }, [isEditing]);

  function openCapture(id: string) {
    // Abrir sempre começa em leitura: `edit` pode ter sobrado de uma captura que
    // sumiu da lista enquanto o modal estava aberto, e reaproveitá-lo mostraria
    // o texto da nota errada dentro dos campos.
    setEdit(null);
    setConfirmOpen(false);
    setSelectedId(id);
  }

  function closeDetail() {
    setSelectedId(null);
    setEdit(null);
    setConfirmOpen(false);
  }

  function goTo(delta: number) {
    // Alteração pendente é motivo para ignorar a seta: trocar de nota agora
    // descartaria texto digitado sem nenhum aviso. Sem alteração, navegar sai do
    // modo de edição — o rascunho aberto é o da nota anterior.
    if (dirty || selectedIndex < 0) return;
    const next = visible[selectedIndex + delta];
    if (!next) return;
    setEdit(null);
    setSelectedId(next.id);
  }

  function startEdit() {
    if (!selected) return;
    setEdit({
      type: selected.type,
      title: selected.title ?? "",
      content: selected.content ?? "",
      categoryId: selected.category_id ?? "",
      projectId: selected.project_id ?? "",
    });
  }

  function saveEdit() {
    if (!selected || !edit) return;
    startSave(async () => {
      const r = await updateCapture({
        id: selected.id,
        type: edit.type,
        title: edit.title || undefined,
        content: edit.content || undefined,
        // ARMADILHA: omitir categoryId não significa "mantenha a categoria". O
        // schema transforma ausente em null e o UPDATE grava null, ou seja, não
        // mandar o campo APAGA a categoria da captura. Por isso o select existe
        // neste formulário: o valor atual viaja de volta em toda edição.
        categoryId: edit.categoryId || undefined,
        // Mesma armadilha do campo acima: nao mandar APAGA a atribuicao.
        projectId: edit.projectId || undefined,
      });
      if (r.ok) {
        // Volta para leitura sem mexer em `selectedId`: o revalidatePath da
        // action traz a captura já atualizada e o modal se redesenha sozinho.
        setEdit(null);
        toast("Captura atualizada", "success");
      } else {
        toast(r.error ?? "Erro", "error");
      }
    });
  }

  function removeCapture() {
    if (!selected) return;
    const id = selected.id;
    // Fecha a confirmação antes de disparar: o ConfirmationDialog não tem estado
    // de "enviando", e deixá-lo na tela convidaria a um segundo clique que viraria
    // um segundo DELETE — o segundo voltaria "Captura não encontrada." na cara do
    // usuário depois de a exclusão ter dado certo.
    setConfirmOpen(false);
    startDelete(async () => {
      const r = await deleteCapturePermanently(id);
      if (r.ok) {
        closeDetail();
        toast("Captura excluída", "success");
      } else {
        // Erro mantém o detalhe aberto: a nota ainda existe e a pessoa precisa
        // ver onde estava para decidir o que fazer.
        toast(r.error ?? "Erro", "error");
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      {/* Composer */}
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {TYPES.map((t) => (
              <PillButton
                key={t.value}
                active={draft.type === t.value}
                onClick={() => setDraft((d) => ({ ...d, type: t.value }))}
              >
                {t.label}
              </PillButton>
            ))}
          </div>
          <span className="text-legenda text-ink-subtle">Salvo automaticamente</span>
        </div>

        <input
          aria-label="Título (opcional)"
          placeholder="Título (opcional)"
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          className="mb-3 h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline-2"
        />

        <textarea
          aria-label="Conteúdo"
          placeholder="Comece a escrever. Você organiza depois…"
          value={draft.content}
          onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
          rows={10}
          className="w-full resize-none rounded-md border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline-2"
        />

        {/*
          `flex-wrap` na linha de fora, e não só no grupo de dentro.

          O grupo dos seletores já quebrava sozinho, mas a linha não: os dois
          `<select>` pedem ~270px e o "Enviar ao cérebro" outros ~160, contra os
          295px que o cartão tem em 375px. Sem `flex-wrap` aqui o botão não
          descia, ele ENCOLHIA — o rótulo quebrava em duas linhas dentro de uma
          caixa de 40px de altura e vazava por baixo da borda.
        */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Categoria"
              value={draft.categoryId}
              onChange={(e) => setDraft((d) => ({ ...d, categoryId: e.target.value }))}
              className="h-10 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2"
            >
              <option value="">Sem categoria</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {/* Some quando nao ha projeto nenhum: um seletor de uma opcao so e
                uma pergunta cuja resposta ja se sabe, e a caixa de captura e
                justamente onde nao se quer parar para responder nada. */}
            {projetos.length > 0 && (
              <select
                aria-label="Projeto"
                value={draft.projectId}
                onChange={(e) => setDraft((d) => ({ ...d, projectId: e.target.value }))}
                className="h-10 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2"
              >
                <option value="">Sem projeto</option>
                {projetos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <Button variant="primary" onClick={submit} disabled={pending}>
            {pending ? "Enviando…" : "Enviar ao cérebro"}
          </Button>
        </div>
      </Card>

      {/* Inbox */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <p className="eyebrow">Sem organizar</p>
            <p className="text-sm font-semibold text-ink">Caixa de entrada</p>
          </div>
          <Badge>{captures.length} itens</Badge>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5">
          <PillButton active={typeFilter === "all"} onClick={() => setTypeFilter("all")}>
            Todos
          </PillButton>
          {TYPES.map((t) => (
            <PillButton
              key={t.value}
              active={typeFilter === t.value}
              onClick={() => setTypeFilter(t.value)}
            >
              {t.label}
            </PillButton>
          ))}
        </div>

        {visible.length === 0 ? (
          <EmptyState icon="Inbox" title="Caixa vazia" description="Nada para organizar por aqui." />
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((c) => (
              <li key={c.id} className="px-4 py-3.5 transition-colors hover:bg-surface-muted">
                {/*
                  Só o bloco de texto é botão. Envolver o <li> inteiro aninharia
                  "Organizar → tarefa" e "Arquivar" dentro de outro botão: HTML
                  inválido, aviso do React e clique ambíguo. Os filhos aqui são
                  <span> em vez de <p>/<div> pelo mesmo motivo de validade — o
                  conteúdo permitido de <button> é conteúdo de frase — e desenham
                  igual com display block/flex.
                */}
                <button
                  type="button"
                  onClick={() => openCapture(c.id)}
                  className="w-full rounded-sm text-left focus-visible:outline-2"
                >
                  <span className="mb-1 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <Badge tone="outline">{typeLabel(c.type)}</Badge>
                      {/* Badge renderiza <span>: continua sendo conteúdo de
                          frase e portanto válido dentro do <button>. */}
                      <LinkCountBadge count={related.get(c.id)?.length ?? 0} />
                    </span>
                    <span className="text-legenda text-ink-subtle">
                      {formatDayLabel(c.captured_at)}
                    </span>
                  </span>
                  {c.title && <span className="block text-sm font-medium text-ink">{c.title}</span>}
                  {c.content && (
                    <span className="line-clamp-2 text-corpo text-ink-muted">{c.content}</span>
                  )}
                </button>
                <div className="mt-2 flex gap-2">
                  {/*
                    Não há guarda de "já convertida" aqui porque ela não teria
                    como ser falsa: `converted_task_id` só é escrito por
                    `convert_capture_to_task`, e a mesma transação move a captura
                    para status 'organized' — que `getCaptures()` não traz (só
                    'draft' e 'inbox'). Toda captura desta lista tem o vínculo
                    nulo, sempre. Um clique repetido também não duplica nada: a
                    função do banco é idempotente e devolve a tarefa existente.
                  */}
                  {c.type === "task" && <ConvertButton captureId={c.id} />}
                  <ArchiveButton captureId={c.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {selected && (
        <Modal
          title={edit ? "Editar captura" : selected.title?.trim() || typeLabel(selected.type)}
          size="lg"
          onClose={() => {
            // Esc e clique no fundo chegam aqui mesmo com a confirmação de
            // exclusão por cima: os dois diálogos escutam o `document`, e a
            // ordem favorece o de baixo — o ConfirmationDialog é descendente
            // deste Modal, e efeitos passivos rodam filho antes de pai, então o
            // listener do Modal é registrado por último e roda por último.
            // É esta guarda, e não a ordem, que impede o Esc de cancelar a
            // exclusão e fechar o detalhe atrás na mesma tecla. Não remova
            // apostando que o Modal responde primeiro; ele responde depois.
            if (confirmOpen) return;
            closeDetail();
          }}
          // Sem isto, o primeiro focável do painel passaria a ser o "Remover
          // vínculo" da seção Relacionado (que vem antes do rodapé na ordem do
          // DOM) e abrir uma nota deixaria o Enter em cima de uma exclusão.
          initialFocus={editButtonRef}
          onPrev={!confirmOpen && selectedIndex > 0 ? () => goTo(-1) : undefined}
          onNext={
            !confirmOpen && selectedIndex >= 0 && selectedIndex < visible.length - 1
              ? () => goTo(1)
              : undefined
          }
          footer={
            edit ? (
              <div className="flex w-full items-center justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEdit(null)} disabled={saving}>
                  Cancelar
                </Button>
                <Button variant="primary" size="sm" onClick={saveEdit} disabled={saving}>
                  {saving ? "Salvando…" : "Salvar"}
                </Button>
              </div>
            ) : (
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Nota anterior"
                    disabled={selectedIndex <= 0}
                    onClick={() => goTo(-1)}
                  >
                    ←
                  </Button>
                  {selectedIndex >= 0 && (
                    <span className="text-legenda text-ink-subtle">
                      {selectedIndex + 1} de {visible.length}
                    </span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="Próxima nota"
                    disabled={selectedIndex < 0 || selectedIndex >= visible.length - 1}
                    onClick={() => goTo(1)}
                  >
                    →
                  </Button>
                </div>
                {/*
                  "Editar" antes de "Excluir" na ordem do DOM, como já faz a
                  lixeira do drive. Não é só estética: quando a lista filtrada tem
                  um item só, os dois botões de navegação ficam desabilitados e o
                  primeiro focável do painel — que é quem recebe o foco ao abrir o
                  modal — passa a ser este grupo. Melhor que a tecla Enter de
                  quem acabou de abrir a nota caia em "Editar".
                */}
                <div className="flex items-center gap-2">
                  <Button ref={editButtonRef} variant="secondary" size="sm" onClick={startEdit}>
                    Editar
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setConfirmOpen(true)}
                    disabled={deleting}
                  >
                    {deleting ? "Excluindo…" : "Excluir"}
                  </Button>
                  {/*
                    Saída explícita do diálogo. Esc e o clique no fundo escuro
                    existem, mas nenhum dos dois é anunciável: o fundo é uma
                    <div> sem role, e quem navega por toque com leitor de tela
                    não tem tecla Esc. Como o `aria-modal` esconde o resto da
                    página, sem este botão a pessoa ficava presa aqui — as outras
                    telas que usam o Modal sempre têm um "Cancelar" no conteúdo;
                    esta era a única sem nada. Fica por ÚLTIMO na ordem do DOM
                    de propósito: o primeiro focável do painel é quem recebe o
                    foco ao abrir, e Enter logo de cara tem que cair em "Editar",
                    não em fechar o que a pessoa acabou de abrir. No modo de
                    edição o "Cancelar" já devolve para esta barra.
                  */}
                  <Button variant="ghost" size="sm" onClick={closeDetail}>
                    Fechar
                  </Button>
                </div>
              </div>
            )
          }
        >
          {edit ? (
            <CaptureEditFields
              draft={edit}
              categories={categories}
              projetos={projetos}
              onChange={(patch) => setEdit((d) => (d ? { ...d, ...patch } : d))}
            />
          ) : (
            <>
              <CaptureDetailBody capture={selected} categoryName={selectedCategory} />
              {/*
                `key` pela captura aberta: a seta esquerda/direita troca a nota
                SEM desmontar o modal, e sem a chave o texto digitado no
                autocomplete e a lista aberta seguiriam para a nota seguinte,
                oferecendo vincular a nota B com o que foi buscado para a A.

                Só no modo leitura. Em edição o painel é um formulário com texto
                não salvo — `dirty` já bloqueia a navegação entre notas pelo
                mesmo motivo, e criar vínculo no meio da edição misturaria duas
                operações que salvam em momentos diferentes.
              */}
              <RelatedSection
                key={selected.id}
                className="mt-4"
                entity={{ kind: "capture", id: selected.id }}
                related={related.get(selected.id) ?? []}
                candidates={linkCandidates}
              />
            </>
          )}

          {/*
            A confirmação é filha do painel do modal, e não irmã dele. Como irmã,
            a armadilha de foco veria o foco "fora do painel" e o puxaria de volta
            a cada Tab, deixando os botões da confirmação inalcançáveis pelo
            teclado; como descendente, `panel.contains()` é verdadeiro e a
            armadilha do Modal reconhece este [role=dialog][aria-modal] aninhado
            como o escopo de cima, fechando o Tab em volta dele e mantendo o
            footer de baixo fora de alcance. O position: fixed dela continua
            valendo em relação à viewport (nenhum ancestral cria contexto de
            contenção), então visualmente nada muda.

            Sem aviso de "a tarefa não será excluída" aqui, por mais que a
            armadilha documentada em deleteCapturePermanently seja real: uma
            captura com `converted_task_id` está em status 'organized', e
            `getCaptures()` só traz 'draft' e 'inbox' — nenhuma captura desta
            tela pode ter virado tarefa, então o aviso nunca teria a chance de
            aparecer. Se um dia esta lista passar a mostrar capturas
            organizadas, o aviso volta junto.
          */}
          <ConfirmationDialog
            open={confirmOpen}
            title="Excluir definitivamente"
            description="Esta nota será apagada do banco. Não existe lixeira para capturas — para tirá-la da caixa de entrada sem perder o registro, use Arquivar."
            confirmLabel="Excluir"
            destructive
            onCancel={() => setConfirmOpen(false)}
            onConfirm={removeCapture}
          />
        </Modal>
      )}
    </div>
  );
}

/** Modo leitura do modal: a captura inteira, sem corte. */
function CaptureDetailBody({
  capture,
  categoryName,
}: {
  capture: Capture;
  categoryName: string | null;
}) {
  return (
    <div className="space-y-3">
      {/*
        Sem selo "Virou tarefa": converter grava status 'organized' na mesma
        transação que preenche `converted_task_id`, e `getCaptures()` só entrega
        'draft' e 'inbox'. Nenhuma captura que chega neste corpo tem vínculo com
        tarefa, então o selo seria decoração que nunca acende.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="outline">{typeLabel(capture.type)}</Badge>
        {categoryName && <Badge>{categoryName}</Badge>}
      </div>

      {capture.content ? (
        // whitespace-pre-wrap porque o compositor é um textarea: as quebras de
        // linha são as que a pessoa digitou e são a única formatação que existe
        // aqui. break-words segura URLs e palavras longas dentro do painel.
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-muted">
          {capture.content}
        </p>
      ) : (
        <p className="text-corpo text-ink-subtle">Sem conteúdo.</p>
      )}

      <dl className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 text-legenda">
        <div className="flex gap-1.5">
          <dt className="text-ink-subtle">Capturada</dt>
          <dd className="text-ink-muted">{formatDayLabel(capture.captured_at)}</dd>
        </div>
        {capture.organized_at && (
          <div className="flex gap-1.5">
            <dt className="text-ink-subtle">Organizada</dt>
            <dd className="text-ink-muted">{formatDayLabel(capture.organized_at)}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/**
 * Modo edição do modal. As classes são copiadas do compositor da esquerda de
 * propósito: é o mesmo formulário sobre os mesmos quatro campos, e dois visuais
 * para a mesma coisa é o começo de dois componentes que divergem com o tempo.
 */
function CaptureEditFields({
  draft,
  categories,
  projetos,
  onChange,
}: {
  draft: Draft;
  categories: Category[];
  projetos: Project[];
  onChange: (patch: Partial<Draft>) => void;
}) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <PillButton
            key={t.value}
            active={draft.type === t.value}
            onClick={() => onChange({ type: t.value })}
          >
            {t.label}
          </PillButton>
        ))}
      </div>

      {/*
        autoFocus porque quem clicou em "Editar" viu o botão sumir junto com o
        modo leitura: sem isso o foco cai no <body> e o próximo Tab reinicia a
        volta pelo diálogo em vez de continuar de onde estava.
      */}
      <input
        autoFocus
        aria-label="Título (opcional)"
        placeholder="Título (opcional)"
        value={draft.title}
        onChange={(e) => onChange({ title: e.target.value })}
        className="mb-3 h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline-2"
      />

      <textarea
        aria-label="Conteúdo"
        placeholder="Comece a escrever. Você organiza depois…"
        value={draft.content}
        onChange={(e) => onChange({ content: e.target.value })}
        rows={8}
        className="w-full resize-none rounded-md border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline-2"
      />

      <select
        aria-label="Categoria"
        value={draft.categoryId}
        onChange={(e) => onChange({ categoryId: e.target.value })}
        className="mt-3 h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2"
      >
        <option value="">Sem categoria</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {projetos.length > 0 && (
        <select
          aria-label="Projeto"
          value={draft.projectId}
          onChange={(e) => onChange({ projectId: e.target.value })}
          className="mt-3 h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2"
        >
          <option value="">Sem projeto</option>
          {projetos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function ConvertButton({ captureId }: { captureId: string }) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await convertCaptureToTask(captureId);
          toast(r.ok ? "Convertida em tarefa" : r.error ?? "Erro", r.ok ? "success" : "error");
        })
      }
    >
      Organizar → tarefa
    </Button>
  );
}

function ArchiveButton({ captureId }: { captureId: string }) {
  const { toast } = useToast();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await archiveCapture(captureId);
          toast(r.ok ? "Arquivada" : r.error ?? "Erro", r.ok ? "success" : "error");
        })
      }
    >
      Arquivar
    </Button>
  );
}
