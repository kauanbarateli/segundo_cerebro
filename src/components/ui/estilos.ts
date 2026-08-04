/**
 * Classes compartilhadas entre componentes que precisam PARECER a mesma coisa
 * sem SEREM a mesma coisa.
 *
 * ⚠️ Este arquivo não importa nada, e é o ponto dele.
 *
 * A constante abaixo nasceu dentro de `PageHeader.tsx`, que é Componente de
 * Servidor. Importá-la de um componente de cliente arrastaria o módulo inteiro
 * para o pacote do navegador — `ThemeToggle`, `Avatar`, `Link` e o cabeçalho
 * junto — por causa de uma string. Um módulo sem dependências não arrasta nada.
 */

/**
 * O campo de busca do cabeçalho.
 *
 * As duas buscas do aplicativo funcionam de jeitos DIFERENTES de propósito: em
 * `/conhecimento` o termo mora na URL e quem procura é o Postgres; em
 * `/tarefas` mora no cliente e nada vai ao servidor. Forçar um componente comum
 * acabaria em props condicionais que só servem a um dos dois casos. Compartilhar
 * a aparência, e só ela, é o que mantém as duas parecidas na tela sem acoplar o
 * mecanismo.
 *
 * O `pl-9` reserva o espaço do ícone de lupa, que é posicionado por cima.
 */
export const CLASSE_DO_CAMPO_DE_BUSCA =
  "h-10 w-full rounded-md border border-line-strong bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline-2";
