import "server-only";

import { obterTarefa } from "@/lib/clickup/client";
import { ErroClickUp } from "@/lib/clickup/erros";
import type { TarefaCrua } from "@/lib/clickup/types";

/**
 * ⭐ A INVARIANTE I3 — toda escrita verifica a responsabilidade antes.
 *
 * ============================================================================
 * POR QUE ISTO NÃO É OPCIONAL
 * ============================================================================
 * `"use server"` NÃO é fronteira de confiança. O Next publica um id para cada
 * função exportada, e qualquer um com esse id manda POST direto — sem passar
 * pelo componente, pelo botão desabilitado ou pela lista que a tela desenhou.
 * É o mesmo raciocínio que já está no cabeçalho de `src/lib/rate-limit.ts`.
 *
 * Consequência concreta: `mudarStatusClickUp(taskId, status)` pode ser chamada
 * com QUALQUER `taskId` do workspace — inclusive o de uma tarefa de um colega.
 * O token não ajuda: ele é pessoal e tem permissão para mexer em tudo que a
 * pessoa pode mexer, que numa empresa costuma ser bastante coisa.
 *
 * Sem esta verificação, "o aplicativo só altera tarefas das quais sou
 * responsável" é uma frase sobre a interface, não sobre o sistema. Com ela,
 * vira propriedade do servidor.
 *
 * ============================================================================
 * O CUSTO, E POR QUE ELE É O PONTO
 * ============================================================================
 * Um GET a mais por escrita. É isso que se paga, e é barato pelo que compra.
 * A tarefa lida é DEVOLVIDA para o chamador justamente para o custo não
 * dobrar: `mudarStatus` já precisa dela para descobrir a lista e validar o
 * status contra os status daquela lista.
 *
 * ============================================================================
 * FALHA FECHADA
 * ============================================================================
 * Erro de rede na verificação → RECUSA. Nunca "não deu para checar, então
 * segue". Em dúvida sobre autorização, fechar é o único modo de falha
 * aceitável: o custo de recusar uma operação legítima é o usuário clicar de
 * novo; o custo de permitir uma ilegítima é escrever na tarefa de outra pessoa.
 *
 * `obterTarefa` lança `ErroClickUp` em qualquer falha (404, 401, timeout), e
 * esta função não captura nada — deixar propagar É a falha fechada. Um
 * `try/catch` aqui que devolvesse `true` seria o defeito.
 */
export async function garantirResponsavel(
  token: string,
  taskId: string,
  meuClickUpId: string,
): Promise<TarefaCrua> {
  const tarefa = await obterTarefa(token, taskId);

  const responsaveis = tarefa.assignees ?? [];
  // Comparação por STRING: a API devolve o id como número em algumas rotas e
  // como string em outras. `===` entre 12345 e "12345" é false, e o efeito
  // seria recusar todas as escritas com uma mensagem que culpa a atribuição.
  const meu = String(meuClickUpId);
  const souResponsavel = responsaveis.some((r) => String(r?.id) === meu);

  if (!souResponsavel) {
    throw new ErroClickUp(
      "nao_sou_responsavel",
      "A tarefa não tem este usuário entre os responsáveis.",
    );
  }

  return tarefa;
}
