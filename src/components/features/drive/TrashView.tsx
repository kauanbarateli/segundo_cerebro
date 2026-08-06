"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/states";
import { Icon } from "@/components/ui/Icons";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { useToast } from "@/components/ui/Toast";
import type { DriveFile } from "@/lib/database.types";
import { formatBytes, formatDayLabel } from "@/lib/utils";
import { restoreFile, deleteFilePermanently } from "@/app/(app)/drive/actions";

export function TrashView({ files }: { files: DriveFile[] }) {
  const { toast } = useToast();
  const router = useRouter();
  const [, start] = useTransition();
  const [target, setTarget] = useState<DriveFile | null>(null);

  return (
    <>
      <div className="mb-4">
        <Link
          href="/drive"
          className="inline-flex items-center gap-1.5 text-corpo text-ink-muted hover:text-ink"
        >
          ← Voltar ao Drive
        </Link>
      </div>

      <Card className="overflow-hidden">
        {files.length === 0 ? (
          <EmptyState icon="Trash" title="Lixeira vazia" description="Nada para restaurar." />
        ) : (
          <ul className="divide-y divide-line">
            {files.map((file) => (
              /* Duas linhas no celular: "Restaurar" e "Apagar" ocupam ~155px
                 dos 303px da linha, e o nome do arquivo — que é a única forma
                 de saber O QUE se está prestes a apagar de vez — ficava com
                 menos de 100px. Ler o nome antes de decidir importa mais aqui
                 do que em qualquer outra lista do aplicativo. */
              <li
                key={file.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap"
              >
                <Icon.File width={18} height={18} className="shrink-0 text-ink-subtle" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-legenda text-ink">{file.name}</p>
                  <p className="text-legenda text-ink-subtle">
                    Excluído {formatDayLabel(file.deleted_at)} · {formatBytes(file.size_bytes)}
                  </p>
                </div>
                {/* `gap-3` e não `gap-2`: era a distância que os dois botões já
                    tinham quando eram irmãos diretos do `li`. */}
                <div className="flex w-full justify-end gap-3 sm:w-auto">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      start(async () => {
                        const r = await restoreFile(file.id);
                        if (r.ok) {
                          toast("Arquivo restaurado", "success");
                          router.refresh();
                        } else toast(r.error ?? "Erro", "error");
                      })
                    }
                  >
                    Restaurar
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setTarget(file)}>
                    Apagar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmationDialog
        open={target !== null}
        title="Apagar definitivamente"
        description={`"${target?.name ?? ""}" será removido do armazenamento. Não há como recuperar.`}
        confirmLabel="Apagar"
        destructive
        onCancel={() => setTarget(null)}
        onConfirm={() => {
          const f = target;
          setTarget(null);
          if (!f) return;
          start(async () => {
            const r = await deleteFilePermanently(f.id);
            if (r.ok) {
              toast("Arquivo apagado", "success");
              router.refresh();
            } else toast(r.error ?? "Erro", "error");
          });
        }}
      />
    </>
  );
}
