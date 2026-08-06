"use client";

import { PillButton } from "@/components/ui/Badge";
import type { FiltroClickUp, FiltroDePrazo, OpcoesDeFiltro } from "@/lib/clickup/filtros";
import { FILTRO_VAZIO, temFiltroAtivo } from "@/lib/clickup/filtros";
import type { PrioridadeClickUp } from "@/lib/clickup/types";

/**
 * A barra de filtros da aba ClickUp.
 *
 * As pills de `/tarefas` (Trabalho/Estudos/Hoje/Atrasadas) NÃO servem aqui: são
 * categorias da tabela pessoal e não existem no ClickUp. Enquanto elas ficavam
 * visíveis com esta aba aberta, eram uma affordance falsa — controles na tela
 * que não afetavam nada do que estava sendo mostrado. Agora `TasksView` as
 * esconde nesta aba, e o lugar de filtrar é aqui.
 *
 * Todo controle daqui opera sobre a lista que JÁ ESTÁ em memória. Nenhuma
 * mudança de filtro fala com a API — ver o cabeçalho de `lib/clickup/filtros.ts`.
 */

const PRAZOS: { chave: FiltroDePrazo; rotulo: string }[] = [
  { chave: "todos", rotulo: "Todas" },
  { chave: "vencidas", rotulo: "Vencidas" },
  { chave: "hoje", rotulo: "Hoje" },
  // "7 dias" e não "Esta semana": inclui as vencidas e conta a partir de hoje,
  // o que "esta semana" não diz. Rótulo ambíguo em filtro vira desconfiança na
  // lista inteira.
  { chave: "semana", rotulo: "7 dias" },
];

/** Um `<select>` com rótulo acessível e a opção "qualquer" sempre presente. */
function Seletor({
  id,
  rotulo,
  valor,
  aoMudar,
  children,
}: {
  id: string;
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <label htmlFor={id} className="sr-only">
        {rotulo}
      </label>
      <select
        id={id}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className="h-11 max-w-[11rem] rounded-md border border-line bg-surface px-3 text-legenda text-ink"
      >
        {children}
      </select>
    </span>
  );
}

export function ClickUpFiltros({
  filtro,
  opcoes,
  aoMudar,
  total,
  visiveis,
}: {
  filtro: FiltroClickUp;
  opcoes: OpcoesDeFiltro;
  aoMudar: (proximo: FiltroClickUp) => void;
  total: number;
  visiveis: number;
}) {
  const ativo = temFiltroAtivo(filtro);

  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {PRAZOS.map((p) => (
          <PillButton
            key={p.chave}
            active={filtro.prazo === p.chave}
            onClick={() => aoMudar({ ...filtro, prazo: p.chave })}
            className="px-3 py-1 text-legenda"
          >
            {p.rotulo}
          </PillButton>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {/* Cada seletor só aparece quando há mais de uma opção real. Um seletor
            de uma opção só é uma pergunta cuja resposta já se sabe, e ocupa a
            mesma largura de um útil. */}
        {opcoes.listas.length > 1 && (
          <Seletor
            id="clickup-filtro-lista"
            rotulo="Filtrar por lista"
            valor={filtro.listaId ?? ""}
            aoMudar={(v) => aoMudar({ ...filtro, listaId: v || null })}
          >
            <option value="">Todas as listas</option>
            {opcoes.listas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome}
              </option>
            ))}
          </Seletor>
        )}

        {opcoes.status.length > 1 && (
          <Seletor
            id="clickup-filtro-status"
            rotulo="Filtrar por status"
            valor={filtro.status ?? ""}
            aoMudar={(v) => aoMudar({ ...filtro, status: v || null })}
          >
            <option value="">Todos os status</option>
            {opcoes.status.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Seletor>
        )}

        {opcoes.prioridades.length > 1 && (
          <Seletor
            id="clickup-filtro-prioridade"
            rotulo="Filtrar por prioridade"
            valor={filtro.prioridade === "qualquer" ? "" : (filtro.prioridade ?? "")}
            aoMudar={(v) =>
              aoMudar({
                ...filtro,
                prioridade: v === "" ? "qualquer" : (v as PrioridadeClickUp),
              })
            }
          >
            <option value="">Qualquer prioridade</option>
            {opcoes.prioridades.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Seletor>
        )}

        {opcoes.responsaveis.length > 1 && (
          <Seletor
            id="clickup-filtro-responsavel"
            rotulo="Filtrar por responsável"
            valor={filtro.responsavelId ?? ""}
            aoMudar={(v) => aoMudar({ ...filtro, responsavelId: v || null })}
          >
            <option value="">Qualquer responsável</option>
            {opcoes.responsaveis.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nome}
              </option>
            ))}
          </Seletor>
        )}
      </div>

      {ativo && (
        <div className="flex flex-wrap items-center gap-2">
          {/*
            "N de M" e não só "N". Sem o denominador, uma lista curta por filtro
            fica indistinguível de uma lista curta por TRUNCAMENTO ("primeiras
            500") — e as duas coisas aparecem nesta mesma tela.
          */}
          <p className="text-legenda text-ink-subtle" role="status">
            {visiveis} de {total} {total === 1 ? "tarefa" : "tarefas"}
          </p>
          {/* Reusa `FILTRO_VAZIO` em vez de escrever os campos de novo: uma
              dimensão nova entra em `filtros.ts` e "Limpar" já a limpa. Uma
              cópia aqui esqueceria dela em silêncio. */}
          <button
            type="button"
            onClick={() => aoMudar(FILTRO_VAZIO)}
            className="rounded-sm text-legenda text-ink-muted underline hover:text-ink"
          >
            Limpar filtros
          </button>
        </div>
      )}
    </div>
  );
}
