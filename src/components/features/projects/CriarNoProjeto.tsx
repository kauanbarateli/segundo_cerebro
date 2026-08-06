"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { TaskForm } from "@/components/features/tasks/TaskForm";
import { ANEXAVEL, type TipoAnexavel } from "@/components/features/projects/anexaveis";
import { vincularAoProjeto } from "@/app/(app)/projetos/actions";
import { createCapture } from "@/app/(app)/capturar/actions";
import { createNotebook } from "@/app/(app)/conhecimento/actions";
import { createFolder } from "@/app/(app)/drive/actions";
import type { Category, Project } from "@/lib/database.types";
import { CLASSE_DO_CAMPO, CLASSE_DO_CAMPO_MULTILINHA } from "@/components/ui/estilos";
import { cn } from "@/lib/utils";

/**
 * "CRIAR AQUI" — o formulário do módulo de origem, já com o projeto preenchido.
 *
 * ============================================================================
 * ⚠️ NENHUM `insert` MORA NESTE ARQUIVO
 * ============================================================================
 * Criar tarefa continua sendo `createTask`; criar caderno, `createNotebook`.
 * Este componente só empurra o `projectId` para dentro do caminho que já existe.
 * Escrever um `insert` próprio aqui daria um SEGUNDO caminho de criação por
 * tabela — com uma segunda validação, uma segunda mensagem de nome duplicado e
 * uma segunda revalidação para manter em dia com a primeira.
 *
 * ============================================================================
 * ⚠️ CADERNO E PASTA SÃO CRIADOS EM DOIS PASSOS. LEIA ANTES DE "CONSERTAR".
 * ============================================================================
 * `createTask` e `createCapture` aceitam `projectId` (os schemas da 0017 têm o
 * campo). `createNotebook` e `createFolder` NÃO aceitam — e a coluna existe nas
 * duas tabelas, o que torna tentador acrescentar o campo lá.
 *
 * Enquanto isso não acontece, aqui é: criar pela action do módulo e, com o id
 * que ela devolve, chamar `vincularAoProjeto`. As consequências, sem enfeite:
 *
 *   - São duas transações. Se a segunda falhar (sessão expirou, projeto apagado
 *     em outra aba), o caderno EXISTE e está sem projeto. O aviso diz isso com
 *     todas as letras em vez de dizer "erro" — a pessoa precisa saber que há um
 *     caderno novo em Conhecimento, senão ela cria outro.
 *   - Nada fica pela metade em termos de dado: um caderno sem projeto é um
 *     estado normal do sistema, não corrupção. É a mesma coisa que criá-lo pelo
 *     módulo e esquecer de atribuir o projeto.
 *
 * A alternativa — um `insert` em `knowledge_notebooks` a partir do módulo de
 * projetos — trocaria essa janela de duas transações pelo segundo caminho de
 * escrita descrito acima, que é pior porque é permanente.
 */
export function CriarNoProjeto({
  tipo,
  projectId,
  nomeDoProjeto,
  categorias,
  projetos,
  onDone,
  onCancel,
}: {
  tipo: TipoAnexavel;
  projectId: string;
  nomeDoProjeto: string;
  categorias: Category[];
  projetos: Project[];
  onDone: () => void;
  onCancel: () => void;
}) {
  if (tipo === "tarefa") {
    return (
      <TaskForm
        categories={categorias}
        projetos={projetos}
        projetoInicial={projectId}
        onDone={onDone}
        onCancel={onCancel}
      />
    );
  }

  if (tipo === "captura") {
    return <FormDeCaptura projectId={projectId} onDone={onDone} onCancel={onCancel} />;
  }

  return (
    <FormDeNome
      tipo={tipo}
      projectId={projectId}
      nomeDoProjeto={nomeDoProjeto}
      onDone={onDone}
      onCancel={onCancel}
    />
  );
}

/**
 * Captura nascendo já no projeto.
 *
 * O formulário é o mínimo — título opcional e conteúdo —, e não uma cópia do
 * `CaptureView`: quem está na tela do projeto quer anotar uma coisa e voltar. O
 * tipo é fixo em "note" porque os outros tipos (link, arquivo) têm fluxo próprio
 * no módulo, e reproduzi-los aqui seria a duplicação que este trabalho evita.
 */
function FormDeCaptura({
  projectId,
  onDone,
  onCancel,
}: {
  projectId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [enviando, iniciar] = useTransition();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const vazio = title.trim().length === 0 && content.trim().length === 0;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (vazio) return;
        iniciar(async () => {
          const r = await createCapture({ type: "note", title, content, projectId });
          if (r.ok) {
            toast("Captura criada neste projeto", "success");
            onDone();
          } else {
            toast(r.error ?? "Erro ao capturar", "error");
          }
        });
      }}
    >
      <div>
        <label htmlFor="captura-titulo" className="mb-1.5 block text-corpo font-medium text-ink">
          Título <span className="font-normal text-ink-subtle">(opcional)</span>
        </label>
        <input
          id="captura-titulo"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          autoFocus
          className={cn(CLASSE_DO_CAMPO, "w-full")}
        />
      </div>

      <div>
        <label htmlFor="captura-conteudo" className="mb-1.5 block text-corpo font-medium text-ink">
          Conteúdo
        </label>
        <textarea
          id="captura-conteudo"
          rows={5}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={10_000}
          placeholder="O que passou pela cabeça agora."
          className={cn(CLASSE_DO_CAMPO_MULTILINHA, "w-full")}
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="primary" size="sm" type="submit" disabled={enviando || vazio}>
          {enviando ? "Salvando…" : "Criar captura"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Caderno ou pasta: um campo de nome e os dois passos descritos no topo.
 *
 * A pasta nasce na RAIZ do Drive (`parentId: null`), e não dentro de outra: a
 * tela do projeto não mostra a árvore de pastas, então escolher a mãe aqui seria
 * escolher às cegas. Mover depois é uma operação que o módulo já oferece.
 */
function FormDeNome({
  tipo,
  projectId,
  nomeDoProjeto,
  onDone,
  onCancel,
}: {
  tipo: "caderno" | "pasta";
  projectId: string;
  nomeDoProjeto: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const def = ANEXAVEL[tipo];
  const [enviando, iniciar] = useTransition();
  const [name, setName] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setErro(null);
        iniciar(async () => {
          const criado =
            tipo === "caderno"
              ? await createNotebook({ name })
              : await createFolder({ name, parentId: null });

          if (!criado.ok || !criado.id) {
            setErro(criado.error ?? `Não foi possível criar ${def.artigo} ${def.singular}.`);
            return;
          }

          const vinculado = await vincularAoProjeto({ projectId, tipo, ids: [criado.id] });
          if (!vinculado.ok) {
            // O item EXISTE. Dizer só "erro" faria a pessoa tentar de novo e
            // acabar com dois cadernos de mesmo nome — que o índice único do
            // banco recusaria, produzindo um segundo erro ainda mais confuso.
            setErro(
              `${def.rotuloDeCriar} criad${def.artigo} em ${def.modulo}, mas o vínculo com o projeto não foi gravado: ${vinculado.error ?? "erro"} Use "Vincular existente" aqui para terminar — não crie de novo.`,
            );
            return;
          }

          toast(`${def.rotuloDeCriar} em «${nomeDoProjeto}»`, "success");
          onDone();
        });
      }}
    >
      <div>
        <label htmlFor="anexavel-nome" className="mb-1.5 block text-corpo font-medium text-ink">
          Nome
        </label>
        <input
          id="anexavel-nome"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={tipo === "caderno" ? 80 : 120}
          required
          autoFocus
          placeholder={tipo === "caderno" ? "Pesquisa de fornecedores" : "Orçamentos"}
          className={cn(CLASSE_DO_CAMPO, "w-full")}
        />
        <p className="mt-1.5 text-legenda text-ink-subtle">
          {tipo === "caderno"
            ? "As páginas que você criar dentro dele são o conhecimento deste projeto — elas não precisam ser vinculadas uma a uma."
            : "Todo arquivo enviado para esta pasta já nasce no projeto — arquivos não são vinculados um a um."}
        </p>
      </div>

      {erro && (
        <p role="alert" className="text-corpo text-danger-ink">
          {erro}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          variant="primary"
          size="sm"
          type="submit"
          disabled={enviando || name.trim().length === 0}
        >
          {enviando ? "Salvando…" : def.rotuloDeCriar}
        </Button>
      </div>
    </form>
  );
}
