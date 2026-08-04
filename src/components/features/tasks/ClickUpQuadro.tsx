"use client";

import { useMemo } from "react";
import { QuadroColuna, QuadroColunaVazia, QuadroGrade } from "@/components/ui/Quadro";
import { CartaoClickUp } from "@/components/features/tasks/CartaoClickUp";
import { agruparPorFase } from "@/lib/clickup/mapper";
import type { FaseClickUp, TarefaClickUp } from "@/lib/clickup/types";

/**
 * ============================================================================
 * O QUADRO DO CLICKUP — LEITURA, SEM ARRASTAR
 * ============================================================================
 *
 * POR QUE AGRUPAR POR FASE
 * ------------------------
 * As tarefas vêm de VÁRIAS listas e cada Space define a própria paleta de
 * status. Foram consideradas cinco formas de agrupar e quatro foram descartadas:
 *
 *   - por status LITERAL: as colunas explodem, e fundir "in progress" de duas
 *     listas afirma uma equivalência que ninguém verificou;
 *   - por LISTA: não é kanban, é tabela agrupada, e o número de colunas não tem
 *     teto;
 *   - por PRAZO: duplica a ordenação que a lista já entrega;
 *   - por PRIORIDADE: `null` é o caso comum, e a coluna "sem prioridade"
 *     engoliria o quadro.
 *
 * `status.type` é o único conjunto fechado e idêntico entre listas, e é FASE e
 * não procedência. Custa dois campos no mapper e ZERO chamada de rede — ele já
 * vinha na listagem e estava sendo descartado.
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
 * Esconder este aqui contrariaria a decisão registrada em `TasksView`, de que
 * ler tarefa do trabalho no celular é onde a integração mais serve.
 */

const COLUNAS: { fase: FaseClickUp; titulo: string; vazia: string }[] = [
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

      (Ela não foi removida porque a fase `done`, se o workspace usar esse tipo,
      cai aqui e apareceria. Como a integração nunca falou com a API real, tirar
      a coluna seria apostar no sentido contrário.)
    */
    vazia: "Concluídas não são trazidas — a listagem pede só as abertas.",
  },
];

export function ClickUpQuadro({
  tarefas,
  aoAbrir,
}: {
  tarefas: TarefaClickUp[];
  aoAbrir: (tarefa: TarefaClickUp) => void;
}) {
  // O agrupamento é puro e mora em `mapper.ts`, onde é testado — inclusive a
  // parte que decide que `done` cai em "Concluído".
  const porFase = useMemo(() => agruparPorFase(tarefas), [tarefas]);

  // Um "agora" só para o quadro inteiro — ver a prop `agora` de `CartaoClickUp`.
  const agora = Date.now();

  return (
    <QuadroGrade>
      {COLUNAS.map((coluna) => {
        const daColuna = porFase.get(coluna.fase) ?? [];
        return (
          <QuadroColuna key={coluna.fase} titulo={coluna.titulo} contagem={daColuna.length}>
            {daColuna.length === 0 ? (
              <QuadroColunaVazia>{coluna.vazia}</QuadroColunaVazia>
            ) : (
              daColuna.map((t) => (
                <CartaoClickUp
                  key={t.id}
                  tarefa={t}
                  aoAbrir={() => aoAbrir(t)}
                  agora={agora}
                  compacto
                />
              ))
            )}
          </QuadroColuna>
        );
      })}
    </QuadroGrade>
  );
}
