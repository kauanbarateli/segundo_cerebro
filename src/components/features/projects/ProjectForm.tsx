"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { createProject, updateProject } from "@/app/(app)/projetos/actions";
import type { Project } from "@/lib/database.types";

export function ProjectForm({
  projeto,
  onDone,
  onCancel,
}: {
  projeto?: Project;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { toast } = useToast();
  const [enviando, iniciar] = useTransition();
  const [name, setName] = useState(projeto?.name ?? "");
  const [description, setDescription] = useState(projeto?.description ?? "");

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const payload = { name, description, colorKey: projeto?.color_key ?? "stone" };
          const r = projeto
            ? await updateProject(projeto.id, payload)
            : await createProject(payload);
          if (r.ok) {
            toast(projeto ? "Projeto salvo" : "Projeto criado", "success");
            onDone();
          } else {
            toast(r.error ?? "Erro", "error");
          }
        });
      }}
    >
      <div>
        <label htmlFor="projeto-nome" className="mb-1.5 block text-corpo font-medium text-ink">
          Nome
        </label>
        <input
          id="projeto-nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          required
          autoFocus
          placeholder="Reforma do apartamento"
          className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline-2"
        />
      </div>

      <div>
        <label htmlFor="projeto-descricao" className="mb-1.5 block text-corpo font-medium text-ink">
          Descrição <span className="font-normal text-ink-subtle">(opcional)</span>
        </label>
        <textarea
          id="projeto-descricao"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2_000}
          placeholder="O que este projeto é, e quando ele acaba."
          className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline-2"
        />
      </div>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={enviando || name.trim().length === 0}
        >
          {enviando ? "Salvando…" : projeto ? "Salvar" : "Criar"}
        </Button>
      </div>
    </form>
  );
}
