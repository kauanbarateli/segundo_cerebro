import type { IconName } from "@/components/ui/Icons";

/**
 * O VOCABULÁRIO DAS QUATRO COISAS QUE UM PROJETO AGRUPA.
 *
 * ============================================================================
 * ⚠️ ANEXAR É UM `UPDATE`, NUNCA UMA CÓPIA — e é isso que o nome "vincular" diz
 * ============================================================================
 * A 0017 pôs `project_id` em `tasks`, `captures`, `knowledge_notebooks` e
 * `drive_folders`. O vínculo é uma COLUNA no próprio item, então "pôr a tarefa
 * no projeto" é gravar um uuid na linha que já existe: a tarefa continua sendo
 * A MESMA, vista de outro lugar. Desvincular é `project_id = null`.
 *
 * Daí a palavra na interface ser "Vincular" e não "Adicionar". "Adicionar"
 * sugere que algo novo passa a existir aqui dentro, e a pessoa fica com a
 * dúvida legítima de estar duplicando informação — que é exatamente o que este
 * desenho não faz.
 *
 * ============================================================================
 * ⚠️ O ALVO DO VÍNCULO É O CONTÊINER, NUNCA O ITEM
 * ============================================================================
 * Cadernos e pastas estão nesta lista; PÁGINAS e ARQUIVOS não estão, e a
 * ausência é decisão de modelo (ver o cabeçalho da 0017). A página já tem
 * `notebook_id not null` mais uma árvore com invariante própria; um segundo
 * contêiner ali permitiria a página mãe no projeto A com a filha no projeto B.
 * Como a coluna fica no caderno, "o conhecimento do projeto" são as páginas dos
 * cadernos do projeto — de graça, sem coluna nova e sem trigger de árvore.
 *
 * ============================================================================
 * POR QUE ESTE ARQUIVO EXISTE, EM VEZ DE DUAS LISTAS
 * ============================================================================
 * A mesma lista é necessária no SERVIDOR (qual tabela receber o `update`, quais
 * rotas revalidar) e no CLIENTE (título da seção, ícone, rótulo do botão).
 * Escritas em dois lugares, elas divergem em silêncio no dia em que uma quinta
 * tabela ganhar a coluna: a busca acharia candidatos que o vínculo não saberia
 * gravar.
 *
 * O arquivo NÃO tem `"use client"` de propósito — ele é importado tanto pela
 * Server Action quanto pelos componentes de cliente, e uma diretiva aqui
 * transformaria o `import` do servidor numa referência de cliente.
 */

export type TipoAnexavel = "tarefa" | "captura" | "caderno" | "pasta";

/** A ordem em que as seções aparecem na tela do projeto. */
export const TIPOS_ANEXAVEIS: TipoAnexavel[] = ["tarefa", "captura", "caderno", "pasta"];

export interface DefinicaoDeAnexavel {
  /** A tabela que tem a coluna `project_id`. É o alvo do `update`. */
  tabela: string;
  singular: string;
  plural: string;
  /**
   * Artigo definido do singular. Existe para as frases da interface saírem
   * concordadas ("a tarefa continua onde está", "o caderno continua onde está")
   * sem um `tipo === "caderno" ? "o" : "a"` espalhado por três componentes —
   * que é o tipo de condicional que alguém esquece de atualizar quando um
   * quinto tipo entrar.
   */
  artigo: "o" | "a";
  /** Título da seção. Nem sempre é o plural: cadernos vivem em "Conhecimento". */
  tituloDaSecao: string;
  /**
   * Nome do módulo de origem, como ele aparece na barra lateral. Separado do
   * título da seção porque os dois divergem: a seção "Pastas" da tela do projeto
   * é o módulo "Drive". Mandar alguém procurar em "Pastas" seria mandá-la
   * procurar um item de menu que não existe.
   */
  modulo: string;
  /** Já concordado em gênero — "Nova tarefa", "Novo caderno". */
  rotuloDeCriar: string;
  icone: IconName;
  rotaDoModulo: string;
  /**
   * Rotas cujo cache cai quando o vínculo muda. A tela do projeto entra
   * sozinha, em `revalidar()`; aqui ficam as do MÓDULO de origem, que também
   * mostram o projeto do item e ficariam mentindo até o próximo refresh.
   */
  rotasParaRevalidar: string[];
  /** Frase da seção vazia. */
  vazio: string;
}

export const ANEXAVEL: Record<TipoAnexavel, DefinicaoDeAnexavel> = {
  tarefa: {
    tabela: "tasks",
    singular: "tarefa",
    artigo: "a",
    plural: "tarefas",
    tituloDaSecao: "Tarefas",
    modulo: "Tarefas",
    rotuloDeCriar: "Nova tarefa",
    icone: "Tasks",
    rotaDoModulo: "/tarefas",
    // "/" entra porque a tela inicial lista tarefas do dia.
    rotasParaRevalidar: ["/tarefas", "/"],
    vazio: "Nenhuma tarefa neste projeto.",
  },
  captura: {
    tabela: "captures",
    singular: "captura",
    artigo: "a",
    plural: "capturas",
    tituloDaSecao: "Capturas",
    modulo: "Capturar",
    rotuloDeCriar: "Nova captura",
    icone: "Inbox",
    rotaDoModulo: "/capturar",
    rotasParaRevalidar: ["/capturar", "/"],
    vazio: "Nenhuma captura neste projeto.",
  },
  caderno: {
    tabela: "knowledge_notebooks",
    singular: "caderno",
    artigo: "o",
    plural: "cadernos",
    tituloDaSecao: "Conhecimento",
    modulo: "Conhecimento",
    rotuloDeCriar: "Novo caderno",
    icone: "Book",
    rotaDoModulo: "/conhecimento",
    rotasParaRevalidar: ["/conhecimento"],
    vazio: "Nenhum caderno neste projeto.",
  },
  pasta: {
    tabela: "drive_folders",
    singular: "pasta",
    artigo: "a",
    plural: "pastas",
    tituloDaSecao: "Pastas",
    modulo: "Drive",
    rotuloDeCriar: "Nova pasta",
    icone: "Folder",
    rotaDoModulo: "/drive",
    rotasParaRevalidar: ["/drive"],
    vazio: "Nenhuma pasta neste projeto.",
  },
};

/**
 * Um candidato a vínculo, já reduzido ao que a lista de escolha precisa.
 *
 * `projetoAtual` é o NOME do projeto onde o item está agora, ou `null` para
 * "sem projeto". Ele existe para a interface poder AVISAR antes de gravar: como
 * `project_id` é uma coluna só, vincular um item que já está em outro projeto
 * o MOVE — não o coloca nos dois. Esconder isso faria o vínculo tirar o item de
 * um lugar sem ninguém ter pedido.
 *
 * ⚠️ Projeto APAGADO chega aqui como `null`, e não com o nome do projeto morto:
 * o soft delete não zera `project_id` (ver `deleteProject`), então a linha ainda
 * aponta para ele — mas a tela inteira trata projeto apagado como "sem projeto",
 * e um aviso "vai sair de «Reforma»" citando um projeto que já não aparece em
 * lugar nenhum seria uma contradição visível.
 */
export interface ItemAnexavel {
  id: string;
  rotulo: string;
  projetoAtual: string | null;
}
