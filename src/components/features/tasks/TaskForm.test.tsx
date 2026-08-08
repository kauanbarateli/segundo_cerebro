// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { Task } from "@/lib/database.types";

/**
 * ============================================================================
 * POR QUE ESTE ARQUIVO EXISTE
 * ============================================================================
 * O defeito que ele cobre NÃO É ALCANÇÁVEL por teste unitário, e essa é a razão
 * de pagar o custo de montar um componente.
 *
 * Os campos de data eram NÃO CONTROLADOS (`defaultValue`), e "Dia inteiro" troca
 * o `type` do MESMO nó do DOM entre `date` e `datetime-local`. Quem apaga o
 * valor nessa troca é o NAVEGADOR: ele revalida o campo, vê que "2026-08-07T14:00"
 * não é um `date` legal, descarta — e `defaultValue` não repõe, porque só age na
 * montagem. Nada disso está no `validation.ts`, no schema ou em qualquer função
 * pura: está na interação entre o React, o `type` e o parser do navegador.
 *
 * Um teste de `taskInputSchema` passaria com o defeito inteiro presente.
 *
 * ⚠️ O jsdom implementa a normalização de `type=date`? Se não implementasse,
 * este teste passaria vazio — o mesmo risco do `window.next` em `Editor.test.tsx`.
 * Por isso o primeiro teste do arquivo AFIRMA a mecânica do navegador antes de
 * afirmar qualquer coisa sobre o formulário: se o jsdom parar de reproduzi-la,
 * ele quebra e avisa, em vez de virar um teste que não testa nada.
 */

/**
 * Server Actions: importá-las de verdade arrastaria o cliente do Supabase e
 * `next/cache` para dentro do teste. Nada aqui chega a submeter.
 */
vi.mock("@/app/(app)/tarefas/actions", () => ({
  createTask: vi.fn(async () => ({ ok: true as const })),
  updateTask: vi.fn(async () => ({ ok: true as const })),
}));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const RAIZES: HTMLElement[] = [];

afterEach(() => {
  for (const raiz of RAIZES.splice(0)) raiz.remove();
  vi.restoreAllMocks();
});

/**
 * Uma tarefa com hora marcada: 07/08/2026 às 14h em São Paulo (17h UTC).
 *
 * Tipada como `Task` de verdade, e não `as never`: a fixture é o contrato entre
 * este teste e o componente, e um `never` deixaria de avisar no dia em que a
 * coluna mudar de nome — o teste continuaria compilando e passaria a montar um
 * formulário sem data, afirmando sobre nada.
 */
const TAREFA: Task = {
  id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  project_id: null,
  category_id: null,
  title: "Revisar proposta",
  description: null,
  status: "todo",
  priority: "medium",
  due_at: "2026-08-07T17:00:00.000Z",
  scheduled_start_at: "2026-08-07T17:00:00.000Z",
  scheduled_end_at: null,
  all_day: false,
  estimated_minutes: null,
  source: "manual",
  completed_at: null,
  archived_at: null,
  board_position: null,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
};

async function montarFormulario(task?: Task) {
  const { createRoot } = await import("react-dom/client");
  const { TaskForm } = await import("./TaskForm");
  const { ToastProvider } = await import("@/components/ui/Toast");

  const raiz = document.createElement("div");
  document.body.append(raiz);
  RAIZES.push(raiz);

  const root = createRoot(raiz);
  await act(async () => {
    root.render(
      <ToastProvider>
        <TaskForm categories={[]} task={task} onDone={() => {}} onCancel={() => {}} />
      </ToastProvider>,
    );
  });

  const campo = (nome: string) => raiz.querySelector<HTMLInputElement>(`input[name="${nome}"]`)!;
  const diaInteiro = () => campo("allDay");

  /**
   * `.click()` de verdade, e NÃO `checked = !checked` seguido de um evento.
   *
   * O React guarda um rastreador do valor de cada campo controlado para não
   * re-renderizar à toa. Mexer em `.checked` na mão atualiza esse rastreador
   * junto, então o evento seguinte chega parecendo "nada mudou" e o `onChange`
   * nunca dispara — os testes passariam a afirmar sobre um formulário que nunca
   * saiu do estado inicial. `.click()` deixa o próprio jsdom alternar o campo,
   * que é o caminho pelo qual o React espera a mudança.
   */
  async function alternarDiaInteiro() {
    await act(async () => {
      diaInteiro().click();
    });
  }

  /**
   * Escreve num campo controlado pelo React.
   *
   * Pelo mesmo motivo de `alternarDiaInteiro`, `input.value = x` não serve: o
   * React instala um rastreador NA INSTÂNCIA, então a atribuição direta atualiza
   * o valor antigo junto e o `onChange` é engolido. Chamar o setter do
   * PROTOTYPE passa por baixo desse rastreador — ele continua guardando o valor
   * anterior, vê a diferença quando o evento sobe, e dispara. É o caminho que a
   * própria Testing Library usa por dentro.
   */
  async function digitar(nome: string, valor: string) {
    const alvo = campo(nome);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(alvo, valor);
      alvo.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  return { raiz, campo, alternarDiaInteiro, digitar };
}

describe("o navegador (jsdom) reproduz a mecânica do defeito", () => {
  /**
   * Se esta afirmação falhar, os testes abaixo perdem o sentido — não porque o
   * formulário quebrou, mas porque o ambiente parou de reproduzir a condição.
   */
  it("um input type=date DESCARTA um valor de 16 caracteres", () => {
    const input = document.createElement("input");
    input.type = "date";
    input.value = "2026-08-07T14:00";
    expect(input.value).toBe("");

    input.value = "2026-08-07";
    expect(input.value).toBe("2026-08-07");
  });
});

describe("TaskForm — data e hora", () => {
  it("mostra a data salva no formato que CADA type aceita", async () => {
    const { campo, alternarDiaInteiro } = await montarFormulario(TAREFA);

    // datetime-local: 16 caracteres, no fuso do app (17h UTC = 14h em SP).
    expect(campo("scheduledStartAt").value).toBe("2026-08-07T14:00");

    await alternarDiaInteiro();

    // date: 10 caracteres. Antes chegavam 16 aqui e o campo aparecia VAZIO,
    // apagando visualmente uma data que estava salva.
    expect(campo("scheduledStartAt").type).toBe("date");
    expect(campo("scheduledStartAt").value).toBe("2026-08-07");
  });

  it("marcar e desmarcar 'Dia inteiro' PRESERVA a data e a hora", async () => {
    const { campo, alternarDiaInteiro } = await montarFormulario(TAREFA);

    expect(campo("dueAt").value).toBe("2026-08-07T14:00");

    await alternarDiaInteiro();
    await alternarDiaInteiro();

    // O ciclo completo é o defeito A3: com campos não controlados, os dois
    // campos voltavam VAZIOS aqui, e a tarefa era salva sem data nenhuma.
    expect(campo("dueAt").value).toBe("2026-08-07T14:00");
    expect(campo("scheduledStartAt").value).toBe("2026-08-07T14:00");
  });

  it("preserva o que o usuário DIGITOU, não só o que veio salvo", async () => {
    const { campo, alternarDiaInteiro, digitar } = await montarFormulario();

    await digitar("scheduledStartAt", "2026-09-15T09:30");

    await alternarDiaInteiro();
    expect(campo("scheduledStartAt").value).toBe("2026-09-15");

    await alternarDiaInteiro();
    expect(campo("scheduledStartAt").value).toBe("2026-09-15T09:30");
  });

  it("uma tarefa sem data começa com os campos vazios e assim permanece", async () => {
    const { campo, alternarDiaInteiro } = await montarFormulario();

    expect(campo("dueAt").value).toBe("");
    await alternarDiaInteiro();
    expect(campo("dueAt").value).toBe("");
  });

  it("uma tarefa que já é 'dia inteiro' abre com o campo em modo data", async () => {
    const { campo } = await montarFormulario({ ...TAREFA, all_day: true });

    expect(campo("scheduledStartAt").type).toBe("date");
    expect(campo("scheduledStartAt").value).toBe("2026-08-07");
  });
});
