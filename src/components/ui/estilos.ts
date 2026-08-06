/**
 * Classes compartilhadas entre componentes que precisam PARECER a mesma coisa
 * sem SEREM a mesma coisa.
 *
 * ⚠️ Este arquivo não importa nada, e é o ponto dele.
 *
 * A primeira constante daqui nasceu dentro de `PageHeader.tsx`, que é Componente
 * de Servidor. Importá-la de um componente de cliente arrastaria o módulo inteiro
 * para o pacote do navegador — `ThemeToggle`, `Avatar`, `Link` e o cabeçalho
 * junto — por causa de uma string. Um módulo sem dependências não arrasta nada.
 *
 * Pelo mesmo motivo elas são STRINGS e não componentes: um `<Campo />` teria que
 * repassar `ref`, `type`, `value`, `onChange`, `rows`, `pattern`, `inputMode` e
 * mais uma dúzia de props que cada um dos ~40 campos do produto usa de um jeito
 * diferente. A aparência é o que se compartilha; o mecanismo, não.
 */

/**
 * O CAMPO PADRÃO — DS §7 ("Inputs").
 *
 * 52px de altura, 12px de raio, borda `line`, placeholder `ink-muted`, texto em
 * 16px. Cada um desses números estava escrito à mão em mais de quarenta lugares,
 * com TRÊS alturas diferentes (h-9, h-10, h-11) e duas bordas (`line` e
 * `line-strong`) — o suficiente para dois campos vizinhos, no mesmo formulário,
 * não se parecerem.
 *
 * Por que 16px de texto e não 14: além de ser o Body do DS §4, é o piso abaixo do
 * qual o Safari do iOS DÁ ZOOM ao focar o campo. O zoom não volta sozinho, e a
 * pessoa termina de preencher o formulário com a página deslocada de lado.
 *
 * `w-full` NÃO entra aqui: largura é decisão do layout onde o campo está, e
 * embutir obrigaria metade dos usos a desfazer com `max-w-*`. Quem quer largura
 * total escreve `cn(CLASSE_DO_CAMPO, "w-full")`.
 *
 * O foco não aparece nesta string: ele vem da regra global `:focus-visible` de
 * globals.css, que já implementa a borda + anel de 3px do DS §7. Repetir aqui
 * criaria uma segunda definição para divergir da primeira.
 */
export const CLASSE_DO_CAMPO =
  "h-13 rounded-md border border-line bg-surface px-4 text-corpo text-ink " +
  "placeholder:text-ink-muted disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled";

/**
 * A variante de várias linhas. Mesma moldura, sem altura fixa — a altura de um
 * `<textarea>` vem do atributo `rows`, e um `h-13` aqui brigaria com ele.
 */
export const CLASSE_DO_CAMPO_MULTILINHA =
  "rounded-md border border-line bg-surface px-4 py-3 text-corpo text-ink " +
  "placeholder:text-ink-muted disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled";

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
 * O `pl-11` reserva o espaço do ícone de lupa, que é posicionado por cima. Ele
 * cresceu junto com o campo: com 52px de altura e a lupa de 20px, os 36px do
 * `pl-9` deixavam o texto digitado encostando no ícone.
 */
export const CLASSE_DO_CAMPO_DE_BUSCA =
  "h-13 w-full rounded-md border border-line bg-surface pl-11 pr-4 text-corpo text-ink " +
  "placeholder:text-ink-muted";
