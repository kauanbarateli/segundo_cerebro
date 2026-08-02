"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  knowledgeNotebookSchema,
  knowledgeCreatePageSchema,
  knowledgePageContentSchema,
  knowledgeRenamePageSchema,
  knowledgeMovePageSchema,
} from "@/lib/validation";
import { DOCUMENTO_VAZIO, TITULO_PADRAO } from "@/lib/knowledge";
import { bloqueioPorLimite } from "@/lib/rate-limit";
import type { ActionResult, KnowledgePageSaveResult } from "@/lib/action-types";

/**
 * Server actions do módulo Conhecimento.
 *
 * Toda função aqui é um ENDPOINT HTTP: o `input` chega da rede e não do
 * formulário que a interface desenhou. Por isso o padrão é sempre o mesmo —
 * schema do zod primeiro (ids como uuid ANTES de qualquer ida ao banco),
 * consulta depois, e "0 linhas afetadas" tratado explicitamente, porque o
 * PostgREST devolve `error: null` nesse caso e um `if (error)` sozinho aceitaria
 * como sucesso uma operação que não tocou em nada.
 */

/**
 * As duas exclusões recebem um id solto, sem objeto em volta — e mesmo assim ele
 * é validado como uuid ANTES do banco. Um id malformado não vira "0 linhas": o
 * Postgres recusa o cast e o PostgREST devolve 22P02, cuja mensagem crua
 * ("invalid input syntax for type uuid") acabaria no aviso do usuário.
 */
const idDeRegistro = z.string().uuid("Identificador inválido");

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada");
  return { supabase, user };
}

/**
 * Invalida o cache das telas do módulo.
 *
 * A lista de cadernos e a árvore da barra lateral mudam de lugar quando uma
 * página é criada, renomeada, movida ou apagada, então as duas rotas entram.
 * Ver `updatePageContent` para o único caminho que NÃO chama isto sempre.
 */
function revalidar(pageId?: string) {
  revalidatePath("/conhecimento");
  if (pageId) revalidatePath(`/conhecimento/pagina/${pageId}`);
}

function fail(e: unknown): ActionResult {
  return { ok: false, error: e instanceof Error ? e.message : "Erro" };
}

/**
 * Traduz a exceção levantada pelos triggers de 0011 para uma frase que cabe num
 * aviso na tela.
 *
 * As mensagens do banco são ASCII sem acento (é o estilo dos literais de 0011),
 * então a comparação por trecho é estável — não depende de o Postgres devolver
 * "página" ou "pagina". `null` significa "não é um caso conhecido", e aí a
 * mensagem original é preservada em vez de virar um "Erro" genérico que esconde
 * a causa de quem for depurar.
 */
function mensagemDeTrigger(error: { message?: string } | null): string | null {
  const msg = error?.message ?? "";
  if (msg.includes("subpagina") || msg.includes("mae de si mesma")) {
    return "Não é possível mover uma página para dentro dela mesma.";
  }
  if (msg.includes("mesmo caderno")) {
    return "A página-mãe está em outro caderno. Escolha um destino dentro do mesmo caderno.";
  }
  if (msg.includes("nao existe ou nao esta visivel")) {
    return "A página-mãe não existe mais.";
  }
  // Vem do mesmo trigger, mas do trecho que valida `notebook_id`. O caso comum é
  // trivial de alcançar com duas abas: o caderno de destino foi apagado na outra
  // aba entre desenhar a árvore e soltar a página. A vírgula ("nao existe, nao
  // esta visivel") é o que separa esta mensagem da mensagem da página-mãe acima,
  // que usa "ou" — as duas comparações não se cruzam.
  if (msg.includes("nao existe, nao esta visivel")) {
    return "O caderno de destino não existe mais.";
  }
  if (msg.includes("profunda demais")) {
    return "Hierarquia de páginas profunda demais.";
  }
  return null;
}

/* ------------------------------------------------------------------ cadernos */

export async function createNotebook(input: unknown): Promise<ActionResult> {
  const parsed = knowledgeNotebookSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("knowledge_notebooks")
      .insert({
        user_id: user.id,
        name: parsed.data.name,
        color_key: parsed.data.colorKey,
      })
      .select("id")
      .single();

    if (error) {
      // 23505 = knowledge_notebooks_unique_name, que é `unique (user_id,
      // lower(btrim(name))) where deleted_at is null`: a comparação ignora
      // maiúsculas e espaços nas pontas, então "Estudos" colide com " estudos ".
      return {
        ok: false,
        error:
          error.code === "23505" ? "Já existe um caderno com esse nome." : error.message,
      };
    }
    revalidar();
    return { ok: true, id: data.id as string };
  } catch (e) {
    return fail(e);
  }
}

export async function renameNotebook(input: unknown): Promise<ActionResult> {
  const parsed = knowledgeNotebookSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Nome inválido" };
  }
  // O `id` é opcional no schema (ele serve também para criar), mas renomear sem
  // id não tem o que fazer. Recusado aqui, antes do banco.
  if (!parsed.data.id) return { ok: false, error: "Caderno inválido" };

  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("knowledge_notebooks")
      .update({ name: parsed.data.name, color_key: parsed.data.colorKey })
      .eq("id", parsed.data.id)
      .is("deleted_at", null)
      .select("id");

    if (error) {
      return {
        ok: false,
        error: error.code === "23505" ? "Já existe um caderno com esse nome." : error.message,
      };
    }
    // Zero linhas com `error: null` é o retorno do PostgREST quando o WHERE não
    // casou — id inexistente, caderno já apagado, ou linha de outro usuário
    // (invisível sob a RLS, que faz o UPDATE simplesmente não achar nada).
    if (!data || data.length === 0) return { ok: false, error: "Caderno não encontrado." };

    revalidar();
    return { ok: true, id: parsed.data.id };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Apaga um caderno.
 *
 * SOFT DELETE, nos DOIS níveis, e o segundo é o que não pode ser esquecido: as
 * páginas precisam receber `deleted_at` também. O `on delete cascade` da FK só
 * vale para exclusão FÍSICA — marcar apenas o caderno deixaria as páginas com
 * `deleted_at is null`, e elas continuariam aparecendo na BUSCA, que consulta
 * `knowledge_pages` diretamente e não sabe nada sobre o caderno. O usuário
 * apagaria o caderno e continuaria encontrando o conteúdo dele.
 *
 * Duas instruções, nenhuma por linha: um UPDATE em massa filtrado por
 * `notebook_id` resolve a árvore inteira de uma vez, independentemente da
 * profundidade.
 *
 * As páginas são marcadas ANTES do caderno de propósito. Se a segunda instrução
 * falhar, sobra um caderno visível com as páginas apagadas — estranho, mas
 * navegável e corrigível. Na ordem inversa sobraria um caderno invisível com
 * páginas vivas aparecendo na busca e apontando para um caderno que a interface
 * não consegue abrir.
 */
export async function deleteNotebook(id: string): Promise<ActionResult> {
  if (!idDeRegistro.safeParse(id).success) return { ok: false, error: "Caderno inválido" };
  try {
    const { supabase } = await requireUser();
    const agora = new Date().toISOString();

    const { error: erroPaginas } = await supabase
      .from("knowledge_pages")
      .update({ deleted_at: agora })
      .eq("notebook_id", id)
      .is("deleted_at", null);
    if (erroPaginas) return { ok: false, error: erroPaginas.message };

    const { data, error } = await supabase
      .from("knowledge_notebooks")
      .update({ deleted_at: agora })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id");

    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: "Caderno não encontrado." };

    revalidar();
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------------------------------------------ páginas */

/**
 * Cria uma página.
 *
 * `position` NÃO é enviada: o default da coluna é o epoch fracionário de
 * `clock_timestamp()`, então a página nasce no fim da lista sem que a aplicação
 * precise de um `select max(position)` antes do insert — consulta que, além da
 * ida e volta extra, teria corrida entre duas abas abertas.
 *
 * `content` também tem default no banco, mas ele é `'{}'::jsonb`, que passa no
 * CHECK e NÃO é um documento do ProseMirror (não tem `type`). Por isso a action
 * grava `DOCUMENTO_VAZIO` explicitamente: quem abrir a página em seguida recebe
 * algo montável.
 *
 * A EXISTÊNCIA DO CADERNO é conferida antes. A FK garante que o caderno existe,
 * mas checagem de FK não passa pela RLS — sem esta leitura, dava para criar uma
 * página própria pendurada no caderno de outra pessoa. Ela ficaria invisível
 * para os dois lados, o que é lixo silencioso e não vazamento, mas o custo de
 * impedir é uma leitura por criação de página, que é operação rara.
 */
export async function createPage(input: unknown): Promise<ActionResult> {
  const parsed = knowledgeCreatePageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  try {
    const { supabase, user } = await requireUser();

    /*
      Limita a CRIAÇÃO de páginas, nunca `updatePageContent`.
      Essa separação é obrigatória: o editor salva sozinho a cada poucos
      segundos de digitação, então um limite no autosave transformaria uma
      sessão de escrita longa em perda de texto — exatamente o dano que o
      controle de concorrência otimista daquela função existe para evitar.
      Criar página é ação de menu, e 30 por minuto já é generoso.
    */
    const bloqueio = bloqueioPorLimite("conhecimento:pagina", user.id);
    if (bloqueio) return bloqueio;

    const i = parsed.data;

    const { data: caderno } = await supabase
      .from("knowledge_notebooks")
      .select("id")
      .eq("id", i.notebookId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!caderno) return { ok: false, error: "Caderno não encontrado." };

    const { data, error } = await supabase
      .from("knowledge_pages")
      .insert({
        user_id: user.id,
        notebook_id: i.notebookId,
        parent_id: i.parentId,
        title: i.title ?? TITULO_PADRAO,
        content: i.content ?? DOCUMENTO_VAZIO,
      })
      .select("id")
      .single();

    if (error) {
      return { ok: false, error: mensagemDeTrigger(error) ?? error.message };
    }
    revalidar();
    return { ok: true, id: data.id as string };
  } catch (e) {
    return fail(e);
  }
}

/**
 * SALVAMENTO DO EDITOR — controle de concorrência otimista.
 *
 * O cliente devolve o `updated_at` que carregou junto com a página. O UPDATE
 * leva esse valor no WHERE:
 *
 *     update knowledge_pages set content = ... where id = ? and updated_at = ?
 *
 * e é o BANCO quem decide, dentro da mesma instrução, se a versão do cliente
 * ainda é a atual. Se alguém salvou nesse meio-tempo, o trigger `set_updated_at`
 * já mudou a coluna, o WHERE não casa, ZERO linhas são afetadas e nada é
 * sobrescrito.
 *
 * POR QUE NÃO "LER E DEPOIS ESCREVER": a forma óbvia seria `select updated_at`,
 * comparar em JavaScript e então escrever. Entre a leitura e a escrita existe
 * uma janela — dois autosaves de duas abas caem nela e AMBOS acham que estão
 * atualizados; o segundo apaga o primeiro sem que ninguém perceba. Aqui a
 * comparação e a escrita são a MESMA instrução, então a corrida não tem onde
 * acontecer.
 *
 * ZERO LINHAS NÃO É ERRO PARA O PostgREST: ele devolve `error: null` e
 * `data: []`. Um `if (error)` desatento trataria o conflito como sucesso e o
 * usuário continuaria digitando por cima de uma versão que nunca foi gravada.
 *
 * A leitura de diagnóstico só roda no caminho de FALHA, e serve para separar os
 * dois motivos possíveis de zero linhas: a página sumiu (apagada) ou mudou em
 * outro lugar. No segundo caso ela devolve o carimbo atual, que a interface usa
 * para oferecer "recarregar" — e a retentativa automática fica proibida, senão
 * ela apagaria a versão do outro lado.
 *
 * REVALIDAÇÃO CONDICIONAL — contrato com o editor: mande `title` SOMENTE quando
 * ele tiver mudado. `revalidatePath` invalida o cache do roteador e faz a
 * navegação seguinte refazer a página; chamá-lo a cada autosave (que dispara a
 * cada poucos segundos de digitação) seria trabalho de servidor constante para
 * atualizar um rótulo que não mudou. O conteúdo em si não aparece em lugar
 * nenhum além do editor, que já o tem na tela; o título aparece na árvore e na
 * lista, e é por isso que ele — e só ele — dispara a invalidação.
 */
export async function updatePageContent(input: unknown): Promise<KnowledgePageSaveResult> {
  const parsed = knowledgePageContentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  try {
    const { supabase } = await requireUser();
    const i = parsed.data;

    // `content_text` e `search_vector` NÃO entram: são derivadas, o banco as
    // recalcula na escrita. Mandar a primeira daqui seria pior que inútil — o
    // trigger sobrescreve o valor enviado de propósito.
    const alteracoes: Record<string, unknown> = { content: i.content };
    if (i.title !== undefined) alteracoes.title = i.title;

    const { data, error } = await supabase
      .from("knowledge_pages")
      .update(alteracoes)
      .eq("id", i.id)
      .eq("updated_at", i.updatedAt)
      .is("deleted_at", null)
      .select("updated_at");

    if (error) return { ok: false, error: mensagemDeTrigger(error) ?? error.message };

    if (!data || data.length === 0) {
      const { data: atual } = await supabase
        .from("knowledge_pages")
        .select("updated_at")
        .eq("id", i.id)
        .is("deleted_at", null)
        .maybeSingle();

      if (!atual) return { ok: false, error: "Esta página não existe mais." };

      return {
        ok: false,
        conflict: true,
        updatedAt: (atual as { updated_at: string }).updated_at,
        error: "Esta página mudou em outro lugar. Recarregue para ver a versão mais recente.",
      };
    }

    if (i.title !== undefined) revalidar(i.id);

    return {
      ok: true,
      id: i.id,
      updatedAt: (data[0] as { updated_at: string }).updated_at,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/**
 * Renomeia pela barra lateral.
 *
 * SEM controle de concorrência de propósito, ao contrário de
 * `updatePageContent`. Renomear é um ato único e deliberado ("quero que se chame
 * assim"), não uma sequência de salvamentos automáticos: exigir o carimbo faria
 * a renomeação falhar sempre que o autosave da mesma página tivesse rodado
 * depois de a árvore ser desenhada — que é o caso comum, não a exceção. O risco
 * real que sobra é dois renomes simultâneos, e aí o último vence, que é
 * exatamente o que a pessoa espera de um campo de nome.
 *
 * Aqui `title` EXIGE conteúdo (`knowledgeRenamePageSchema`), diferente do
 * autosave: apagar tudo e confirmar um nome vazio é engano, não digitação em
 * andamento.
 */
export async function renamePage(input: unknown): Promise<ActionResult> {
  const parsed = knowledgeRenamePageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Título inválido" };
  }
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("knowledge_pages")
      .update({ title: parsed.data.title })
      .eq("id", parsed.data.id)
      .is("deleted_at", null)
      .select("id");

    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: "Página não encontrada." };

    revalidar(parsed.data.id);
    return { ok: true, id: parsed.data.id };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Move uma página: troca de mãe, de caderno e/ou de posição.
 *
 * UM ÚNICO UPDATE, e é o banco que garante o resto:
 *   - `trg_knowledge_pages_no_cycle` recusa mover a página para dentro da
 *     própria subárvore (o breadcrumb entraria em laço infinito);
 *   - `trg_knowledge_pages_cascade_notebook` leva as FILHAS junto quando o
 *     caderno muda — sem isso a subárvore ficaria para trás;
 *   - `trg_knowledge_pages_same_notebook`, que é constraint trigger ADIADA,
 *     confere no commit se o caderno de destino existe, é visível para este
 *     usuário e não foi apagado, e se mãe e filha terminaram no mesmo caderno.
 *     A conferência do caderno é o que impede o caso das duas abas — apagar o
 *     caderno numa e arrastar a página para ele na outra —, que a FK aprovaria
 *     alegremente: checagem de FK roda com privilégio do dono, ignora a RLS e
 *     não sabe nada sobre soft delete.
 *
 * Repetir essas regras aqui em JavaScript seria uma segunda implementação para
 * divergir da primeira. O que a action faz é TRADUZIR a recusa do banco numa
 * frase legível — ver `mensagemDeTrigger`.
 *
 * `position` ausente significa "mantenha a atual", e por isso não pode entrar no
 * objeto como `undefined`: o supabase-js serializa o objeto em JSON, e a chave
 * presente com valor nulo viraria `position = null` numa coluna NOT NULL.
 */
export async function movePage(input: unknown): Promise<ActionResult> {
  const parsed = knowledgeMovePageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Destino inválido" };
  }
  try {
    const { supabase } = await requireUser();
    const i = parsed.data;

    const alteracoes: Record<string, unknown> = {
      parent_id: i.parentId,
      notebook_id: i.notebookId,
    };
    if (i.position !== undefined) alteracoes.position = i.position;

    const { data, error } = await supabase
      .from("knowledge_pages")
      .update(alteracoes)
      .eq("id", i.id)
      .is("deleted_at", null)
      .select("id");

    if (error) return { ok: false, error: mensagemDeTrigger(error) ?? error.message };
    if (!data || data.length === 0) return { ok: false, error: "Página não encontrada." };

    revalidar(i.id);
    return { ok: true, id: i.id };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Apaga a página E A SUBÁRVORE dela.
 *
 * O `on delete cascade` da FK autorreferente NÃO ajuda aqui: ele vale para
 * exclusão física, e isto é soft delete. Marcar só a página deixaria as filhas
 * com `deleted_at is null` — elas sumiriam da barra lateral (a mãe delas não
 * está mais na lista, e `montarArvore` as promoveria ao topo do caderno, o que é
 * pior ainda: reapareceriam fora de lugar) e continuariam saindo na BUSCA, que
 * lê `knowledge_pages` sem olhar a mãe.
 *
 * A subárvore é coletada em MEMÓRIA a partir de UMA consulta de (id, parent_id)
 * do caderno — mesmo padrão de `deleteFolder` no Drive. A alternativa seria
 * descer nível a nível com uma consulta por nível, que é o N+1 disfarçado de
 * recursão. O guarda de 256 rodadas impede laço infinito caso algum dado
 * inconsistente tenha escapado do trigger anti-ciclo.
 */
export async function deletePage(id: string): Promise<ActionResult> {
  if (!idDeRegistro.safeParse(id).success) return { ok: false, error: "Página inválida" };
  try {
    const { supabase } = await requireUser();

    const { data: alvo } = await supabase
      .from("knowledge_pages")
      .select("id, notebook_id")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    const pagina = alvo as { id: string; notebook_id: string } | null;
    if (!pagina) return { ok: false, error: "Página não encontrada." };

    // Só o caderno da página, não a tabela inteira: duas colunas por linha, e o
    // índice knowledge_pages_notebook_tree_idx cobre o filtro.
    const { data: todas } = await supabase
      .from("knowledge_pages")
      .select("id, parent_id")
      .eq("notebook_id", pagina.notebook_id)
      .is("deleted_at", null);

    const linhas = (todas as { id: string; parent_id: string | null }[] | null) ?? [];

    const paraApagar = new Set<string>([id]);
    let mudou = true;
    let guarda = 0;
    while (mudou && guarda < 256) {
      mudou = false;
      guarda++;
      for (const linha of linhas) {
        if (linha.parent_id && paraApagar.has(linha.parent_id) && !paraApagar.has(linha.id)) {
          paraApagar.add(linha.id);
          mudou = true;
        }
      }
    }

    const { data, error } = await supabase
      .from("knowledge_pages")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", [...paraApagar])
      .is("deleted_at", null)
      .select("id");

    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: "Página não encontrada." };

    revalidar(id);
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}
