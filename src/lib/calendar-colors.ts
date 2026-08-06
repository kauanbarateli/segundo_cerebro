/**
 * A COR DE CADA CONTA DO CALENDÁRIO.
 *
 * ============================================================================
 * POR QUE `slot`, E NÃO `color_key` NEM `background_color`
 * ============================================================================
 * Havia três chaves candidatas, e duas são armadilhas:
 *
 * `calendar_accounts.color_key` existe desde a 0001 com default `'graphite'` —
 * e o callback do OAuth NUNCA a grava. As duas contas ficam com o mesmo valor,
 * que por definição não distingue nada. Não existe tradutor de `color_key` para
 * classe em lugar nenhum do projeto, então usá-la significaria escrever o
 * tradutor E mudar o callback para chegar no mesmo resultado visual daqui.
 *
 * `calendar_sources.background_color` vem do Google e É GRAVADA — mas é por
 * CALENDÁRIO, não por conta. Uma conta de trabalho com seis calendários daria
 * seis cores, o que responde outra pergunta. Pior: é hex escolhido para a
 * interface branca do Google, sem garantia de contraste no tema escuro daqui.
 *
 * `slot` é a única chave `not null`, estável, e limitada a EXATAMENTE dois
 * valores pelo próprio banco (`check (slot in (1, 2))` + unique por usuário, na
 * 0001). Dois valores possíveis significa duas cores fixas: sem paleta, sem
 * algoritmo de distribuição, sem tela de escolha, sem migration.
 *
 * ============================================================================
 * ⚠️ A REGRA QUE NÃO SE NEGOCIA: NUNCA SÓ POR COR
 * ============================================================================
 * `CalendarViews.tsx` já tinha isso escrito antes desta função existir. A cor
 * ACOMPANHA o rótulo textual da conta — ela nunca o substitui. Quem não
 * distingue as duas cores continua lendo "Pessoal" e "Trabalho" na tela.
 *
 * Onde não cabe rótulo (a visão de MÊS), a cor vem com `title` e um `sr-only`
 * dizendo de qual conta é. Sem isso, o mês seria o único lugar do aplicativo em
 * que a cor é o único diferenciador.
 *
 * ============================================================================
 * A ESCOLHA DAS DUAS CORES — agora nomeadas pelo DS
 * ============================================================================
 * VERMELHO E ÂMBAR ESTÃO PROIBIDOS AQUI: eles são `danger` e `warning`, e já
 * significam erro e aviso no sistema inteiro. Uma conta pintada de vermelho
 * faria toda reunião dela parecer um problema.
 *
 * O par usado é `work` (#20B8A5) e `personal` (#8B5CF6) — os dois tokens que o
 * DS §7 reserva exatamente para isto. Eram `teal-500` e `violet-500` da paleta
 * crua do Tailwind, e a coincidência é quase total: `violet-500` É `#8B5CF6`,
 * e `teal-500` (#14B8A6) fica a dois pontos do teal do DS. A troca não muda o
 * que está na tela; muda o fato de a cor passar a ter NOME e a acompanhar o
 * tema por conta própria.
 *
 * O que a tokenização de verdade resolve: as variantes `dark:` sumiram daqui.
 * Antes cada tom precisava de um degrau escrito à mão (`dark:bg-teal-400`)
 * porque a saturação que funciona sobre papel branco some sobre superfície
 * escura. Agora `--sb-work` e `--sb-personal` já trocam de valor em `.dark`,
 * medidos contra o piso de AA — ver o bloco das semânticas em globals.css.
 *
 * Registrando com honestidade: o par mais seguro para daltonismo seria azul e
 * laranja, e ele não está disponível porque âmbar significa aviso. Isto é
 * aceitável AQUI, e só aqui, porque a cor nunca carrega a informação sozinha —
 * ver o bloco acima.
 *
 * `texto` usa o degrau `-ink` e não o cheio: o teal do DS tem 2.48 de contraste
 * sobre branco e seria ilegível como texto. `trilho` e `ponto` usam o cheio,
 * que é o papel para o qual ele foi desenhado.
 */

export interface TomDaConta {
  /** Barra na borda esquerda do cartão ou do chip. */
  trilho: string;
  /** Bolinha antes do rótulo textual da conta. */
  ponto: string;
  /** Texto colorido, para a pill de filtro que serve de legenda. */
  texto: string;
}

const TONS: Record<1 | 2, TomDaConta> = {
  1: {
    trilho: "border-l-2 border-l-work",
    ponto: "bg-work",
    texto: "text-work-ink",
  },
  2: {
    trilho: "border-l-2 border-l-personal",
    ponto: "bg-personal",
    texto: "text-personal-ink",
  },
};

/**
 * O tom da conta, ou `null` quando não há como saber.
 *
 * ⚠️ As classes são LITERAIS no objeto acima de propósito. O Tailwind varre o
 * código-fonte procurando nomes de classe inteiros; `bg-teal-${n}` montado em
 * tempo de execução não é encontrado e a cor simplesmente não existe no CSS
 * final — sem erro, sem aviso, e só na build de produção.
 *
 * `null` para qualquer slot fora de {1, 2}: o banco já garante que não acontece,
 * mas devolver um tom inventado seria pintar de teal uma terceira conta que
 * ninguém sabe que existe.
 */
export function tomDaConta(slot: number | null | undefined): TomDaConta | null {
  if (slot === 1 || slot === 2) return TONS[slot];
  return null;
}

/**
 * O rótulo textual da conta — a metade que a cor acompanha, nunca substitui.
 *
 * Mora aqui junto do tom para que as duas coisas saiam do mesmo lugar. Estava
 * duplicado em `CalendarViews` e na página Início, e duplicata de rótulo é como
 * uma tela passa a chamar a mesma conta de dois nomes.
 */
export function rotuloDaConta(
  conta: { display_name: string | null; slot: number } | null | undefined,
): string | undefined {
  if (!conta) return undefined;
  return conta.display_name ?? `Conta ${conta.slot}`;
}
