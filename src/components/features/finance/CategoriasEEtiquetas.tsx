"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/states";
import { Icon } from "@/components/ui/Icons";

import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { CategoryForm, TagForm } from "./FinanceForms";
import type { FinanceCategory, FinanceTag, FinanceTransaction } from "@/lib/database.types";
import { cn } from "@/lib/utils";
import { tomDaCor } from "@/lib/finance-colors";
import { deleteCategory, deleteTag } from "@/app/(app)/financeiro/actions";

/* ------------------------------------------------------- categorias e tags */

export function CategoriasEEtiquetas({
  categories,
  tags,
  transactions,
  transactionTags,
}: {
  categories: FinanceCategory[];
  tags: FinanceTag[];
  /** A janela carregada — três meses. Ver a ressalva do contador abaixo. */
  transactions: FinanceTransaction[];
  transactionTags: { transaction_id: string; tag_id: string }[];
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [, start] = useTransition();
  const [catOpen, setCatOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<FinanceCategory | null>(null);
  const [editingTag, setEditingTag] = useState<FinanceTag | null>(null);

  /*
    ⚠️ O CONTADOR COBRE A JANELA CARREGADA, E O RÓTULO DIZ ISSO.

    A tentação era chamá-lo de "uso" e deixar quem vê "0" concluir que dá para
    apagar. Seria falso: `transactions` cobre três meses, e uma categoria usada
    ano passado apareceria com zero. Apagar a categoria põe `category_id` a NULL
    em todo lançamento antigo (`on delete set null`, 0005) — silenciosamente, e
    sem volta.

    Contar tudo exigiria uma consulta agregada nova; contar o que já está na mão
    é de graça e responde a pergunta útil ("quais eu de fato uso agora"), desde
    que a tela não prometa mais do que isso.
  */
  const usoDeCategoria = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.category_id === null) continue;
      mapa.set(tx.category_id, (mapa.get(tx.category_id) ?? 0) + 1);
    }
    return mapa;
  }, [transactions]);

  const usoDeEtiqueta = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const link of transactionTags) {
      mapa.set(link.tag_id, (mapa.get(link.tag_id) ?? 0) + 1);
    }
    return mapa;
  }, [transactionTags]);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-corpo-forte font-semibold text-ink">Categorias</h3>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setEditingCat(null);
              setCatOpen(true);
            }}
          >
            Nova
          </Button>
        </div>
        {categories.length === 0 ? (
          <EmptyState icon="Wallet" title="Nenhuma categoria" />
        ) : (
          <ul className="divide-y divide-line">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                {/* A cor escolhida aparece AQUI, e não só no gráfico: sem isto,
                    escolher uma cor é uma ação sem retorno visível na tela onde
                    ela foi escolhida. */}
                <span
                  aria-hidden
                  className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tomDaCor(c.color_key).fundo)}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.name}</span>
                <span className="shrink-0 text-legenda tabular-nums text-ink-subtle">
                  {usoDeCategoria.get(c.id) ?? 0}
                </span>
                <Badge tone="outline">{c.kind === "income" ? "Receita" : "Despesa"}</Badge>
                <button
                  type="button"
                  onClick={() => {
                    setEditingCat(c);
                    setCatOpen(true);
                  }}
                  className="alvo-44 rounded-sm border border-line-strong px-2 py-1 text-meta text-ink-muted hover:text-ink"
                >
                  Editar
                </button>
                <button
                  type="button"
                  aria-label={`Excluir ${c.name}`}
                  onClick={() =>
                    start(async () => {
                      const r = await deleteCategory(c.id);
                      if (r.ok) router.refresh();
                      else toast(r.error ?? "Erro", "error");
                    })
                  }
                  className="alvo-44 rounded-sm border border-line-strong p-1.5 text-ink-subtle hover:text-danger-ink"
                >
                  <Icon.Trash width={13} height={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-corpo-forte font-semibold text-ink">Etiquetas</h3>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setEditingTag(null);
              setTagOpen(true);
            }}
          >
            Nova
          </Button>
        </div>
        {tags.length === 0 ? (
          <EmptyState icon="Wallet" title="Nenhuma etiqueta" description="Ex.: fatura, reembolso, viagem." />
        ) : (
          <ul className="divide-y divide-line">
            {tags.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  aria-hidden
                  className={cn("h-2.5 w-2.5 shrink-0 rounded-full", tomDaCor(t.color_key).fundo)}
                />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">#{t.name}</span>
                <span className="shrink-0 text-legenda tabular-nums text-ink-subtle">
                  {usoDeEtiqueta.get(t.id) ?? 0}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setEditingTag(t);
                    setTagOpen(true);
                  }}
                  className="alvo-44 rounded-sm border border-line-strong px-2 py-1 text-meta text-ink-muted hover:text-ink"
                >
                  Editar
                </button>
                <button
                  type="button"
                  aria-label={`Excluir ${t.name}`}
                  onClick={() =>
                    start(async () => {
                      const r = await deleteTag(t.id);
                      if (r.ok) router.refresh();
                      else toast(r.error ?? "Erro", "error");
                    })
                  }
                  className="alvo-44 rounded-sm border border-line-strong p-1.5 text-ink-subtle hover:text-danger-ink"
                >
                  <Icon.Trash width={13} height={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {catOpen && (
        <Modal
          title={editingCat ? "Editar categoria" : "Nova categoria"}
          onClose={() => setCatOpen(false)}
        >
          <CategoryForm
            category={editingCat}
            onDone={() => {
              setCatOpen(false);
              router.refresh();
            }}
            onCancel={() => setCatOpen(false)}
          />
        </Modal>
      )}

      {tagOpen && (
        <Modal
          title={editingTag ? "Editar etiqueta" : "Nova etiqueta"}
          onClose={() => setTagOpen(false)}
        >
          <TagForm
            tag={editingTag}
            onDone={() => {
              setTagOpen(false);
              router.refresh();
            }}
            onCancel={() => setTagOpen(false)}
          />
        </Modal>
      )}
    </div>
  );
}
