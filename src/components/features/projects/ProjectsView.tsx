"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { EmptyState } from "@/components/ui/states";
import { Icon } from "@/components/ui/Icons";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { ProjectForm } from "@/components/features/projects/ProjectForm";
import { deleteProject } from "@/app/(app)/projetos/actions";
import type { Project } from "@/lib/database.types";

export function ProjectsView({ projetos }: { projetos: Project[] }) {
  const { toast } = useToast();
  const [, iniciar] = useTransition();
  const [formAberto, setFormAberto] = useState(false);
  const [editando, setEditando] = useState<Project | null>(null);
  const [apagando, setApagando] = useState<Project | null>(null);

  function abrirNovo() {
    setEditando(null);
    setFormAberto(true);
  }

  return (
    <div className="space-y-4">
      {projetos.length === 0 ? (
        <EmptyState
          icon="Folder"
          title="Nenhum projeto ainda"
          description="Um projeto agrupa tarefas, capturas, cadernos e pastas que já existem. Nada é duplicado — é só uma etiqueta que dá uma tela própria."
          action={
            <Button variant="primary" size="sm" onClick={abrirNovo}>
              Criar o primeiro
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex justify-end">
            <Button variant="primary" size="sm" onClick={abrirNovo}>
              <Icon.Capture width={15} height={15} /> Novo projeto
            </Button>
          </div>

          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projetos.map((p) => (
              <li key={p.id}>
                <Card className="flex h-full flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/projetos/${p.id}`}
                      className="min-w-0 flex-1 rounded-sm text-sm font-medium text-ink hover:underline focus-visible:outline-2"
                    >
                      {p.name}
                    </Link>
                    <DropdownMenu
                      label={`Ações de ${p.name}`}
                      items={[
                        {
                          label: "Editar",
                          onClick: () => {
                            setEditando(p);
                            setFormAberto(true);
                          },
                        },
                        { label: "Apagar", onClick: () => setApagando(p), danger: true },
                      ]}
                    >
                      <Icon.Dots width={16} height={16} />
                    </DropdownMenu>
                  </div>
                  {p.description && (
                    <p className="mt-1.5 line-clamp-3 text-legenda text-ink-subtle">
                      {p.description}
                    </p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      {formAberto && (
        <Modal
          title={editando ? "Editar projeto" : "Novo projeto"}
          onClose={() => setFormAberto(false)}
        >
          <ProjectForm
            projeto={editando ?? undefined}
            onDone={() => setFormAberto(false)}
            onCancel={() => setFormAberto(false)}
          />
        </Modal>
      )}

      <ConfirmationDialog
        open={apagando !== null}
        title="Apagar projeto"
        /*
          A frase diz o que REALMENTE acontece. Apagar um projeto não apaga nada
          do que estava dentro dele — as tarefas, capturas, cadernos e pastas
          continuam, só deixam de estar agrupados. Prometer "tudo será
          removido" assustaria sem motivo; omitir faria a pessoa hesitar.
        */
        description={`"${apagando?.name ?? ""}" sai da lista. As tarefas, capturas, cadernos e pastas continuam onde estão — só deixam de estar agrupados.`}
        confirmLabel="Apagar"
        destructive
        onCancel={() => setApagando(null)}
        onConfirm={() => {
          const alvo = apagando;
          setApagando(null);
          if (!alvo) return;
          iniciar(async () => {
            const r = await deleteProject(alvo.id);
            toast(r.ok ? "Projeto apagado" : (r.error ?? "Erro"), r.ok ? "success" : "error");
          });
        }}
      />
    </div>
  );
}
