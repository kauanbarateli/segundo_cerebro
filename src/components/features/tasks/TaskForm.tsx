"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { Category, Project, Task } from "@/lib/database.types";
import { SeletorDeProjeto } from "@/components/features/projects/SeletorDeProjeto";
import { createTask, updateTask } from "@/app/(app)/tarefas/actions";
import { CLASSE_DO_CAMPO, CLASSE_DO_CAMPO_MULTILINHA } from "@/components/ui/estilos";
import { cn } from "@/lib/utils";
import { paraCampoLocal } from "@/lib/tempo";

const PRIORITIES = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Urgente" },
];

/**
 * Parte um instante guardado nas duas metades que o formulário edita.
 *
 * A separação é o que corrige o terceiro defeito do trio de data (ver
 * `src/lib/tempo.ts` para os outros dois). Os campos eram NÃO CONTROLADOS, e
 * alternar "Dia inteiro" troca o `type` do MESMO nó do DOM: o navegador
 * revalida, descarta o valor que virou incompatível, e `defaultValue` não o
 * repõe — ele só age na montagem. Marcar e desmarcar a caixa perdia o que
 * tinha sido digitado.
 *
 * Guardando dia e hora em estados separados, a troca de `type` deixa de ser uma
 * perda: o dia continua no estado e só a hora é descartada, que é exatamente o
 * que "dia inteiro" significa.
 */
function partirInstante(iso: string | null | undefined): { dia: string; hora: string } {
  const completo = paraCampoLocal(iso, "datetime");
  if (!completo) return { dia: "", hora: "" };
  const [dia, hora] = completo.split("T");
  return { dia: dia ?? "", hora: hora ?? "" };
}

/**
 * Remonta o valor para o campo, no formato que AQUELE `type` aceita.
 *
 * `<input type="date">` só aceita 10 caracteres e `datetime-local` só aceita 16.
 * Entregar o formato errado não dá erro: o navegador esvazia o campo em
 * silêncio, que era o defeito visível ao marcar "Dia inteiro" numa tarefa que já
 * tinha data.
 */
function juntarInstante(dia: string, hora: string, diaInteiro: boolean): string {
  if (!dia) return "";
  return diaInteiro ? dia : `${dia}T${hora || "00:00"}`;
}

/**
 * Lê o que o campo devolveu, seja ele `date` ou `datetime-local`.
 *
 * `horaAnterior` é o que preserva a hora ao voltar de "Dia inteiro": no modo
 * data o campo não tem hora nenhuma para informar, e sem esta memória desmarcar
 * a caixa devolveria 00:00 no lugar do horário que a pessoa tinha escolhido.
 */
function partirCampo(valor: string, horaAnterior: string): { dia: string; hora: string } {
  if (!valor) return { dia: "", hora: horaAnterior };
  const [dia, hora] = valor.split("T");
  return { dia: dia ?? "", hora: hora ?? horaAnterior };
}

export function TaskForm({
  categories,
  projetos = [],
  projetoInicial,
  task,
  onDone,
  onCancel,
}: {
  categories: Category[];
  /**
   * Os projetos vivos. Vazio (o padrão) some com o seletor — ver
   * `SeletorDeProjeto`. O default existe para que quem não passa a lista não
   * quebre: o campo simplesmente não aparece, e `projectId` chega ausente ao
   * schema, que o traduz para `null`.
   */
  projetos?: Project[];
  /**
   * Projeto já escolhido ao ABRIR o formulário — é o "Criar aqui" da tela de um
   * projeto, que abre este mesmo formulário com o campo preenchido.
   *
   * ⚠️ Três coisas que esta prop deliberadamente NÃO faz:
   *
   *   1. Não muda nada quando não vem. Sem ela o seletor continua começando
   *      em "Sem projeto" na criação, como sempre começou.
   *   2. Não vence o projeto da tarefa em EDIÇÃO (ver o `??` lá embaixo).
   *      Abrir uma tarefa que está no projeto A a partir da tela do projeto B
   *      e vê-la mudar sozinha para B seria reescrever uma decisão do usuário
   *      só porque ele foi olhar.
   *   3. Não TRAVA o campo. O seletor continua editável, e trocar ali dentro
   *      vale: o valor é apenas o ponto de partida. Um campo travado exigiria
   *      explicar por que ele está travado, e a explicação seria "porque você
   *      clicou naquele botão" — que a pessoa já sabe.
   */
  projetoInicial?: string | null;
  task?: Task;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [allDay, setAllDay] = useState(task?.all_day ?? false);
  const [vencimento, setVencimento] = useState(() => partirInstante(task?.due_at));
  const [agendado, setAgendado] = useState(() => partirInstante(task?.scheduled_start_at));

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = task ? await updateTask(task.id, formData) : await createTask(formData);
      if (result.ok) {
        toast(task ? "Tarefa atualizada" : "Tarefa criada", "success");
        onDone();
      } else {
        setError(result.error ?? "Erro ao salvar");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="title" className="mb-1.5 block text-corpo font-medium text-ink">
          Título
        </label>
        <input
          id="title"
          name="title"
          required
          defaultValue={task?.title ?? ""}
          className={cn(CLASSE_DO_CAMPO, "w-full")}
        />
      </div>

      <div>
        <label htmlFor="description" className="mb-1.5 block text-corpo font-medium text-ink">
          Descrição
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={task?.description ?? ""}
          className={cn(CLASSE_DO_CAMPO_MULTILINHA, "w-full")}
        />
      </div>

      {/*
        `grid-cols-1 sm:grid-cols-2`, e não `grid-cols-2` seco: este formulário
        vive dentro de um `Modal`, que no celular sobra ~310px de largura útil.
        Duas colunas ali dão ~145px cada — largura em que o `<select>` de
        categoria corta o nome no segundo caractere e o seletor de projeto fica
        inutilizável. É a mesma conta já escrita no cabeçalho de
        `FinanceForms.tsx`, e a mesma correção.
      */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="categoryId" className="mb-1.5 block text-corpo font-medium text-ink">
            Categoria
          </label>
          <select
            id="categoryId"
            name="categoryId"
            defaultValue={task?.category_id ?? ""}
            className={cn(CLASSE_DO_CAMPO, "w-full")}
          >
            <option value="">Sem categoria</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {/* Projeto é faceta ORTOGONAL à categoria, e por isso fica ao lado e
            não dentro dela: uma tarefa de "Trabalho" pode estar no projeto
            "Migração" ou em nenhum, e as duas perguntas são independentes. */}
        {/* O teste é `task ?`, e NÃO `task?.project_id ?? projetoInicial`. A
            diferença aparece na tarefa que está sendo EDITADA e não tem
            projeto: com `??`, o `null` dela cairia no valor inicial e o
            formulário passaria a sugerir o projeto de onde o clique veio —
            transformando "esta tarefa não tem projeto" em "tem". Editar mostra
            o que a tarefa diz, inclusive quando ela diz nada. */}
        <SeletorDeProjeto
          projetos={projetos}
          valorInicial={task ? task.project_id : projetoInicial}
        />
        <div>
          <label htmlFor="priority" className="mb-1.5 block text-corpo font-medium text-ink">
            Prioridade
          </label>
          <select
            id="priority"
            name="priority"
            defaultValue={task?.priority ?? "medium"}
            className={cn(CLASSE_DO_CAMPO, "w-full")}
          >
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Mesma razão do par acima — e aqui é pior, porque os dois campos são de
          data: o seletor nativo do celular precisa da largura para caber
          "dd/mm/aaaa --:--" sem reticências. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="dueAt" className="mb-1.5 block text-corpo font-medium text-ink">
            Vencimento
          </label>
          <input
            id="dueAt"
            name="dueAt"
            type={allDay ? "date" : "datetime-local"}
            value={juntarInstante(vencimento.dia, vencimento.hora, allDay)}
            onChange={(e) => setVencimento(partirCampo(e.target.value, vencimento.hora))}
            className={cn(CLASSE_DO_CAMPO, "w-full")}
          />
        </div>
        <div>
          <label htmlFor="scheduledStartAt" className="mb-1.5 block text-corpo font-medium text-ink">
            Horário agendado
          </label>
          <input
            id="scheduledStartAt"
            name="scheduledStartAt"
            type={allDay ? "date" : "datetime-local"}
            value={juntarInstante(agendado.dia, agendado.hora, allDay)}
            onChange={(e) => setAgendado(partirCampo(e.target.value, agendado.hora))}
            className={cn(CLASSE_DO_CAMPO, "w-full")}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-corpo text-ink-muted">
        <input
          type="checkbox"
          name="allDay"
          value="true"
          checked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
          className="h-4 w-4 rounded-xs border-line-strong"
        />
        Dia inteiro
      </label>

      {error && (
        <p role="alert" className="text-corpo text-danger-ink">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel} type="button">
          Cancelar
        </Button>
        <Button variant="primary" size="sm" type="submit" disabled={pending}>
          {pending ? "Salvando…" : task ? "Salvar" : "Criar tarefa"}
        </Button>
      </div>
    </form>
  );
}
