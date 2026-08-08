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
import type { ImagemDaCaptura } from "@/lib/data";
import { formatDayLabel, plural } from "@/lib/utils";
import { Icon } from "@/components/ui/Icons";
import { IMAGEM_GRANDE_DEMAIS, IMAGEM_INVALIDA, MAXIMO_DE_ANEXOS } from "@/lib/imagem";
import {
  ACCEPT_DE_IMAGEM,
  type AnexoPendente,
  enviarAnexo,
  imagensDe,
  prepararAnexo,
} from "@/components/features/capture/anexos";
import {
  apagarRascunho,
  gravarRascunho,
  lerRascunho,
  limparResiduoLegado,
} from "@/lib/capture-draft";
import { CLASSE_DO_CAMPO, CLASSE_DO_CAMPO_MULTILINHA } from "@/components/ui/estilos";
import { cn } from "@/lib/utils";
import {
  anexarImagemACaptura,
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
  imagens = new Map(),
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
  /**
   * As imagens de cada captura, por id, com URL assinada. Um Map e não um campo
   * dentro de `captures` porque a assinatura das URLs é feita em lote — ver
   * `getImagensDasCapturas`.
   */
  imagens?: Map<string, ImagemDaCaptura[]>;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [restored, setRestored] = useState(false);

  /*
    ⚠️ AS IMAGENS FICAM FORA DO RASCUNHO, e não é esquecimento.

    O rascunho é gravado em `sessionStorage` (ver `capture-draft.ts`), que
    guarda STRING e tem uns 5 MB no total. Uma imagem não cabe: em base64 ela
    cresce ~33%, e duas fotos já estourariam a cota — o que faz o `setItem`
    LANÇAR, e aí o rascunho inteiro para de ser salvo. Perder o texto para tentar
    preservar a imagem é o pior negócio possível.

    Consequência assumida: recarregar a página preserva o texto e perde as
    imagens escolhidas. É recuperável (colar de novo) e o texto — que é o que
    não se recupera — continua protegido.
  */
  const [anexos, setAnexos] = useState<AnexoPendente[]>([]);
  const [preparando, setPreparando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const seletorDeArquivo = useRef<HTMLInputElement>(null);
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

  /**
   * Recebe arquivos de qualquer uma das TRÊS portas: colar, arrastar, escolher.
   *
   * As três chegam aqui e não em três caminhos paralelos — a validação, o teto e
   * as mensagens são as mesmas, e três cópias divergiriam na primeira correção.
   */
  async function receberArquivos(arquivos: File[]) {
    if (arquivos.length === 0) return;

    const espaco = MAXIMO_DE_ANEXOS - anexos.length;
    if (espaco <= 0) {
      toast(`São no máximo ${MAXIMO_DE_ANEXOS} imagens por captura.`, "error");
      return;
    }

    // Corta ANTES de preparar: reencodar dez imagens para descartar sete seria
    // segurar a interface por nada.
    const aceitos = arquivos.slice(0, espaco);
    if (arquivos.length > espaco) {
      toast(`Só cabem mais ${plural(espaco, "imagem", "imagens")}.`, "error");
    }

    setPreparando(true);
    try {
      for (const arquivo of aceitos) {
        const r = await prepararAnexo(arquivo);
        if (r.ok) {
          setAnexos((a) => [...a, r.anexo]);
        } else {
          toast(
            r.motivo === "tipo"
              ? IMAGEM_INVALIDA
              : r.motivo === "tamanho"
                ? IMAGEM_GRANDE_DEMAIS
                : "Não foi possível ler essa imagem.",
            "error",
          );
        }
      }
    } finally {
      setPreparando(false);
    }
  }

  function removerAnexo(id: string) {
    setAnexos((atuais) => {
      const alvo = atuais.find((a) => a.id === id);
      // A prévia é um `blob:` vivo no documento; sem revogar, cada imagem
      // adicionada e removida deixa a cópia dela na memória da aba até a
      // navegação seguinte.
      if (alvo) URL.revokeObjectURL(alvo.previa);
      return atuais.filter((a) => a.id !== id);
    });
  }

  /**
   * ⚠️ A CAPTURA É SALVA PRIMEIRO, E AS IMAGENS DEPOIS — nesta ordem.
   *
   * O vínculo tem FK para `captures`, então não existe anexar a uma captura que
   * ainda não foi criada. A ordem inversa é impossível, e a consequência precisa
   * ser tratada: se o upload de uma imagem falhar, a CAPTURA JÁ EXISTE.
   *
   * E é o comportamento certo. O texto é o que a pessoa digitou e é o que ela
   * não pode perder; descartar a captura inteira porque uma imagem falhou seria
   * punir o conteúdo pelo anexo. Então a captura fica, o formulário é limpo, e o
   * aviso diz exatamente quantas imagens não subiram.
   */
  function submit() {
    start(async () => {
      const r = await createCapture({
        type: draft.type,
        title: draft.title || undefined,
        content: draft.content || undefined,
        categoryId: draft.categoryId || undefined,
        projectId: draft.projectId || undefined,
      });

      if (!r.ok) {
        toast(r.error ?? "Erro", "error");
        return;
      }

      let falharam = 0;
      if (anexos.length > 0 && r.id) {
        for (const anexo of anexos) {
          const caminho = await enviarAnexo(anexo);
          if (!caminho) {
            falharam += 1;
            continue;
          }
          const anexado = await anexarImagemACaptura({ captureId: r.id, storagePath: caminho });
          if (!anexado.ok) falharam += 1;
        }
      }

      toast(
        falharam === 0
          ? "Enviado ao cérebro"
          : `Captura salva, mas ${plural(falharam, "imagem falhou", "imagens falharam")}.`,
        falharam === 0 ? "success" : "error",
      );

      for (const anexo of anexos) URL.revokeObjectURL(anexo.previa);
      setAnexos([]);
      setDraft({ ...emptyDraft, type: draft.type });
      apagarRascunho(userId);
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
      <Card className="p-6">
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
          className={cn(CLASSE_DO_CAMPO, "w-full mb-3")}
        />

        {/*
          ⚠️ O `onPaste` e o `onDrop` ficam no TEXTAREA, não num painel separado.

          Colar um print é o caso mais comum de todos, e o cursor já está aqui —
          a pessoa acabou de escrever. Exigir que ela mova o foco para uma "área
          de anexos" antes de colar transformaria o gesto de um toque em três, e
          "tirar da cabeça rápido" é o propósito inteiro desta tela.

          `onDragOver` precisa de `preventDefault` para que o `onDrop` chegue a
          acontecer: sem ele o navegador trata o arquivo como navegação e ABRE a
          imagem, descartando a captura que estava sendo escrita.
        */}
        <textarea
          aria-label="Conteúdo"
          placeholder="Comece a escrever. Você organiza depois… (pode colar uma imagem aqui)"
          value={draft.content}
          onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
          onPaste={(e) => {
            const imagens = imagensDe(e.clipboardData);
            if (imagens.length === 0) return;
            // Só impede o padrão quando HÁ imagem: colar texto precisa
            // continuar colando texto.
            e.preventDefault();
            void receberArquivos(imagens);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setArrastando(true);
          }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastando(false);
            void receberArquivos(imagensDe(e.dataTransfer));
          }}
          rows={10}
          className={cn(
            CLASSE_DO_CAMPO_MULTILINHA,
            "w-full resize-none",
            // O destaque de arrasto é uma BORDA, não um overlay: overlay cobriria
            // o texto que a pessoa está escrevendo bem no momento em que ela
            // precisa ver onde a imagem vai cair.
            arrastando && "border-accent",
          )}
        />

        <AnexosDaCaptura
          anexos={anexos}
          preparando={preparando}
          enviando={pending}
          onEscolher={() => seletorDeArquivo.current?.click()}
          onRemover={removerAnexo}
        />

        {/*
          O `<input type="file">` é o que funciona no CELULAR — lá não há colar
          nem arrastar, e `accept="image/*"` abre a câmera e a galeria.

          Escondido com `sr-only` e não `display:none`: um input oculto por
          display sai da ordem de foco, e o botão que o aciona passaria a ser um
          controle sem par para quem navega por teclado.
        */}
        <input
          ref={seletorDeArquivo}
          type="file"
          accept={ACCEPT_DE_IMAGEM}
          multiple
          className="sr-only"
          onChange={(e) => {
            // `Array.from` ANTES do await: `e.target.value = ""` limpa a
            // FileList, e sem a cópia o handler assíncrono receberia uma lista
            // vazia. É o mesmo cuidado que `DriveView` já documenta.
            const arquivos = Array.from(e.target.files ?? []);
            e.target.value = "";
            void receberArquivos(arquivos);
          }}
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
              className={CLASSE_DO_CAMPO}
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
                className={CLASSE_DO_CAMPO}
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
                  className="w-full rounded-sm text-left"
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
              <CaptureDetailBody
                capture={selected}
                categoryName={selectedCategory}
                imagens={imagens.get(selected.id) ?? []}
              />
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
  imagens = [],
}: {
  capture: Capture;
  categoryName: string | null;
  /** As imagens anexadas, com URL já assinada. Ver `getImagensDasCapturas`. */
  imagens?: ImagemDaCaptura[];
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

      {imagens.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {imagens.map((img) => (
            /*
              A imagem abre em ABA NOVA em vez de num visualizador próprio. Um
              lightbox seria mais uma camada sobre um modal que já está aberto —
              e a aba nova entrega de graça o que ele teria que reimplementar:
              zoom, girar, salvar e a lupa do sistema.

              `rel="noopener noreferrer"` mesmo sendo o próprio domínio: a URL é
              ASSINADA e aponta para o Storage do Supabase, que é outra origem.
              Sem `noreferrer` o endereço desta página iria no Referer.
            */
            <a
              key={img.fileId}
              href={img.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md focus-visible:outline focus-visible:outline-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt="Imagem anexada a esta captura"
                loading="lazy"
                className="h-24 w-24 rounded-md border border-line object-cover"
              />
            </a>
          ))}
        </div>
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
        className={cn(CLASSE_DO_CAMPO, "w-full mb-3")}
      />

      <textarea
        aria-label="Conteúdo"
        placeholder="Comece a escrever. Você organiza depois…"
        value={draft.content}
        onChange={(e) => onChange({ content: e.target.value })}
        rows={8}
        className={cn(CLASSE_DO_CAMPO_MULTILINHA, "w-full resize-none")}
      />

      <select
        aria-label="Categoria"
        value={draft.categoryId}
        onChange={(e) => onChange({ categoryId: e.target.value })}
        className={cn(CLASSE_DO_CAMPO, "w-full mt-3")}
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
          className={cn(CLASSE_DO_CAMPO, "w-full mt-3")}
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

/**
 * As imagens escolhidas, antes do envio.
 *
 * ⚠️ NÃO renderiza nada quando não há imagem NEM preparo em curso — nem um
 * botão "anexar imagem" permanente. Capturar é uma caixa de texto, e a
 * funcionalidade toda vive nos gestos que já existem (colar, arrastar). Um
 * botão fixo somaria peso visual a uma tela cujo valor é não ter nada no
 * caminho; no celular, onde colar não existe, ele aparece junto das miniaturas
 * assim que a primeira imagem entra — e antes disso o seletor é alcançável pelo
 * mesmo `<input>` via teclado.
 */
function AnexosDaCaptura({
  anexos,
  preparando,
  enviando,
  onEscolher,
  onRemover,
}: {
  anexos: AnexoPendente[];
  preparando: boolean;
  enviando: boolean;
  onEscolher: () => void;
  onRemover: (id: string) => void;
}) {
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        {anexos.map((a) => (
          <figure key={a.id} className="relative">
            {/*
              `<img>` cru e não `next/image`: a fonte é um `blob:` local que
              existe só nesta aba e some ao recarregar. O otimizador do Next
              precisaria de uma URL que ele consiga buscar do servidor, e não
              há nada para otimizar num arquivo que nunca sai da memória.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={a.previa}
              alt=""
              className="h-20 w-20 rounded-md border border-line object-cover"
            />
            <button
              type="button"
              onClick={() => onRemover(a.id)}
              disabled={enviando}
              aria-label="Remover esta imagem"
              className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-ink-muted hover:text-ink"
            >
              <Icon.X width={12} height={12} aria-hidden />
            </button>
          </figure>
        ))}

        {preparando && (
          <div
            className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-line text-legenda text-ink-subtle"
            aria-live="polite"
          >
            Lendo…
          </div>
        )}

        {(anexos.length > 0 || preparando) && anexos.length < MAXIMO_DE_ANEXOS && (
          <button
            type="button"
            onClick={onEscolher}
            disabled={enviando}
            className="flex h-20 w-20 items-center justify-center rounded-md border border-dashed border-line-strong text-legenda text-ink-muted hover:bg-surface-muted hover:text-ink"
          >
            + imagem
          </button>
        )}
      </div>

      {anexos.length > 0 && (
        <p className="mt-2 text-legenda text-ink-subtle">
          {plural(anexos.length, "imagem", "imagens")} — {""}
          {/* Diz que os metadados saem. É informação de PRIVACIDADE: foto de
              celular carrega GPS, e quem anexa merece saber que ele não vai
              junto. Ver `prepararImagem`. */}
          enviadas sem os metadados da câmera (data, aparelho e localização).
        </p>
      )}
    </div>
  );
}
