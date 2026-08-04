"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/states";
import { Icon } from "@/components/ui/Icons";
import { listarTarefasClickUp } from "@/app/(app)/tarefas/clickup-actions";
import type { MotivoClickUp } from "@/lib/clickup/erros";
import { FILTRO_VAZIO, filtrarTarefas, opcoesDeFiltro, type FiltroClickUp } from "@/lib/clickup/filtros";
import type { TarefaClickUp } from "@/lib/clickup/types";
import { formatDayLabel, formatTime, cn } from "@/lib/utils";
import { ClickUpFiltros } from "@/components/features/tasks/ClickUpFiltros";
import { ClickUpTaskSheet } from "@/components/features/tasks/ClickUpTaskSheet";
import { ResponsaveisClickUp } from "@/components/features/tasks/ResponsaveisClickUp";

/**
 * A aba ClickUp.
 *
 * BUSCA AO MONTAR, por Server Action — não em `tarefas/page.tsx`. Se a busca
 * morasse na página, a lista pessoal esperaria pela API do ClickUp a cada
 * navegação, e num dia lento `/tarefas` inteira ficaria lenta. Aqui o pior caso
 * é esta aba dizer que não deu.
 *
 * CACHE DE SESSÃO de 60 s: alternar entre Lista e ClickUp não refaz a busca.
 * Sem isso, ir e voltar entre as abas gasta a cota da API à toa — e a cota é da
 * conta pessoal de quem conectou.
 */

const VALIDADE_MS = 60_000;

interface Cache {
  tarefas: TarefaClickUp[];
  truncado: boolean;
  buscadoEm: number;
}

export function ClickUpPanel() {
  const [tarefas, setTarefas] = useState<TarefaClickUp[]>([]);
  const [truncado, setTruncado] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<{ texto: string; motivo?: MotivoClickUp } | null>(null);
  const [aberta, setAberta] = useState<TarefaClickUp | null>(null);
  const [filtro, setFiltro] = useState<FiltroClickUp>(FILTRO_VAZIO);

  // O cache vive em ref, não em estado: ele não deve provocar render nenhum, e
  // sobrevive à troca de aba porque o componente permanece montado.
  const cache = useRef<Cache | null>(null);

  const buscar = useCallback(async (forcar = false) => {
    const guardado = cache.current;
    if (!forcar && guardado && Date.now() - guardado.buscadoEm < VALIDADE_MS) {
      setTarefas(guardado.tarefas);
      setTruncado(guardado.truncado);
      setCarregando(false);
      return;
    }

    setCarregando(true);
    setErro(null);
    const r = await listarTarefasClickUp();
    setCarregando(false);

    if (!r.ok) {
      setErro({ texto: r.erro ?? "Não foi possível falar com o ClickUp.", motivo: r.motivo });
      return;
    }

    const lista = r.tarefas ?? [];
    cache.current = { tarefas: lista, truncado: r.truncado ?? false, buscadoEm: Date.now() };
    setTarefas(lista);
    setTruncado(r.truncado ?? false);
  }, []);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  /*
    As opções saem da lista COMPLETA e o recorte, da lista filtrada. Derivar as
    opções do resultado filtrado apagaria do seletor tudo o que não está
    selecionado — e não haveria como voltar.

    `agora` é congelado no render para a lista não mudar debaixo do usuário
    enquanto ele lê: com `Date.now()` dentro do comparador, uma tarefa poderia
    entrar em "Vencidas" no meio de uma rolagem.
  */
  const opcoes = useMemo(() => opcoesDeFiltro(tarefas), [tarefas]);
  const visiveis = useMemo(
    () => filtrarTarefas(tarefas, filtro, Date.now()),
    [tarefas, filtro],
  );

  /* ------------------------------------------------------------ carregando */

  if (carregando) {
    return (
      <div className="space-y-2 p-4" aria-busy="true" aria-label="Carregando tarefas do ClickUp">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-md border border-line bg-surface px-4 py-3.5">
            <div className="h-4 w-2/3 animate-pulse rounded-sm bg-surface-muted" />
            <div className="mt-2 h-3 w-1/3 animate-pulse rounded-sm bg-surface-muted" />
          </div>
        ))}
      </div>
    );
  }

  /* ------------------------------------------------------------------ erro */

  if (erro) {
    return (
      <div className="p-4">
        <EmptyState
          icon="Alert"
          title="ClickUp indisponível"
          description={erro.texto}
          action={
            // Um 401 não se resolve tentando de novo: o token foi recusado, e a
            // ação certa é reconectar. Oferecer "Tentar de novo" ali seria
            // convidar a repetir o que já falhou.
            erro.motivo === "token_invalido" ? (
              <Link
                href="/configuracoes"
                className="inline-flex h-8 items-center rounded-sm border border-line-strong px-3 text-corpo font-medium text-ink hover:bg-surface-muted"
              >
                Abrir Configurações
              </Link>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => void buscar(true)}>
                <Icon.Refresh width={14} height={14} /> Tentar de novo
              </Button>
            )
          }
        />
      </div>
    );
  }

  /* ----------------------------------------------------------------- vazio */

  if (tarefas.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          icon="Check"
          title="Nenhuma tarefa atribuída a você"
          description="Quando alguém te colocar como responsável no ClickUp, ela aparece aqui."
          action={
            <Button variant="secondary" size="sm" onClick={() => void buscar(true)}>
              <Icon.Refresh width={14} height={14} /> Atualizar
            </Button>
          }
        />
      </div>
    );
  }

  /* ----------------------------------------------------------------- lista */

  const agora = Date.now();

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-legenda text-ink-subtle">
          {tarefas.length} {tarefas.length === 1 ? "tarefa" : "tarefas"} onde você é responsável
        </p>
        <Button variant="ghost" size="sm" onClick={() => void buscar(true)}>
          <Icon.Refresh width={14} height={14} /> Atualizar
        </Button>
      </div>

      {truncado && (
        <p className="mb-3 rounded-md border border-line bg-surface-muted px-3 py-2 text-legenda text-ink-muted">
          Mostrando as primeiras 500. Há mais tarefas atribuídas a você no ClickUp.
        </p>
      )}

      <ClickUpFiltros
        filtro={filtro}
        opcoes={opcoes}
        aoMudar={setFiltro}
        total={tarefas.length}
        visiveis={visiveis.length}
      />

      {visiveis.length === 0 ? (
        /*
          Vazio POR FILTRO, e a frase diz isso. O `EmptyState` de cima ("Nenhuma
          tarefa atribuída a você") continua valendo só para a lista realmente
          vazia — confundir os dois faria o aplicativo afirmar que não há tarefa
          nenhuma quando o que houve foi um filtro esquecido ligado.

          ⚠️ E com a lista truncada, "nada encontrado" é ainda mais delicado: a
          tarefa pode existir e não ter vindo. Daí a segunda frase.
        */
        <div className="rounded-md border border-line bg-surface px-4 py-6 text-center">
          <p className="text-corpo text-ink-muted">Nenhuma tarefa com esse filtro.</p>
          {truncado && (
            <p className="mt-1 text-legenda text-ink-subtle">
              A lista está limitada às primeiras 500 — pode haver outras no ClickUp.
            </p>
          )}
        </div>
      ) : (
      <ul className="space-y-2">
        {visiveis.map((t) => {
          const vencida = t.prazo != null && new Date(t.prazo).getTime() < agora;
          return (
            <li key={t.id}>
              <div className="rounded-md border border-line bg-surface px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setAberta(t)}
                    className="min-w-0 flex-1 rounded-sm text-left text-sm font-medium text-ink hover:underline focus-visible:outline-2"
                  >
                    {t.nome}
                  </button>
                  {t.status && (
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-meta font-medium"
                      style={
                        // A cor vem da API — cada Space define a sua paleta.
                        // `borderColor`/`color` em vez de fundo sólido para não
                        // brigar com o tema claro/escuro do aplicativo.
                        t.statusCor
                          ? { color: t.statusCor, border: `1px solid ${t.statusCor}` }
                          : undefined
                      }
                    >
                      {t.status}
                    </span>
                  )}
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-legenda text-ink-subtle">
                  {t.listaNome && (
                    <span className="inline-flex items-center gap-1">
                      <Icon.Folder width={12} height={12} /> {t.listaNome}
                    </span>
                  )}
                  {t.prazo && (
                    <span className={cn("inline-flex items-center gap-1", vencida && "text-red-500")}>
                      <Icon.Clock width={12} height={12} />
                      {formatDayLabel(t.prazo)} {formatTime(t.prazo)}
                      {vencida && " · vencida"}
                    </span>
                  )}
                  {t.prioridade && <Badge tone="outline">{t.prioridade}</Badge>}
                  <ResponsaveisClickUp pessoas={t.responsaveis} className="max-w-[16rem]" />
                  {t.url && (
                    /* O link vem da API; `external-link.ts` não é usado aqui
                       porque o destino é fixo e conhecido (app.clickup.com), e
                       o `rel` cobre o tabnabbing. */
                    <a
                      href={t.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ink-muted hover:text-ink hover:underline"
                    >
                      Abrir no ClickUp
                    </a>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      )}

      {aberta && (
        <ClickUpTaskSheet
          tarefa={aberta}
          onFechar={() => setAberta(null)}
          onMudou={() => void buscar(true)}
        />
      )}
    </div>
  );
}
