"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { bloqueioPorLimite, type Limite } from "@/lib/rate-limit";
import { ID_INVALIDO, lerUuid, projectSchema } from "@/lib/validation";
import type { ActionResult } from "@/lib/action-types";
import { ANEXAVEL, type ItemAnexavel, type TipoAnexavel } from "@/components/features/projects/anexaveis";

/**
 * Server actions do módulo Projetos.
 *
 * ============================================================================
 * O QUE MORA AQUI, E O QUE CONTINUA MORANDO NO MÓDULO DE ORIGEM
 * ============================================================================
 * O texto de uma tarefa, o nome de um caderno, a data de um lançamento — nada
 * disso se escreve daqui. Editar tarefa é `updateTask`; renomear caderno é
 * `renameNotebook`. Duplicar essas escritas criaria um segundo caminho para os
 * mesmos campos, com uma segunda validação para manter em dia.
 *
 * O que mora aqui é UMA COLUNA: `project_id`. Ela é a única coisa que a tela
 * do projeto grava, e grava nas quatro tabelas que a 0017 marcou. Vincular é o
 * `update` dessa coluna; desvincular é gravar `null` nela. Nenhum dos dois
 * copia, move ou apaga o item — ver `anexaveis.tsx`.
 *
 * ⚠️ E é por isso que "vincular" NÃO passa pelas actions dos outros módulos:
 * `updateTask` exige o formulário inteiro da tarefa (título, prazo, categoria),
 * então usá-lo para trocar só o projeto significaria reenviar campos que
 * ninguém editou — e qualquer divergência entre a tela e o banco viraria uma
 * sobrescrita silenciosa.
 */

async function exigirUsuario() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function revalidar(id?: string) {
  revalidatePath("/projetos");
  if (id) revalidatePath(`/projetos/${id}`);
}

export async function createProject(input: unknown): Promise<ActionResult> {
  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, user } = await exigirUsuario();
  if (!user) return { ok: false, error: "Sessão expirada" };

  const bloqueio = bloqueioPorLimite("projetos:escrita", user.id);
  if (bloqueio) return bloqueio;

  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      description: parsed.data.description,
      color_key: parsed.data.colorKey,
    })
    .select("id")
    .single();

  if (error) {
    // O índice único é por nome entre os VIVOS: dois "Site" no seletor de
    // projeto seriam duas opções idênticas.
    if (error.code === "23505") return { ok: false, error: "Já existe um projeto com esse nome." };
    return { ok: false, error: "Não foi possível criar o projeto." };
  }

  revalidar();
  return { ok: true, id: data.id };
}

export async function updateProject(id: unknown, input: unknown): Promise<ActionResult> {
  const projectId = lerUuid(id);
  if (!projectId) return { ok: false, error: ID_INVALIDO };

  const parsed = projectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { supabase, user } = await exigirUsuario();
  if (!user) return { ok: false, error: "Sessão expirada" };

  const bloqueio = bloqueioPorLimite("projetos:escrita", user.id);
  if (bloqueio) return bloqueio;

  // Whitelist explícita — o cliente manda os dados, não manda no banco.
  const { error } = await supabase
    .from("projects")
    .update({
      name: parsed.data.name,
      description: parsed.data.description,
      color_key: parsed.data.colorKey,
    })
    .eq("id", projectId);

  if (error) {
    if (error.code === "23505") return { ok: false, error: "Já existe um projeto com esse nome." };
    return { ok: false, error: "Não foi possível salvar." };
  }

  revalidar(projectId);
  return { ok: true, id: projectId };
}

/**
 * SOFT DELETE, como cadernos e pastas.
 *
 * ============================================================================
 * ⚠️ O QUE ACONTECE COM O QUE ESTAVA NO PROJETO
 * ============================================================================
 * NADA. As tarefas, capturas, cadernos e pastas continuam com o `project_id`
 * apontando para o projeto apagado.
 *
 * Isso é deliberado e é o que torna o soft delete reversível: restaurar o
 * projeto devolve o conteúdo dele inteiro. Zerar as colunas na exclusão faria
 * "apagar" virar uma operação destrutiva disfarçada de reversível — a linha do
 * projeto voltaria vazia.
 *
 * ⚠️ E É POR ISSO QUE `on delete set null` É SÓ BACKSTOP: com soft delete ele
 * nunca dispara. Quem impede um `project_id` novo de apontar para projeto morto
 * é a trigger `enforce_project_alive_same_owner` da 0017 — a FK sozinha
 * aceitaria, porque a linha continua lá.
 *
 * As telas filtram por `deleted_at is null` ao listar projetos, então o
 * conteúdo aparece "sem projeto" enquanto o projeto estiver apagado.
 */
export async function deleteProject(id: unknown): Promise<ActionResult> {
  const projectId = lerUuid(id);
  if (!projectId) return { ok: false, error: ID_INVALIDO };

  const { supabase, user } = await exigirUsuario();
  if (!user) return { ok: false, error: "Sessão expirada" };

  const bloqueio = bloqueioPorLimite("projetos:escrita", user.id);
  if (bloqueio) return bloqueio;

  const { error } = await supabase
    .from("projects")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", projectId);

  if (error) return { ok: false, error: "Não foi possível apagar." };

  // Revalida as telas do CONTEÚDO também: uma tarefa que estava neste projeto
  // passa a mostrar "sem projeto", e a lista de tarefas precisa refletir isso.
  revalidar(projectId);
  revalidatePath("/tarefas");
  revalidatePath("/capturar");
  return { ok: true, id: projectId };
}

/* ========================================================================== */
/* VÍNCULO — anexar e desanexar itens pela própria tela do projeto             */
/* ========================================================================== */

const tipoAnexavelSchema = z.enum(["tarefa", "captura", "caderno", "pasta"]);

/**
 * Teto de itens por chamada.
 *
 * O `update ... where id in (...)` é UMA instrução e UMA transação, então
 * vincular 50 de uma vez não tem o problema de meia escrita que N chamadas
 * teriam. O teto existe contra a lista fabricada: a action é um endpoint HTTP
 * público, e um array de dez mil uuids viraria uma instrução gigante que a
 * interface nunca conseguiria produzir.
 */
const MAXIMO_POR_VINCULO = 50;

const vinculoSchema = z.object({
  projectId: z.string().uuid(ID_INVALIDO),
  tipo: tipoAnexavelSchema,
  ids: z
    .array(z.string().uuid(ID_INVALIDO))
    .min(1, "Escolha ao menos um item.")
    .max(MAXIMO_POR_VINCULO, `No máximo ${MAXIMO_POR_VINCULO} itens de uma vez.`),
});

const desvinculoSchema = z.object({
  tipo: tipoAnexavelSchema,
  id: z.string().uuid(ID_INVALIDO),
  /** Só para revalidar a tela de onde o clique veio. Não entra no `where`. */
  projectId: z.string().uuid(ID_INVALIDO).optional(),
});

const buscaSchema = z.object({
  projectId: z.string().uuid(ID_INVALIDO),
  tipo: tipoAnexavelSchema,
  termo: z.string().trim().max(80).optional().default(""),
});

/**
 * Traduz o erro do PostgREST numa frase que serve ao usuário.
 *
 * ⚠️ O CASO QUE REALMENTE ACONTECE É A TRIGGER DE GUARDA DA 0017.
 * `enforce_project_alive_same_owner` roda antes de todo `insert or update of
 * project_id` e levanta `foreign_key_violation` (SQLSTATE 23503) com a mensagem
 * literal "Projeto % nao existe, nao esta visivel ou foi apagado" quando o
 * projeto está com `deleted_at` preenchido — o cenário concreto de deixar a
 * tela do projeto aberta numa aba e apagá-lo em outra.
 *
 * Sem esta tradução, a mensagem CRUA do Postgres subiria até o toast: além de
 * incompreensível, ela descreve o schema para quem estiver sondando.
 *
 * O casamento é pelo TEXTO, e não só pelo código: 23503 sozinho também sairia de
 * uma FK real violada. Os dois viram a mesma frase de qualquer forma (para o
 * usuário a causa é a mesma), mas testar o texto primeiro documenta qual é o
 * caminho esperado. O texto do banco vem SEM ACENTOS de propósito — mesma
 * escolha da 0009 e da 0012 —, para o casamento não depender de encoding no
 * caminho até aqui.
 */
function mensagemDoVinculo(error: { code?: string; message: string }): string {
  if (error.message.includes("nao esta visivel") || error.code === "23503") {
    return "Este projeto não está mais disponível — ele pode ter sido apagado em outra aba. Recarregue a página.";
  }
  return "Não foi possível vincular.";
}

/**
 * Busca ITENS SEM PROJETO (ou de outro projeto) para vincular a este.
 *
 * É o INVERSO de `SeletorDeProjeto`: lá se escolhe um projeto para um item;
 * aqui se escolhem itens para um projeto.
 *
 * ⚠️ ISTO É LEITURA, MAS CONTINUA SENDO UM ENDPOINT HTTP PÚBLICO. Por isso tem
 * limite de taxa próprio — e uma chave própria, `projetos:busca`, para que
 * digitar no campo de busca não consuma a cota de ESCRITA e deixe a pessoa sem
 * conseguir vincular o que acabou de achar. O teto é mais alto que o padrão
 * porque a busca dispara enquanto se digita (com atraso de 250ms no cliente),
 * e um teto de escrita transformaria uma frase digitada em "tente de novo em
 * 40s".
 */
const LIMITE_DE_BUSCA: Limite = { maximo: 90, janelaMs: 60_000 };

/** Quantos candidatos a tela mostra. */
const ITENS_DA_BUSCA = 25;

/**
 * Colunas por tipo.
 *
 * ⚠️ `project_id` VEM CRU, E O NOME DO PROJETO É RESOLVIDO NUMA SEGUNDA
 * CONSULTA — não por um embed `projects(name)`.
 *
 * O embed seria uma linha mais curta e é o primeiro do projeto inteiro: não há
 * um `.select("… ( … )")` em lugar nenhum deste código. Estrear o recurso aqui
 * significaria depender do cache de schema do PostgREST expor a FK da 0017, e a
 * falha desse tipo não é um erro de compilação — é a busca inteira devolvendo
 * "não foi possível buscar" em produção, com a causa a três camadas de
 * distância.
 *
 * A segunda consulta custa uma ida ao banco por uma tabela que tem meia dúzia
 * de linhas, e ainda sai melhor: filtrar `deleted_at is null` LÁ faz o projeto
 * apagado simplesmente não entrar no mapa, e "não está no mapa" já é a regra de
 * "conta como sem projeto" — sem uma segunda checagem para esquecer.
 */
const CONSULTA: Record<TipoAnexavel, { colunas: string; busca: string[] }> = {
  tarefa: { colunas: "id, title, project_id", busca: ["title"] },
  captura: { colunas: "id, title, content, project_id", busca: ["title", "content"] },
  caderno: { colunas: "id, name, project_id", busca: ["name"] },
  pasta: { colunas: "id, name, project_id", busca: ["name"] },
};

/**
 * ⚠️ O TERMO ENTRA NUMA STRING DE FILTRO DO PostgREST (`or=(a.ilike.*x*,…)`),
 * NÃO NUM PARÂMETRO LIGADO.
 *
 * Vírgula, parêntese, ponto e dois-pontos são a PONTUAÇÃO dessa gramática: um
 * termo com vírgula vira dois filtros; um parêntese solto vira 400 com a
 * mensagem crua do PostgREST na tela. `%` e `*` saem porque são o coringa do
 * `ilike` — deixá-los faria "a*b" casar coisas que ninguém digitou.
 *
 * Custo aceito: buscar por "v1.2" não casa o ponto. É um preço pequeno perto de
 * construir um escapador de gramática de terceiro para um campo de busca.
 */
function termoSeguro(termo: string): string {
  return termo.replace(/[,().:"'\\%*]/g, " ").trim();
}

/** O rótulo do item na lista de escolha, por tipo. */
function rotuloDoCandidato(tipo: TipoAnexavel, linha: LinhaDeCandidato): string {
  if (tipo === "tarefa") return linha.title ?? "(sem título)";
  if (tipo === "captura") {
    // A captura pode não ter título — é a porta mais larga do app, um campo de
    // texto e nada mais. O começo do conteúdo é o que a pessoa reconhece.
    return linha.title ?? linha.content?.slice(0, 80) ?? "(sem título)";
  }
  return linha.name ?? "(sem nome)";
}

interface LinhaDeCandidato {
  id: string;
  title?: string | null;
  content?: string | null;
  name?: string | null;
  project_id: string | null;
}

export async function buscarAnexaveis(
  input: unknown,
): Promise<{ ok: boolean; error?: string; itens?: ItemAnexavel[] }> {
  const parsed = buscaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Busca inválida" };
  }
  const { projectId, tipo, termo } = parsed.data;

  const { supabase, user } = await exigirUsuario();
  if (!user) return { ok: false, error: "Sessão expirada" };

  const bloqueio = bloqueioPorLimite("projetos:busca", user.id, LIMITE_DE_BUSCA);
  if (bloqueio) return { ok: false, error: bloqueio.error };

  const { colunas, busca } = CONSULTA[tipo];

  const comColunas = supabase.from(ANEXAVEL[tipo].tabela).select(colunas);

  // "Vivo" tem duas formas neste schema: tarefas e capturas usam `status`,
  // cadernos e pastas usam soft delete. Oferecer para vincular o que a tela de
  // origem já não mostra seria ressuscitar item arquivado pela porta dos fundos.
  const comVida =
    tipo === "tarefa" || tipo === "captura"
      ? comColunas.neq("status", "archived")
      : comColunas.is("deleted_at", null);

  const limpo = termoSeguro(termo);
  const comBusca =
    limpo.length > 0
      ? // `*` e não `%`: dentro da árvore lógica do PostgREST os dois valem como
        // coringa, e `*` não precisa de codificação de URL.
        comVida.or(busca.map((coluna) => `${coluna}.ilike.*${limpo}*`).join(","))
      : comVida;

  // As duas consultas em paralelo: a lista de projetos VIVOS não depende da de
  // candidatos, e encadeá-las pagaria dois tempos de ida e volta por tecla
  // digitada. A RLS restringe as duas ao dono.
  //
  // O `* 3` no limite é a folga que o filtro em JavaScript logo abaixo consome.
  const [candidatos, projetosVivos] = await Promise.all([
    comBusca.order("created_at", { ascending: false }).limit(ITENS_DA_BUSCA * 3),
    supabase.from("projects").select("id, name").is("deleted_at", null),
  ]);

  if (candidatos.error) return { ok: false, error: "Não foi possível buscar." };

  // Projeto que não está aqui — porque foi apagado, ou porque é de outra pessoa
  // e a RLS não o devolveu — vira "sem projeto" na tela. Ver `ItemAnexavel`.
  const nomePorProjeto = new Map(
    ((projetosVivos.data as { id: string; name: string }[] | null) ?? []).map((p) => [p.id, p.name]),
  );

  const linhas = (candidatos.data as unknown as LinhaDeCandidato[] | null) ?? [];

  /*
    ⚠️ "NÃO ESTÁ NESTE PROJETO" É FILTRADO EM JAVASCRIPT, DE PROPÓSITO.

    O caminho óbvio — `.not("project_id", "eq", projectId)` — vira
    `NOT (project_id = X)` no SQL, que é NULO para as linhas com `project_id`
    nulo e portanto AS DESCARTA. E "sem projeto" é justamente o candidato mais
    comum: a lista de candidatos sairia quase vazia, sem erro nenhum para avisar.

    A alternativa correta em SQL (`or=(project_id.is.null,project_id.neq.X)`)
    empilharia um SEGUNDO `or=` no mesmo pedido, junto com o da busca por texto.
    Funciona, mas depende de uma sutileza de como o PostgREST combina filtros
    repetidos — e o ganho seria evitar filtrar poucas dezenas de linhas em
    memória. Por isso a consulta pede com folga e o corte acontece aqui, onde
    está escrito o que ele faz.
  */
  const itens: ItemAnexavel[] = linhas
    .filter((l) => l.project_id !== projectId)
    .slice(0, ITENS_DA_BUSCA)
    .map((l) => ({
      id: l.id,
      rotulo: rotuloDoCandidato(tipo, l),
      projetoAtual: l.project_id ? (nomePorProjeto.get(l.project_id) ?? null) : null,
    }));

  return { ok: true, itens };
}

/**
 * VINCULA itens existentes a este projeto.
 *
 * ⚠️ É UM `UPDATE`, NÃO UMA CÓPIA. A tarefa vinculada continua a mesma linha de
 * `tasks`, com o mesmo id, aparecendo na tela de Tarefas como sempre apareceu —
 * ela só passa a ter um `project_id`. Nada é duplicado.
 *
 * ⚠️ UM ITEM PERTENCE A UM PROJETO DE CADA VEZ. `project_id` é uma coluna só, e
 * gravar aqui SOBRESCREVE o projeto anterior. Quem avisa disso antes de gravar é
 * a interface (`VincularExistente` mostra "está em «X»" ao lado do candidato) —
 * aqui embaixo não há como distinguir "quis mover" de "não viu".
 */
export async function vincularAoProjeto(input: unknown): Promise<ActionResult> {
  const parsed = vinculoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const { projectId, tipo, ids } = parsed.data;

  const { supabase, user } = await exigirUsuario();
  if (!user) return { ok: false, error: "Sessão expirada" };

  const bloqueio = bloqueioPorLimite("projetos:vinculo", user.id);
  if (bloqueio) return bloqueio;

  // Sem `.eq("user_id", …)`: a RLS já restringe ao dono, e repetir o filtro aqui
  // sugeriria que a segurança mora nesta linha. O `.select("id")` é que importa —
  // ver o bloco de "0 linhas" logo abaixo.
  const { data, error } = await supabase
    .from(ANEXAVEL[tipo].tabela)
    .update({ project_id: projectId })
    .in("id", ids)
    .select("id");

  if (error) return { ok: false, error: mensagemDoVinculo(error) };

  /*
    ⚠️ "0 LINHAS AFETADAS" É `error: null` NO PostgREST.

    Um `update` que não casa com linha nenhuma — id apagado em outra aba, ou de
    outra pessoa, que para a RLS é a mesma coisa — volta com sucesso e um array
    vazio. Sem esta checagem a interface comemoraria o que não gravou.

    E o caso PARCIAL (algumas linhas casaram, outras não) é deliberadamente
    tratado como sucesso: o `update` é uma transação só, o que casou está
    gravado, e a lista revalidada logo abaixo mostra exatamente o que entrou.
    Anunciar um número no toast seria repetir de memória o que a tela já vai
    dizer com o dado — e mentir nele quando divergir.
  */
  const linhas = (data as { id: string }[] | null) ?? [];
  if (linhas.length === 0) {
    return { ok: false, error: "Nada foi vinculado — a lista mudou. Recarregue a página." };
  }

  revalidar(projectId);
  for (const rota of ANEXAVEL[tipo].rotasParaRevalidar) revalidatePath(rota);
  return { ok: true, id: projectId };
}

/**
 * DESVINCULA um item: `project_id = null`.
 *
 * ⚠️ NÃO APAGA NADA. A tarefa continua em Tarefas, o caderno em Conhecimento; o
 * que sai é o agrupamento. A frase da confirmação na tela diz isso com todas as
 * letras, porque "remover do projeto" é fácil de ler como "remover".
 *
 * DETALHE QUE FAZ ISTO FUNCIONAR MESMO COM O PROJETO JÁ APAGADO: a trigger de
 * guarda da 0017 tem `when (new.project_id is not null)`. Gravar `null` não a
 * dispara — então dá para tirar um item de um projeto que foi apagado em outra
 * aba, que é exatamente quando alguém precisa fazer isso.
 *
 * `projectId` entra só para revalidar a tela de onde o clique veio; ele NÃO
 * participa do `where`. Filtrar por projeto aqui não protegeria nada (a RLS já
 * faz o trabalho) e criaria um caminho a mais para o desvínculo não acontecer.
 */
export async function desvincularDoProjeto(input: unknown): Promise<ActionResult> {
  const parsed = desvinculoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const { tipo, id, projectId } = parsed.data;

  const { supabase, user } = await exigirUsuario();
  if (!user) return { ok: false, error: "Sessão expirada" };

  const bloqueio = bloqueioPorLimite("projetos:vinculo", user.id);
  if (bloqueio) return bloqueio;

  const { data, error } = await supabase
    .from(ANEXAVEL[tipo].tabela)
    .update({ project_id: null })
    .eq("id", id)
    .select("id");

  if (error) return { ok: false, error: "Não foi possível desvincular." };

  const linhas = (data as { id: string }[] | null) ?? [];
  if (linhas.length === 0) {
    return { ok: false, error: "Item não encontrado — ele pode ter sido apagado em outra aba." };
  }

  revalidar(projectId);
  for (const rota of ANEXAVEL[tipo].rotasParaRevalidar) revalidatePath(rota);
  return { ok: true, id };
}
