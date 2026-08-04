"use client";

import { useMemo, useState } from "react";
import {
  QuadroColuna,
  QuadroColunaVazia,
  QuadroDivisor,
  QuadroGrade,
} from "@/components/ui/Quadro";
import { CartaoClickUp } from "@/components/features/tasks/CartaoClickUp";
import { agruparPorFase, porPrazo } from "@/lib/clickup/mapper";
import type { FaseClickUp, TarefaClickUp } from "@/lib/clickup/types";

/**
 * ============================================================================
 * O QUADRO DO CLICKUP — LEITURA, SEM ARRASTAR
 * ============================================================================
 *
 * DOIS MODOS, e o segundo é exato
 * -------------------------------
 * **Por fase** (padrão): três colunas derivadas da posição do status dentro da
 * lista de origem. Ver `faseNaLista` — é heurística, e o cartão mostra a base
 * da classificação no `title` da pill justamente por isso.
 *
 * **Por status literal**: quando o filtro de lista está ativo, TODAS as tarefas
 * vêm da mesma lista. Aí não há heurística nenhuma: as colunas são os próprios
 * status daquela lista, na ordem que o ClickUp define (`orderindex`), e a
 * coluna está certa por construção. É o modo a usar quando a classificação por
 * fase parecer errada.
 *
 * POR QUE FASE, E NÃO OUTRA COISA (no modo padrão)
 * ------------------------------------------------
 * As tarefas vêm de VÁRIAS listas e cada Space define a própria paleta de
 * status. Agrupar por status LITERAL com várias listas explodiria as colunas e
 * fundiria "in progress" de duas listas afirmando uma equivalência que ninguém
 * verificou. Por lista não é kanban, é tabela agrupada. Por prazo duplica a
 * ordenação que a lista já entrega. Por prioridade, `null` é o caso comum e a
 * coluna "sem prioridade" engoliria o quadro.
 *
 * ⚠️ POR QUE NÃO ARRASTA — três bloqueios ESTRUTURAIS
 * ---------------------------------------------------
 * 1. NÃO EXISTE ORDENAÇÃO PERSISTÍVEL. A única escrita do cofre
 *    (`capabilities.ts`) é `PUT /task/{id}` com corpo de uma chave: `status`.
 *    Reordenar dentro da coluna não é *expressável*. Toda a matemática de
 *    índice fracionário do `TaskBoard` seria código morto — e um quadro onde o
 *    card salta de volta a cada solta é pior que um sem arrasto.
 *
 * 2. ARRASTAR É EXATAMENTE O PADRÃO QUE O LIMITE PROÍBE. Cada
 *    `mudarStatusClickUp` custa TRÊS chamadas (`garantirResponsavel` +
 *    `statusDaLista` + o `PUT`), mais uma quarta quando o painel revalida — e o
 *    limite é 10/min. O quadro pessoal resolveu isso ISENTANDO `moveTask` do
 *    limite, porque ali "um limite viraria 'o quadro parou de funcionar' no
 *    meio de uma reorganização". Essa isenção não está disponível aqui: o
 *    limite protege a cota da conta pessoal dentro do workspace da empresa.
 *
 * 3. A COLUNA DA LISTA A NÃO É DESTINO VÁLIDO PARA UM CARD DA LISTA B. O
 *    servidor já recusa (`mudarStatusClickUp` valida contra `statusDaLista`).
 *    Um kanban comunica "tudo pode ir para qualquer coluna" — contrato falso
 *    por construção.
 *
 * Mudar status continua onde já está e já funciona: o seletor do
 * `ClickUpTaskSheet`, populado pelos status reais daquela lista.
 *
 * FUNCIONA NO CELULAR, ao contrário do quadro pessoal (`hidden md:block`).
 * Aquela restrição existe porque arrastar em tela pequena é ruim; um quadro de
 * leitura não tem esse problema, e colunas empilhadas são uma visão legítima.
 */

interface Coluna {
  chave: string;
  titulo: string;
  vazia: string;
  tarefas: TarefaClickUp[];
  /** Nasce recolhida. Ver a coluna "Concluído". */
  recolhidaPorPadrao?: boolean;
}

const COLUNAS_POR_FASE: { fase: FaseClickUp; titulo: string; vazia: string }[] = [
  { fase: "afazer", titulo: "A fazer", vazia: "Nada aqui." },
  { fase: "andamento", titulo: "Em andamento", vazia: "Nada aqui." },
  {
    fase: "concluido",
    titulo: "Concluído",
    /*
      A frase explica o vazio em vez de deixá-lo falar.

      `listarMinhasTarefas` manda `include_closed=false`, então tarefa fechada
      não chega — esta coluna tende a ficar vazia SEMPRE. Sem a explicação, ela
      afirmaria "você não concluiu nada", que é falso e desanimador.

      Por isso ela também nasce RECOLHIDA: um terço da largura do quadro estava
      sendo gasto para carregar uma frase de desculpas. Recolhida, a frase
      continua a um clique de distância e as outras duas colunas ficam com o
      espaço.

      (A coluna não foi removida porque a fase `done`, se o workspace usar esse
      tipo, cai aqui e apareceria. Como a integração nunca falou com a API real,
      tirá-la seria apostar no sentido contrário.)
    */
    vazia: "Concluídas não são trazidas — a listagem pede só as abertas.",
  },
];

/**
 * As colunas do modo exato: os status literais, na ordem do ClickUp.
 *
 * `statusOrdem` é `status.orderindex` e só é comparável DENTRO de uma lista —
 * por isso este modo depende do filtro de lista estar ativo. Com listas
 * misturadas, o índice 1 de uma nada tem a ver com o 1 da outra.
 */
function colunasPorStatusLiteral(tarefas: TarefaClickUp[]): Coluna[] {
  const grupos = new Map<string, { ordem: number; tarefas: TarefaClickUp[] }>();

  for (const t of tarefas) {
    const chave = t.status ?? "(sem status)";
    const grupo = grupos.get(chave);
    // `Infinity` para o que não tem ordem cair no fim, em vez de fingir 0 e
    // encabeçar o quadro.
    const ordem = t.statusOrdem ?? Number.POSITIVE_INFINITY;
    if (grupo) grupo.ordem = Math.min(grupo.ordem, ordem);
    else grupos.set(chave, { ordem, tarefas: [] });
    grupos.get(chave)!.tarefas.push(t);
  }

  return [...grupos]
    .sort((a, b) => a[1].ordem - b[1].ordem)
    .map(([status, g]) => ({
      chave: status,
      titulo: status,
      vazia: "Nada aqui.",
      tarefas: [...g.tarefas].sort(porPrazo),
    }));
}

export function ClickUpQuadro({
  tarefas,
  aoAbrir,
  /**
   * O filtro de lista está ativo — todas as tarefas vêm da mesma lista.
   *
   * Vem do painel em vez de ser deduzido aqui de propósito: deduzir por
   * "só existe um `listaId` no lote" acertaria por acidente num dia em que
   * todas as tarefas por acaso fossem da mesma lista, e o quadro mudaria de
   * modo sozinho.
   */
  listaUnica = false,
}: {
  tarefas: TarefaClickUp[];
  aoAbrir: (tarefa: TarefaClickUp) => void;
  listaUnica?: boolean;
}) {
  const colunas = useMemo<Coluna[]>(() => {
    if (listaUnica) return colunasPorStatusLiteral(tarefas);
    // O agrupamento é puro e mora em `mapper.ts`, onde é testado.
    const porFase = agruparPorFase(tarefas);
    return COLUNAS_POR_FASE.map((c) => ({
      chave: c.fase,
      titulo: c.titulo,
      vazia: c.vazia,
      tarefas: porFase.get(c.fase) ?? [],
      recolhidaPorPadrao: c.fase === "concluido",
    }));
  }, [tarefas, listaUnica]);

  const [recolhidasManualmente, setRecolhidas] = useState<Record<string, boolean>>({});
  function estaRecolhida(c: Coluna): boolean {
    return recolhidasManualmente[c.chave] ?? c.recolhidaPorPadrao ?? false;
  }

  // Um "agora" só para o quadro inteiro — ver a prop `agora` de `CartaoClickUp`.
  const agora = Date.now();

  return (
    <QuadroGrade>
      {colunas.map((coluna) => (
        <QuadroColuna
          key={coluna.chave}
          titulo={coluna.titulo}
          contagem={coluna.tarefas.length}
          colapsada={estaRecolhida(coluna)}
          aoAlternar={() =>
            setRecolhidas((r) => ({ ...r, [coluna.chave]: !estaRecolhida(coluna) }))
          }
          // Só quando há o que rolar: uma coluna com dois cartões e `max-h`
          // ganharia uma barra de rolagem que nunca rola.
          rolavel={coluna.tarefas.length > 6}
        >
          {coluna.tarefas.length === 0 ? (
            <QuadroColunaVazia>{coluna.vazia}</QuadroColunaVazia>
          ) : (
            <CartoesAgrupadosPorLista
              tarefas={coluna.tarefas}
              // No modo exato só existe uma lista: o divisor repetiria o nome
              // dela em cada coluna sem informar nada.
              subdividir={!listaUnica}
              agora={agora}
              aoAbrir={aoAbrir}
            />
          )}
        </QuadroColuna>
      ))}
    </QuadroGrade>
  );
}

/**
 * Os cartões de uma coluna, subdivididos pela lista de origem.
 *
 * A pergunta que isto responde é "de onde vem isto?". Numa coluna que junta
 * tarefas de cinco listas, o ícone de pasta de 12 px dentro do cartão só
 * responde a quem parar para ler linha por linha — o divisor responde de
 * relance.
 *
 * A subdivisão só aparece com MAIS DE UMA lista na coluna: um divisor único
 * sobre todos os cartões seria um cabeçalho que não separa nada.
 */
function CartoesAgrupadosPorLista({
  tarefas,
  subdividir,
  agora,
  aoAbrir,
}: {
  tarefas: TarefaClickUp[];
  subdividir: boolean;
  agora: number;
  aoAbrir: (t: TarefaClickUp) => void;
}) {
  const grupos = useMemo(() => {
    const mapa = new Map<string, { nome: string; tarefas: TarefaClickUp[] }>();
    for (const t of tarefas) {
      const chave = t.listaId ?? "(sem lista)";
      const grupo = mapa.get(chave);
      if (grupo) grupo.tarefas.push(t);
      else mapa.set(chave, { nome: t.listaNome ?? "Sem lista", tarefas: [t] });
    }
    return [...mapa.values()];
  }, [tarefas]);

  const cartao = (t: TarefaClickUp) => (
    <CartaoClickUp
      key={t.id}
      tarefa={t}
      aoAbrir={() => aoAbrir(t)}
      agora={agora}
      compacto
      // Sem aninhamento aqui: mãe e filha caem em colunas diferentes sempre que
      // estiverem em fases diferentes, que é o caso comum. A marca no cartão
      // carrega a informação sozinha.
      subtarefa={t.paiId !== null}
    />
  );

  if (!subdividir || grupos.length <= 1) return <>{tarefas.map(cartao)}</>;

  return (
    <>
      {grupos.map((g) => (
        <div key={g.nome} className="flex flex-col gap-2">
          <QuadroDivisor>{g.nome}</QuadroDivisor>
          {g.tarefas.map(cartao)}
        </div>
      ))}
    </>
  );
}
