import type { Project } from "@/lib/database.types";

/**
 * O seletor de projeto dos formulários que ATRIBUEM projeto.
 *
 * ⚠️ NÃO APARECE quando não há projeto nenhum. Um `<select>` com a única opção
 * "Sem projeto" é uma pergunta cuja resposta já se sabe, e ocupa a mesma altura
 * de um campo útil. Quem não usa o módulo não paga por ele no formulário de
 * tarefa.
 *
 * Sai um `<select name="projectId">` de formulário nativo, sem estado, porque é
 * assim que `TaskForm` e a captura já mandam os outros campos — `FormData` do
 * `<form>` inteiro. Um componente controlado aqui exigiria levantar estado nos
 * dois formulários para não ganhar nada.
 *
 * `""` é a opção "sem projeto", e `projectIdOpcional` a converte em `null`. Ver
 * o comentário daquele schema: sem o `.or(z.literal(""))`, escolher "Sem
 * projeto" viraria erro de validação em vez de limpar a atribuição.
 */
export function SeletorDeProjeto({
  projetos,
  valorInicial,
  id = "projectId",
}: {
  projetos: Project[];
  valorInicial?: string | null;
  id?: string;
}) {
  if (projetos.length === 0) return null;

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-corpo font-medium text-ink">
        Projeto
      </label>
      <select
        id={id}
        name="projectId"
        defaultValue={valorInicial ?? ""}
        className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2"
      >
        <option value="">Sem projeto</option>
        {projetos.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}
