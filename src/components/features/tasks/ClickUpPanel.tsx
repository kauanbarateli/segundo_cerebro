"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/states";
import { Icon } from "@/components/ui/Icons";
import { listarTarefasClickUp } from "@/app/(app)/tarefas/clickup-actions";
import type { MotivoClickUp } from "@/lib/clickup/erros";
import {
  FILTRO_VAZIO,
  filtrarTarefas,
  opcoesDeFiltro,
  type FiltroClickUp,
} from "@/lib/clickup/filtros";
import { aninharTarefas } from "@/lib/clickup/mapper";
import type { TarefaClickUp } from "@/lib/clickup/types";
import { cn } from "@/lib/utils";
import { CartaoClickUp } from "@/components/features/tasks/CartaoClickUp";
import { ClickUpFiltros } from "@/components/features/tasks/ClickUpFiltros";
import { ClickUpQuadro } from "@/components/features/tasks/ClickUpQuadro";
import { ClickUpTaskSheet } from "@/components/features/tasks/ClickUpTaskSheet";

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
  // Lista por padrão: é a visão que responde "o que vence primeiro", e essa é a
  // pergunta que se leva ao abrir a aba. O quadro responde "onde está cada
  // coisa", que é uma segunda pergunta.
  const [visao, setVisao] = useState<"lista" | "quadro">("lista");

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
  /*
    O aninhamento é aplicado DEPOIS do filtro, sobre o que sobrou. É o que faz
    filtrar por "Vencidas" e perder a mãe funcionar sem caso especial: a filha
    vira órfã pela mesma regra que cobre a subtarefa cujo pai é de um colega.

    Só na LISTA. No quadro não há aninhamento: as colunas agrupam por fase, e
    mãe e filha caem em colunas diferentes com frequência — desenhar um recuo
    ali afirmaria uma hierarquia dentro de uma coluna que ela não tem. A marca
    "sub" no cartão continua, e é ela que carrega a informação.
  */
  const linhas = useMemo(() => aninharTarefas(visiveis), [visiveis]);

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
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-legenda text-ink-subtle">
          {tarefas.length} {tarefas.length === 1 ? "tarefa" : "tarefas"} onde você é responsável
        </p>
        <div className="flex items-center gap-2">
          {/*
            O seletor lista/quadro fica AQUI, dentro do painel, e não como uma
            quarta aba lá em cima. As abas de `TasksView` escolhem QUAL conjunto
            de tarefas se está vendo (as pessoais, as do ClickUp); isto escolhe
            COMO ver o conjunto já escolhido. Misturar os dois níveis faria uma
            fileira de quatro botões em que dois pertencem a perguntas
            diferentes.

            Sem `hidden md:*`: o quadro do ClickUp é de leitura e as colunas
            empilham no celular. Ver o cabeçalho de `ClickUpQuadro`.
          */}
          <div className="flex items-center gap-1 rounded-md border border-line-strong p-0.5">
            <button
              type="button"
              aria-label="Ver o ClickUp em lista"
              aria-pressed={visao === "lista"}
              onClick={() => setVisao("lista")}
              className={cn(
                "flex h-7 w-8 items-center justify-center rounded-sm transition-colors",
                visao === "lista" ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              <Icon.List width={15} height={15} />
            </button>
            <button
              type="button"
              aria-label="Ver o ClickUp em quadro"
              aria-pressed={visao === "quadro"}
              onClick={() => setVisao("quadro")}
              className={cn(
                "flex h-7 w-8 items-center justify-center rounded-sm transition-colors",
                visao === "quadro" ? "bg-accent text-accent-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              <Icon.Board width={15} height={15} />
            </button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void buscar(true)}>
            <Icon.Refresh width={14} height={14} /> Atualizar
          </Button>
        </div>
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
      ) : visao === "quadro" ? (
        <ClickUpQuadro
          tarefas={visiveis}
          aoAbrir={setAberta}
          // Com o filtro de lista ativo, o quadro troca as três colunas de fase
          // pelos status literais daquela lista, na ordem do ClickUp. Aí não há
          // heurística nenhuma e a coluna está certa por construção — é o modo
          // a usar quando a classificação por fase parecer errada.
          listaUnica={filtro.listaId !== null}
        />
      ) : (
        <ul className="space-y-2">
          {linhas.map(({ tarefa, nivel, orfa }) => (
            <li
              key={tarefa.id}
              // Recuo por estilo, e não por classe: `ml-${n}` do Tailwind precisa
              // ser literal no código para o compilador encontrar a classe, e
              // uma escada de casos para um número pequeno é pior que 20 px.
              style={nivel > 0 ? { marginLeft: nivel * 20 } : undefined}
            >
              <CartaoClickUp
                tarefa={tarefa}
                aoAbrir={() => setAberta(tarefa)}
                agora={agora}
                subtarefa={tarefa.paiId !== null}
                orfa={orfa}
              />
            </li>
          ))}
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
