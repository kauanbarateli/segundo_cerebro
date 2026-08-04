import type { PrioridadeClickUp, TarefaClickUp } from "@/lib/clickup/types";
import { endOfDay, startOfDay } from "@/lib/utils";

/**
 * Os filtros da aba ClickUp — PUROS, e no cliente.
 *
 * ============================================================================
 * POR QUE NO CLIENTE, E NÃO NA API
 * ============================================================================
 * A lista já está em memória: a aba busca uma vez e guarda por 60 s. Filtrar o
 * que já chegou custa uma passada num array de no máximo 500 itens.
 *
 * Mandar o filtro para a API custaria uma requisição por mudança de filtro, e a
 * cota é da CONTA PESSOAL de quem conectou, dentro do workspace da empresa —
 * gastá-la para reordenar uma lista que já está na tela é o pior negócio
 * possível. Também obrigaria a chavear o cache por combinação de filtro, porque
 * hoje ele é único.
 *
 * ============================================================================
 * ⚠️ "CONCLUÍDAS" NÃO É UM FILTRO POSSÍVEL AQUI
 * ============================================================================
 * `listarMinhasTarefas` manda `include_closed=false` fixo, então tarefa
 * concluída NUNCA chega a este módulo. Um filtro "Concluídas" devolveria uma
 * lista vazia sempre — pior que não existir, porque afirmaria que não há
 * nenhuma. Oferecer o filtro exigiria tornar o parâmetro configurável, propagar
 * por `listarTarefasClickUp` (que hoje não aceita argumento) e chavear o cache.
 * Fica fora até que valha isso.
 */

export type FiltroDePrazo = "todos" | "vencidas" | "hoje" | "semana";

export interface FiltroClickUp {
  prazo: FiltroDePrazo;
  /** Status LITERAL ("in progress"), não fase. `null` = qualquer. */
  status: string | null;
  prioridade: PrioridadeClickUp | "qualquer";
  listaId: string | null;
  /** Id do responsável no ClickUp. `null` = qualquer. */
  responsavelId: string | null;
}

export const FILTRO_VAZIO: FiltroClickUp = {
  prazo: "todos",
  status: null,
  prioridade: "qualquer",
  listaId: null,
  responsavelId: null,
};

export function temFiltroAtivo(filtro: FiltroClickUp): boolean {
  return (
    filtro.prazo !== "todos" ||
    filtro.status !== null ||
    filtro.prioridade !== "qualquer" ||
    filtro.listaId !== null ||
    filtro.responsavelId !== null
  );
}

/**
 * O prazo cabe no recorte?
 *
 * Duas decisões que mudam o resultado e não são óbvias:
 *
 *   1. **Sem prazo nunca casa** com nenhum recorte de data. Só aparece em
 *      "Todas". Uma tarefa sem data não está atrasada nem é de hoje, e incluí-la
 *      em "7 dias" faria o recorte perder o sentido.
 *   2. **"7 dias" INCLUI as vencidas.** É a carga da semana, não uma janela
 *      centrada no futuro: uma tarefa que venceu ontem faz parte do que precisa
 *      de atenção agora, e escondê-la ali seria esconder justamente a mais
 *      urgente.
 *
 * `agora` entra por parâmetro em vez de `Date.now()` interno para o teste poder
 * fixar o instante — sem isso, um teste de "hoje" quebra à meia-noite.
 */
function prazoCasa(tarefa: TarefaClickUp, recorte: FiltroDePrazo, agora: number): boolean {
  if (recorte === "todos") return true;
  if (tarefa.prazo === null) return false;

  const quando = new Date(tarefa.prazo).getTime();
  if (!Number.isFinite(quando)) return false;

  const referencia = new Date(agora);
  switch (recorte) {
    case "vencidas":
      return quando < agora;
    case "hoje":
      return (
        quando >= startOfDay(referencia).getTime() && quando <= endOfDay(referencia).getTime()
      );
    case "semana": {
      const fim = new Date(referencia);
      // +6 e não +7: hoje conta como o primeiro dos sete.
      fim.setDate(fim.getDate() + 6);
      return quando <= endOfDay(fim).getTime();
    }
  }
}

export function filtrarTarefas(
  tarefas: TarefaClickUp[],
  filtro: FiltroClickUp,
  agora: number,
): TarefaClickUp[] {
  return tarefas.filter((t) => {
    if (!prazoCasa(t, filtro.prazo, agora)) return false;
    if (filtro.status !== null && t.status !== filtro.status) return false;
    if (filtro.prioridade !== "qualquer" && t.prioridade !== filtro.prioridade) return false;
    if (filtro.listaId !== null && t.listaId !== filtro.listaId) return false;
    if (
      filtro.responsavelId !== null &&
      !t.responsaveis.some((r) => r.id === filtro.responsavelId)
    ) {
      return false;
    }
    return true;
  });
}

export interface OpcoesDeFiltro {
  status: string[];
  listas: { id: string; nome: string }[];
  prioridades: Exclude<PrioridadeClickUp, null>[];
  responsaveis: { id: string; nome: string }[];
}

/**
 * As opções vêm DAS TAREFAS CARREGADAS, não de uma lista fixa.
 *
 * Não existe conjunto fixo para oferecer: cada Space do ClickUp define os
 * próprios status, e as listas variam com o que foi atribuído a você. Derivar
 * das tarefas garante que todo item do seletor tem pelo menos um resultado — um
 * seletor com opções que não filtram nada é uma pergunta cuja resposta já se
 * sabe ser vazia.
 *
 * ⚠️ Derivado da lista COMPLETA, nunca da já filtrada. Senão escolher um status
 * apagaria os outros do seletor e não haveria como voltar.
 */
export function opcoesDeFiltro(tarefas: TarefaClickUp[]): OpcoesDeFiltro {
  const status = new Set<string>();
  const listas = new Map<string, string>();
  const prioridades = new Set<Exclude<PrioridadeClickUp, null>>();
  const responsaveis = new Map<string, string>();

  for (const t of tarefas) {
    if (t.status) status.add(t.status);
    if (t.listaId) listas.set(t.listaId, t.listaNome ?? t.listaId);
    if (t.prioridade) prioridades.add(t.prioridade);
    for (const r of t.responsaveis) responsaveis.set(r.id, r.souEu ? "você" : r.nome);
  }

  const ORDEM: Exclude<PrioridadeClickUp, null>[] = ["urgente", "alta", "normal", "baixa"];

  return {
    status: [...status].sort((a, b) => a.localeCompare(b, "pt-BR")),
    listas: [...listas]
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    // Ordem de urgência, não alfabética: "alta, baixa, normal, urgente" seria
    // uma lista sem sentido para escolher.
    prioridades: ORDEM.filter((p) => prioridades.has(p)),
    responsaveis: [...responsaveis]
      .map(([id, nome]) => ({ id, nome }))
      // "você" primeiro; o resto em ordem alfabética.
      .sort((a, b) => {
        if (a.nome === "você") return -1;
        if (b.nome === "você") return 1;
        return a.nome.localeCompare(b.nome, "pt-BR");
      }),
  };
}
