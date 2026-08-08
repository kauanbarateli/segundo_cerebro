"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/states";
import { Icon } from "@/components/ui/Icons";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
/*
  ⚠️ O cliente do Supabase é importado DENTRO de `uploadFiles`, não aqui — ver o
  comentário lá. Em resumo: ele pesa ~70 kB e só serve para ENVIAR arquivo, que
  é a minoria das visitas ao Drive.
*/
import type { DriveFile, DriveFolder, DriveUsage } from "@/lib/database.types";
import { formatBytes, formatDayLabel, cn } from "@/lib/utils";
import {
  createFolder,
  renameFolder,
  deleteFolder,
  registerFile,
  renameFile,
  moveFile,
  trashFile,
  toggleStar,
  getDownloadUrl,
} from "@/app/(app)/drive/actions";
import { CLASSE_DO_CAMPO } from "@/components/ui/estilos";

const BUCKET = "drive";
const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Cota do plano gratuito do Supabase, para a barra de uso. */
const QUOTA_BYTES = 1024 * 1024 * 1024;

interface UploadState {
  /** Identidade própria: dois arquivos podem ter o mesmo nome no mesmo lote. */
  id: string;
  name: string;
  progress: "uploading" | "done" | "error";
  error?: string;
}

/**
 * Traduz o erro cru do Storage para algo acionável.
 *
 * As mensagens do Supabase descrevem o sintoma ("Bucket not found"), não o que
 * fazer. Como as causas prováveis são poucas e conhecidas, vale mapear: um erro
 * que diz qual é o próximo passo economiza uma sessão inteira de depuração.
 */
function explainStorageError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes("bucket not found")) {
    return "O bucket \"drive\" não existe. Rode a migration 0007_drive.sql no SQL Editor do Supabase.";
  }
  if (m.includes("row-level security") || m.includes("violates row-level")) {
    return "O Storage recusou o envio. As policies do bucket \"drive\" não foram criadas — veja a migration 0007_drive.sql.";
  }
  if (m.includes("payload too large") || m.includes("exceeded the maximum")) {
    return `Acima do limite de ${formatBytes(MAX_FILE_BYTES)} por arquivo.`;
  }
  if (m.includes("jwt") || m.includes("unauthorized") || m.includes("invalid token")) {
    return "Sessão expirada. Recarregue a página e entre de novo.";
  }
  return raw;
}

export function DriveView({
  folderId,
  folders,
  files,
  breadcrumb,
  allFolders,
  usage,
}: {
  folderId: string | null;
  folders: DriveFolder[];
  files: DriveFile[];
  breadcrumb: DriveFolder[];
  allFolders: DriveFolder[];
  usage: DriveUsage | null;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const [folderModal, setFolderModal] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string; isFolder: boolean } | null>(null);
  const [moving, setMoving] = useState<DriveFile | null>(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<DriveFolder | null>(null);

  const usedBytes = usage?.total_bytes ?? 0;

  // Timers de limpeza da fila, um por lote. Guardados para poder cancelar no
  // desmonte — senão o setUploads dispara sobre um componente que já saiu.
  const cleanupTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  useEffect(() => {
    const timers = cleanupTimers.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  /**
   * Envia direto ao Supabase Storage, sem passar pelo servidor Next.
   * Rotas serverless têm limite de corpo (~4,5 MB na Vercel) e o proxy dobraria
   * a banda. A RLS do Storage garante que só é possível escrever na própria pasta.
   */
  async function uploadFiles(list: FileList | File[]) {
    /*
      `import()` dinâmico. O cliente do Supabase para navegador pesa ~70 kB e
      aqui ele serve a UMA coisa: mandar bytes direto para o Storage, sem passar
      pelo servidor Next (rota serverless tem teto de corpo).

      Abrir o Drive para ver, renomear, mover ou baixar não precisa dele —
      essas operações são Server Actions. Pagar 70 kB no carregamento de toda
      visita para o caso de a pessoa ENVIAR um arquivo é pagar pelo caso menos
      frequente. Buscar o chunk no primeiro envio é irrelevante ao lado da
      transferência do arquivo, que vem logo depois.
    */
    const { createClient } = await import("@/lib/supabase/client");
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      toast("Sessão expirada. Recarregue a página e entre de novo.", "error");
      return;
    }

    // Cada item ganha um id. Antes o status era casado pelo NOME do arquivo, e
    // dois arquivos homônimos no mesmo lote sobrescreviam o status um do outro.
    const patch = (id: string, next: Partial<UploadState>) =>
      setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...next } : x)));

    // Ids DESTE lote. A limpeza no fim só pode tocar neles: sem esse escopo, o
    // timer de um lote apagaria as linhas de um lote seguinte ainda em voo — e,
    // como `patch` é um `map`, o item removido nunca mais voltaria, então a
    // linha de erro simplesmente não apareceria.
    const batchIds = new Set<string>();

    for (const file of Array.from(list)) {
      const id = crypto.randomUUID();
      batchIds.add(id);

      if (file.size > MAX_FILE_BYTES) {
        setUploads((u) => [
          ...u,
          {
            id,
            name: file.name,
            progress: "error",
            error: `Acima do limite de ${formatBytes(MAX_FILE_BYTES)} por arquivo.`,
          },
        ]);
        continue;
      }

      setUploads((u) => [...u, { id, name: file.name, progress: "uploading" }]);

      // O try é por ARQUIVO, não por lote. Uma queda de rede no meio de uma
      // Server Action rejeita a promessa em vez de devolver { ok: false }; sem
      // isso, o lote inteiro abortava e a linha ficava presa em "Enviando…"
      // para sempre, sem mensagem e sem botão de dispensar.
      try {
        const path = `${user.id}/${crypto.randomUUID()}`;
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { contentType: file.type || "application/octet-stream" });

        if (upErr) {
          const explained = explainStorageError(upErr.message);
          patch(id, { progress: "error", error: explained });
          // O erro do Storage ia só para a fila, que se limpava sozinha em
          // 2,5 s. Na prática a mensagem sumia antes de dar para ler.
          toast(explained, "error");
          continue;
        }

        // Sem `sizeBytes`: o servidor mede o objeto no Storage. O `file.size`
        // daqui continua servindo para a recusa ANTES do envio (o `if` lá em
        // cima), que é economia de banda, não controle — quem contorna o
        // navegador esbarra no limite de 50 MB do próprio bucket.
        const r = await registerFile({
          name: file.name,
          storagePath: path,
          mimeType: file.type || null,
          folderId,
        });

        patch(id, { progress: r.ok ? "done" : "error", error: r.error });
        if (!r.ok) toast(r.error ?? "Falha ao registrar o arquivo.", "error");
      } catch (e) {
        const msg =
          e instanceof Error && e.message
            ? `Falha no envio: ${e.message}`
            : "Falha no envio. Verifique a conexão e tente de novo.";
        patch(id, { progress: "error", error: msg });
        toast(msg, "error");
      }
    }

    router.refresh();

    // Limpa apenas o que deu certo, e apenas deste lote. Linhas com erro ficam
    // até o usuário dispensar — uma mensagem de falha que desaparece sozinha é
    // pior que nenhuma, porque parece que nada aconteceu.
    const handle = setTimeout(() => {
      cleanupTimers.current.delete(handle);
      setUploads((u) => u.filter((x) => !batchIds.has(x.id) || x.progress === "error"));
    }, 2500);
    cleanupTimers.current.add(handle);
  }

  async function download(file: DriveFile) {
    const r = await getDownloadUrl(file.id);
    if (r.ok && r.url) window.open(r.url, "_blank", "noopener,noreferrer");
    else toast(r.error ?? "Falha ao gerar link", "error");
  }

  return (
    <div className="space-y-5">
      {/* Uso de armazenamento */}
      <Card className="p-5">
        {/* `flex-wrap`: "Armazenamento" + "512,3 MB de 1 GB · 1234 arquivos"
            passa de 300px em 13px, que é toda a largura do cartão em 375px. */}
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-corpo">
          <span className="text-ink">Armazenamento</span>
          <span className="text-ink-muted">
            {formatBytes(usedBytes)} de {formatBytes(QUOTA_BYTES)} · {usage?.file_count ?? 0} arquivos
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
          <div
            className={cn(
              "h-full rounded-full",
              usedBytes / QUOTA_BYTES > 0.9 ? "bg-danger" : "bg-accent",
            )}
            style={{ width: `${Math.min(100, Math.max(1, (usedBytes / QUOTA_BYTES) * 100))}%` }}
          />
        </div>
      </Card>

      {/* Breadcrumb + ações */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Caminho" className="flex flex-wrap items-center gap-1 text-corpo">
          <Link href="/drive" className="text-ink-muted hover:text-ink">
            Drive
          </Link>
          {breadcrumb.map((f) => (
            <span key={f.id} className="flex items-center gap-1">
              <Icon.ChevronRight width={13} height={13} className="text-ink-subtle" />
              <Link href={`/drive?folder=${f.id}`} className="text-ink-muted hover:text-ink">
                {f.name}
              </Link>
            </span>
          ))}
        </nav>

        {/* Lixeira + Nova pasta + Enviar somam ~291px e a linha tem 335px em
            375px: cabe por 44px, e não cabe mais se um rótulo crescer. O
            `flex-wrap` evita que o terceiro botão saia da tela. */}
        <div className="flex flex-wrap gap-2">
          <Link
            href="/drive/lixeira"
            className="alvo-44 inline-flex h-8 items-center gap-1.5 rounded-sm border border-line-strong px-3 text-corpo text-ink-muted hover:text-ink"
          >
            <Icon.Trash width={14} height={14} /> Lixeira
          </Link>
          <Button variant="secondary" size="sm" onClick={() => setFolderModal(true)}>
            <Icon.Folder width={14} height={14} /> Nova pasta
          </Button>
          <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()}>
            <Icon.Upload width={14} height={14} /> Enviar
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              // COPIA a lista ANTES de limpar o input — e é por isso que o
              // botão "Enviar" não funcionava enquanto arrastar funcionava.
              //
              // `e.target.files` é uma referência VIVA ao FileList do input.
              // `uploadFiles` é async e só chega no `Array.from(list)` depois
              // do `await supabase.auth.getUser()`. Chamando `void
              // uploadFiles(e.target.files)` o controle voltava para cá, a
              // linha seguinte fazia `e.target.value = ""` — que esvazia o
              // FileList — e, quando a função retomava, ela iterava sobre uma
              // lista vazia. Nenhum arquivo subia, e sem erro nenhum.
              //
              // O `onDrop` nunca teve o problema porque `e.dataTransfer.files`
              // não é limpo por ninguém.
              const arquivos = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (arquivos.length) void uploadFiles(arquivos);
            }}
          />
        </div>
      </div>

      {/* Fila de upload. Sucessos somem sozinhos; falhas ficam até dispensar. */}
      {uploads.length > 0 && (
        <Card className="divide-y divide-line">
          {uploads.map((u) => (
            <div key={u.id} className="flex items-start gap-3 px-4 py-2.5 text-corpo">
              <Icon.File width={15} height={15} className="mt-0.5 shrink-0 text-ink-subtle" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-ink">{u.name}</p>
                {u.progress === "error" && (
                  <p className="mt-0.5 text-legenda text-danger-ink">{u.error}</p>
                )}
              </div>
              {u.progress === "error" ? (
                <button
                  type="button"
                  onClick={() => setUploads((list) => list.filter((x) => x.id !== u.id))}
                  className="shrink-0 rounded-md px-2 py-0.5 text-legenda text-ink-subtle hover:bg-surface-muted hover:text-ink"
                >
                  Dispensar
                </button>
              ) : (
                <span className="shrink-0 text-legenda text-ink-subtle">
                  {u.progress === "uploading" ? "Enviando…" : "Concluído"}
                </span>
              )}
            </div>
          ))}
        </Card>
      )}

      {/* Área principal com drop */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
        }}
        className={cn("rounded-lg transition-colors", dragOver && "ring-2 ring-ink/40")}
      >
        <Card className="overflow-hidden">
          {folders.length === 0 && files.length === 0 ? (
            <EmptyState
              icon="Folder"
              title="Pasta vazia"
              description="Arraste arquivos aqui ou use o botão Enviar."
            />
          ) : (
            <ul className="divide-y divide-line">
              {folders.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-4 py-3">
                  <Icon.Folder width={18} height={18} className="shrink-0 text-ink-muted" />
                  <Link
                    href={`/drive?folder=${f.id}`}
                    className="min-w-0 flex-1 truncate text-sm font-medium text-ink hover:underline"
                  >
                    {f.name}
                  </Link>
                  <span className="hidden text-legenda text-ink-subtle sm:block">
                    {formatDayLabel(f.created_at)}
                  </span>
                  <div className="flex shrink-0 gap-1">
                    <IconButton
                      label="Renomear pasta"
                      onClick={() => setRenaming({ id: f.id, name: f.name, isFolder: true })}
                    >
                      Renomear
                    </IconButton>
                    <IconButton label="Excluir pasta" onClick={() => setDeleteFolderTarget(f)} danger>
                      <Icon.Trash width={13} height={13} />
                    </IconButton>
                  </div>
                </li>
              ))}

              {files.map((file) => (
                /*
                  A linha de arquivo é a mais apertada do aplicativo e por isso
                  quebra em duas no celular.

                  São CINCO ações (destacar, baixar, renomear, mover, lixeira).
                  Mesmo antes de crescerem para 44px elas já somavam ~221px dos
                  303px que a linha tem em 375px; com o ícone e os `gap-3`,
                  sobravam ~40px para o nome do arquivo — três caracteres e
                  reticências. Não dava para distinguir um arquivo do outro.

                  Tamanho e ações descem para a segunda linha (o contêiner
                  `w-full` não cabe ao lado do nome, então quebra), e o nome
                  passa a ter a largura inteira. A partir de `sm` volta tudo
                  para uma linha só.
                */
                <li
                  key={file.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap"
                >
                  <Icon.File width={18} height={18} className="shrink-0 text-ink-subtle" />
                  <button
                    type="button"
                    onClick={() => void download(file)}
                    className="min-w-0 flex-1 truncate text-left text-sm text-ink hover:underline"
                  >
                    {file.name}
                  </button>
                  {file.starred && <Badge tone="outline">★</Badge>}
                  <div className="flex w-full items-center justify-end gap-3 sm:w-auto">
                    {/* Continua escondido no celular: com os cinco botões em
                        44px a segunda linha já usa ~275 dos 303px, e o tamanho
                        do arquivo não cabe sem espremer os alvos de toque de
                        volta. */}
                    <span className="hidden w-20 text-right text-legenda text-ink-subtle sm:block">
                      {formatBytes(file.size_bytes)}
                    </span>
                    <div className="flex shrink-0 gap-1">
                      <IconButton
                        label={file.starred ? "Remover destaque" : "Destacar"}
                        onClick={() =>
                          start(async () => {
                            const r = await toggleStar(file.id, !file.starred);
                            if (r.ok) router.refresh();
                            else toast(r.error ?? "Erro", "error");
                          })
                        }
                      >
                        <Icon.Star width={13} height={13} />
                      </IconButton>
                      <IconButton label="Baixar" onClick={() => void download(file)}>
                        <Icon.Download width={13} height={13} />
                      </IconButton>
                      <IconButton
                        label="Renomear"
                        onClick={() => setRenaming({ id: file.id, name: file.name, isFolder: false })}
                      >
                        Renomear
                      </IconButton>
                      <IconButton label="Mover" onClick={() => setMoving(file)}>
                        Mover
                      </IconButton>
                      <IconButton
                        label="Enviar para a lixeira"
                        danger
                        onClick={() =>
                          start(async () => {
                            const r = await trashFile(file.id);
                            if (r.ok) {
                              toast("Enviado para a lixeira", "success");
                              router.refresh();
                            } else toast(r.error ?? "Erro", "error");
                          })
                        }
                      >
                        <Icon.Trash width={13} height={13} />
                      </IconButton>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Modais */}
      {folderModal && (
        <Modal title="Nova pasta" onClose={() => setFolderModal(false)}>
          <NameForm
            label="Nome da pasta"
            onSubmit={async (name) => {
              const r = await createFolder({ name, parentId: folderId });
              if (r.ok) {
                toast("Pasta criada", "success");
                setFolderModal(false);
                router.refresh();
              }
              return r;
            }}
            onCancel={() => setFolderModal(false)}
          />
        </Modal>
      )}

      {renaming && (
        <Modal title="Renomear" onClose={() => setRenaming(null)}>
          <NameForm
            label="Novo nome"
            initial={renaming.name}
            onSubmit={async (name) => {
              const r = renaming.isFolder
                ? await renameFolder({ id: renaming.id, name })
                : await renameFile({ id: renaming.id, name });
              if (r.ok) {
                toast("Renomeado", "success");
                setRenaming(null);
                router.refresh();
              }
              return r;
            }}
            onCancel={() => setRenaming(null)}
          />
        </Modal>
      )}

      {moving && (
        <Modal title={`Mover "${moving.name}"`} onClose={() => setMoving(null)}>
          <MoveForm
            folders={allFolders}
            currentFolderId={moving.folder_id}
            onSubmit={async (targetFolderId) => {
              const r = await moveFile({ id: moving.id, targetFolderId });
              if (r.ok) {
                toast("Arquivo movido", "success");
                setMoving(null);
                router.refresh();
              }
              return r;
            }}
            onCancel={() => setMoving(null)}
          />
        </Modal>
      )}

      <ConfirmationDialog
        open={deleteFolderTarget !== null}
        title="Excluir pasta"
        description={`"${deleteFolderTarget?.name ?? ""}" e TODO o conteúdo (subpastas e arquivos) serão apagados permanentemente. Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir tudo"
        destructive
        onCancel={() => setDeleteFolderTarget(null)}
        onConfirm={() => {
          const f = deleteFolderTarget;
          setDeleteFolderTarget(null);
          if (!f) return;
          start(async () => {
            const r = await deleteFolder(f.id);
            if (r.ok) {
              toast("Pasta excluída", "success");
              router.refresh();
            } else toast(r.error ?? "Erro", "error");
          });
        }}
      />
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        /*
          ALVO DE TOQUE — os `h-11 min-w-11` (44px) valem só no celular.

          Estes botões eram 28px de altura e ~29px de largura nos que só têm
          ícone: metade do alvo mínimo confortável, numa LISTA onde o vizinho de
          4px é "Enviar para a lixeira". Errar o dedo aqui apaga arquivo.

          O ícone NÃO cresceu — continua 13px. O que cresceu foi a área
          clicável, via altura mínima e padding. A partir de `sm` tudo volta ao
          h-7/px-2 original, porque com mouse o alvo pequeno não é problema e a
          densidade da lista no desktop é desejada.
        */
        "inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-sm border border-line-strong px-3 text-meta text-ink-muted transition-colors",
        "sm:h-7 sm:min-w-0 sm:px-2",
        danger ? "hover:text-danger-ink" : "hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function NameForm({
  label,
  initial = "",
  onSubmit,
  onCancel,
}: {
  label: string;
  initial?: string;
  onSubmit: (name: string) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await onSubmit(name.trim());
        if (!r.ok) setError(r.error ?? "Erro");
        setBusy(false);
      }}
      className="space-y-4"
    >
      <div>
        <label className="mb-1.5 block text-corpo font-medium text-ink">{label}</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
          maxLength={120}
          className={cn(CLASSE_DO_CAMPO, "w-full")}
        />
      </div>
      {error && (
        <p role="alert" className="text-corpo text-danger-ink">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="primary" size="sm" type="submit" disabled={busy || !name.trim()}>
          {busy ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}

function MoveForm({
  folders,
  currentFolderId,
  onSubmit,
  onCancel,
}: {
  folders: DriveFolder[];
  currentFolderId: string | null;
  onSubmit: (targetFolderId: string | null) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState<string>(currentFolderId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Caminho completo para desambiguar pastas homônimas em níveis diferentes.
  function pathOf(folder: DriveFolder): string {
    const byId = new Map(folders.map((f) => [f.id, f]));
    const parts: string[] = [];
    let cursor: DriveFolder | undefined = folder;
    let guard = 0;
    while (cursor && guard < 64) {
      parts.unshift(cursor.name);
      cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
      guard++;
    }
    return parts.join(" / ");
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await onSubmit(target === "" ? null : target);
        if (!r.ok) setError(r.error ?? "Erro");
        setBusy(false);
      }}
      className="space-y-4"
    >
      <div>
        <label className="mb-1.5 block text-corpo font-medium text-ink">Pasta de destino</label>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className={cn(CLASSE_DO_CAMPO, "w-full")}
        >
          <option value="">Drive (raiz)</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {pathOf(f)}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p role="alert" className="text-corpo text-danger-ink">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="primary" size="sm" type="submit" disabled={busy}>
          {busy ? "Movendo…" : "Mover"}
        </Button>
      </div>
    </form>
  );
}
