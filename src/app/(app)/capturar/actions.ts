"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ID_INVALIDO, captureInputSchema, captureUpdateSchema, lerUuid } from "@/lib/validation";
import { bloqueioPorLimite } from "@/lib/rate-limit";
import {
  BYTES_PARA_SNIFAR,
  IMAGEM_GRANDE_DEMAIS,
  IMAGEM_INVALIDA,
  MAXIMO_DE_ANEXOS,
  TAMANHO_MAXIMO_BYTES,
  nomeDoAnexo,
  sniffarImagem,
} from "@/lib/imagem";
import type { CaptureResult } from "@/lib/action-types";

function revalidate() {
  revalidatePath("/capturar");
  revalidatePath("/");
  revalidatePath("/tarefas");
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada");
  return { supabase, user };
}

export async function createCapture(input: {
  type: string;
  title?: string;
  content?: string;
  categoryId?: string;
  projectId?: string;
}): Promise<CaptureResult> {
  const parsed = captureInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const i = parsed.data;
  if (!i.title && !i.content) {
    return { ok: false, error: "Escreva algo para capturar." };
  }
  try {
    const { supabase, user } = await requireUser();

    /*
      Limite de taxa DEPOIS de identificar o usuário — a chave é o id dele, e
      ele só existe depois do `getUser()`. Antes disso não há por quem limitar
      (limitar por IP puniria o dono em rede móvel e não pararia ninguém).

      A captura é a porta mais larga da aplicação: um campo de texto, um botão,
      nenhuma outra validação além de "escreva algo". É onde um laço enche a
      tabela mais rápido. Ver src/lib/rate-limit.ts para o que este limite
      realmente cobre — e para o que ele NÃO cobre (memória por instância).
    */
    const bloqueio = bloqueioPorLimite("captura:criar", user.id);
    if (bloqueio) return bloqueio;

    const { data, error } = await supabase
      .from("captures")
      .insert({
        user_id: user.id,
        type: i.type,
        title: i.title,
        content: i.content,
        category_id: i.categoryId,
        project_id: i.projectId,
        status: "inbox",
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    revalidate();
    return { ok: true, id: data.id as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/**
 * Edita uma captura existente.
 *
 * Não há `.eq("user_id", user.id)` aqui de propósito: a RLS da tabela já
 * restringe o UPDATE ao dono, então repetir o filtro no cliente seria
 * redundante e, pior, sugeriria que a segurança mora nesta linha. O que a RLS
 * *não* dá é uma mensagem decente — um UPDATE que não casa com nenhuma linha
 * (id inexistente, ou de outro usuário, que para a RLS é a mesma coisa) volta
 * com `error: null` e zero linhas afetadas, ou seja, sucesso silencioso. Por
 * isso o `.select("id")`: ele obriga o PostgREST a devolver as linhas tocadas e
 * transforma "não fiz nada" em um erro visível.
 */
export async function updateCapture(input: {
  id: string;
  type: string;
  title?: string;
  content?: string;
  categoryId?: string;
  projectId?: string;
}): Promise<CaptureResult> {
  const parsed = captureUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  const i = parsed.data;
  // Mesma regra do create: uma captura sem título e sem conteúdo não é um
  // rascunho, é lixo — e editar não pode ser a porta dos fundos para criá-lo.
  if (!i.title && !i.content) {
    return { ok: false, error: "Escreva algo para capturar." };
  }
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("captures")
      .update({
        type: i.type,
        title: i.title,
        content: i.content,
        category_id: i.categoryId,
        project_id: i.projectId,
      })
      .eq("id", i.id)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) {
      return { ok: false, error: "Captura não encontrada." };
    }
    revalidate();
    return { ok: true, id: i.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/**
 * Converte a captura em tarefa pela função transacional do banco.
 *
 * Não precisa da checagem de "0 linhas" das outras actions: a função SQL levanta
 * exceção em "capture not found" e "not authorized", então o erro chega de
 * verdade. Só falta barrar o id malformado na borda — sem isso o cast estoura no
 * Postgres e a mensagem crua do banco vai parar no toast do usuário.
 */
export async function convertCaptureToTask(captureId: string): Promise<CaptureResult> {
  const parsedId = z.string().uuid().safeParse(captureId);
  if (!parsedId.success) {
    return { ok: false, error: "Captura não encontrada." };
  }
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("convert_capture_to_task", {
      p_capture_id: parsedId.data,
    });
    if (error) return { ok: false, error: error.message };
    revalidate();
    return { ok: true, id: data as string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/**
 * Tira a captura da caixa de entrada sem apagar o registro.
 *
 * Vale as mesmas duas proteções de updateCapture e deleteCapturePermanently, e
 * pelos mesmos motivos: server action é endpoint HTTP, então o `captureId` pode
 * chegar com qualquer coisa dentro, e um UPDATE que não casa com nenhuma linha
 * volta do PostgREST com `error: null` — sucesso silencioso.
 */
export async function archiveCapture(captureId: string): Promise<CaptureResult> {
  // Sem esta validação, um id malformado não vira "0 linhas": vira erro de cast
  // do Postgres, e a string `invalid input syntax for type uuid: "abc"` iria
  // crua para dentro do toast do usuário.
  const parsed = z.string().uuid().safeParse(captureId);
  if (!parsed.success) {
    return { ok: false, error: "Captura não encontrada." };
  }
  try {
    const { supabase } = await requireUser();
    // `.select("id")` obriga o PostgREST a devolver as linhas tocadas. Sem ele,
    // arquivar uma captura já apagada em outra aba — ou de outro usuário,
    // barrada pela RLS — devolvia `{ ok: true }` e o botão comemorava
    // "Arquivada" para uma operação que não mudou nada.
    const { data, error } = await supabase
      .from("captures")
      .update({ status: "archived" })
      .eq("id", parsed.data)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) {
      return { ok: false, error: "Captura não encontrada." };
    }
    revalidate();
    return { ok: true, id: parsed.data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/**
 * Exclusão definitiva — sem lixeira, a linha some do banco. Para tirar da
 * caixa de entrada sem perder o registro existe archiveCapture.
 *
 * ARMADILHA: apagar a captura NÃO apaga a tarefa que ela gerou, e é natural
 * supor o contrário porque existe uma FK ligando as duas. Só que a FK é
 * `captures.converted_task_id -> tasks (id) on delete set null`, e ela aponta
 * para o outro lado: quem tem cascata é a TAREFA. Apagar a tarefa zera o
 * vínculo na captura; apagar a captura não toca em tasks, porque nada em tasks
 * referencia captures. A linha de captures some e a tarefa continua viva, só
 * que sem origem — o que é o comportamento certo: uma vez convertida, a tarefa
 * virou compromisso próprio (tem prazo, posição no board, histórico) e não deve
 * evaporar porque alguém faxinou o rascunho que a originou. Se um dia excluir a
 * captura precisar levar a tarefa junto, isso é decisão de produto e tem que
 * ser escrita aqui, com um delete explícito em tasks antes deste — o banco não
 * vai fazer isso sozinho.
 */
export async function deleteCapturePermanently(id: string): Promise<CaptureResult> {
  // Validar o uuid antes de ir ao banco: um id malformado não vira "0 linhas",
  // vira erro de cast do Postgres ("invalid input syntax for type uuid") e essa
  // mensagem acabaria na tela do usuário.
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) {
    return { ok: false, error: "Captura não encontrada." };
  }
  try {
    const { supabase } = await requireUser();
    // `.select("id")` pelo mesmo motivo do updateCapture: DELETE que não casa
    // com nenhuma linha (id de outro usuário, barrado pela RLS, ou já apagado)
    // volta sem erro. Sem isso, a interface comemoraria uma exclusão que não
    // aconteceu.
    const { data, error } = await supabase
      .from("captures")
      .delete()
      .eq("id", parsed.data)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) {
      return { ok: false, error: "Captura não encontrada." };
    }
    revalidate();
    return { ok: true, id: parsed.data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/* ========================================================================= */
/*  IMAGENS ANEXADAS À CAPTURA (0020)                                        */
/* ========================================================================= */

/**
 * O bucket é o MESMO do Drive, e a imagem anexada é um arquivo de Drive comum.
 * Ver o cabeçalho da 0020 para as três alternativas consideradas.
 */
const BUCKET_DE_ARQUIVOS = "drive";

const anexarSchema = z.object({
  captureId: z.string().uuid(ID_INVALIDO),
  /**
   * Onde os bytes JÁ estão. O upload acontece ANTES desta chamada, direto do
   * navegador para o Storage — rota serverless tem teto de corpo, e passar a
   * imagem pelo Next só para reenviá-la pagaria a transferência duas vezes.
   *
   * Consequência: quando esta ação recusa, os bytes já subiram. TODO caminho de
   * recusa aqui remove o objeto, senão o bucket acumula lixo invisível que
   * ninguém vê e que continua ocupando cota.
   */
  storagePath: z.string().min(1).max(300),
});

/**
 * ANEXAR UMA IMAGEM a uma captura.
 *
 * ===========================================================================
 * ⚠️ A VERIFICAÇÃO QUE IMPORTA É A DE CONTEÚDO, E ELA É FEITA AQUI
 * ===========================================================================
 * O cliente já confere o tipo e reencoda a imagem antes de subir (o que, de
 * quebra, apaga os metadados EXIF). Nada disso é barreira de segurança: server
 * action é ENDPOINT HTTP, e quem chamar esta função direto não passou por
 * cliente nenhum.
 *
 * Então o servidor BAIXA os primeiros bytes e olha a assinatura real do
 * arquivo. É a única informação sobre o tipo que não vem de quem enviou — a
 * extensão é parte do nome, e o `Content-Type` é declarado no upload.
 *
 * É assim que um SVG é barrado: ele abre com "<?xml" ou "<svg", não casa com
 * assinatura nenhuma da allowlist, e é recusado e removido. Um SVG aceito seria
 * XSS armazenado na mesma origem em que o Cofre é aberto.
 *
 * ===========================================================================
 * A ORDEM DAS CHECAGENS, E POR QUE É ESTA
 * ===========================================================================
 *   1. schema          — o mais barato; barra id malformado antes do banco
 *   2. dono do caminho — comparação de string, sem I/O
 *   3. teto de anexos  — uma consulta pequena, antes de transferir bytes
 *   4. tamanho real    — metadado, ainda sem baixar o arquivo
 *   5. CONTEÚDO        — o único que transfere bytes, e por isso o último
 *
 * Inverter faria o caminho mais caro rodar para entrada que a primeira linha já
 * recusaria.
 */
export async function anexarImagemACaptura(input: unknown): Promise<CaptureResult> {
  const parsed = anexarSchema.safeParse(input);
  if (!parsed.success) {
    await descartarObjeto(input);
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  try {
    const { supabase, user } = await requireUser();
    const { captureId, storagePath } = parsed.data;

    const bloqueio = bloqueioPorLimite("capturar:anexo", user.id);
    if (bloqueio) {
      await supabase.storage.from(BUCKET_DE_ARQUIVOS).remove([storagePath]);
      return { ok: false, error: bloqueio.error };
    }

    // Mesma regra da policy de storage da 0007. Sem isto, um caminho apontando
    // para a pasta de outra pessoa seria registrado como se fosse deste usuário.
    if (!storagePath.startsWith(`${user.id}/`)) {
      return { ok: false, error: "Caminho inválido." };
    }

    /*
      Teto por captura. Sem ele, um cliente adulterado anexa dez mil imagens à
      mesma captura: a tela que as lista deixa de abrir e a cota do usuário some
      sem que ele tenha feito nada.
    */
    const { count } = await supabase
      .from("capture_file_links")
      .select("file_id", { count: "exact", head: true })
      .eq("capture_id", captureId);

    if ((count ?? 0) >= MAXIMO_DE_ANEXOS) {
      await supabase.storage.from(BUCKET_DE_ARQUIVOS).remove([storagePath]);
      return { ok: false, error: `São no máximo ${MAXIMO_DE_ANEXOS} imagens por captura.` };
    }

    // Tamanho REAL, do Storage — nunca o que o cliente disser. Mesmo cuidado de
    // `registerFile`, e pela mesma razão: o número vai para `size_bytes`, que é
    // o que a barra de armazenamento soma.
    const { data: info, error: erroInfo } = await supabase.storage
      .from(BUCKET_DE_ARQUIVOS)
      .info(storagePath);

    const tamanho = typeof info?.size === "number" ? info.size : null;
    if (erroInfo || tamanho === null) {
      await supabase.storage.from(BUCKET_DE_ARQUIVOS).remove([storagePath]);
      return { ok: false, error: "Não foi possível confirmar o envio. Tente de novo." };
    }

    if (tamanho > TAMANHO_MAXIMO_BYTES) {
      await supabase.storage.from(BUCKET_DE_ARQUIVOS).remove([storagePath]);
      return { ok: false, error: IMAGEM_GRANDE_DEMAIS };
    }

    /*
      ⚠️ A BARREIRA DE VERDADE: baixa o objeto e olha a assinatura.

      O SDK não expõe download por faixa de bytes, então o arquivo vem inteiro —
      e é justamente por isso que o teto de tamanho é conferido ACIMA e não
      abaixo. Sem ele, esta linha baixaria os 50 MB que o bucket permite só para
      recusar em seguida.
    */
    const { data: blob, error: erroDownload } = await supabase.storage
      .from(BUCKET_DE_ARQUIVOS)
      .download(storagePath);

    if (erroDownload || !blob) {
      await supabase.storage.from(BUCKET_DE_ARQUIVOS).remove([storagePath]);
      return { ok: false, error: "Não foi possível confirmar o envio. Tente de novo." };
    }

    const cabecalho = new Uint8Array(await blob.slice(0, BYTES_PARA_SNIFAR).arrayBuffer());
    const tipoReal = sniffarImagem(cabecalho);

    if (!tipoReal) {
      await supabase.storage.from(BUCKET_DE_ARQUIVOS).remove([storagePath]);
      return { ok: false, error: IMAGEM_INVALIDA };
    }

    // Nome e mime saem do tipo REAL, nunca do que foi declarado: um arquivo que
    // se dizia PNG e é GIF entra como GIF, com a extensão certa.
    const { data: arquivo, error: erroArquivo } = await supabase
      .from("drive_files")
      .insert({
        user_id: user.id,
        folder_id: null,
        name: nomeDoAnexo(tipoReal, new Date()),
        storage_path: storagePath,
        mime_type: tipoReal,
        size_bytes: tamanho,
      })
      .select("id")
      .single();

    if (erroArquivo || !arquivo) {
      await supabase.storage.from(BUCKET_DE_ARQUIVOS).remove([storagePath]);
      return { ok: false, error: "Não foi possível guardar a imagem." };
    }

    /*
      O vínculo por último — a ordem inversa é impossível, porque a FK exige que
      o arquivo já exista. Se ele falhar, a linha de `drive_files` é removida
      aqui e o objeto vai junto: nada de metadado apontando para o nada.
    */
    const { error: erroVinculo } = await supabase.from("capture_file_links").insert({
      capture_id: captureId,
      file_id: arquivo.id,
      user_id: user.id,
    });

    if (erroVinculo) {
      await supabase.from("drive_files").delete().eq("id", arquivo.id);
      await supabase.storage.from(BUCKET_DE_ARQUIVOS).remove([storagePath]);
      return { ok: false, error: "Não foi possível anexar a imagem à captura." };
    }

    revalidate();
    return { ok: true, id: arquivo.id };
  } catch {
    await descartarObjeto(input);
    return { ok: false, error: "Não foi possível anexar a imagem." };
  }
}

/**
 * DESANEXAR — apaga o vínculo E o arquivo.
 *
 * ⚠️ Aqui o arquivo SOME de verdade, ao contrário de "desvincular de um
 * projeto". A diferença é de origem: este arquivo NASCEU como anexo desta
 * captura; não é algo que já existia no Drive e foi relacionado depois. Deixá-lo
 * para trás produziria, a cada remoção, um arquivo sem contexto ocupando cota —
 * e quem clicou em "remover imagem" não esperaria reencontrá-la no Drive.
 *
 * O vínculo sai por CASCADE quando a linha de `drive_files` é apagada (0020),
 * então um `delete` basta — mas ele não pode deixar os bytes para trás, e é o
 * `remove` no fim que fecha isso.
 */
export async function desanexarImagem(fileId: unknown): Promise<CaptureResult> {
  const id = lerUuid(fileId);
  if (!id) return { ok: false, error: ID_INVALIDO };

  try {
    const { supabase, user } = await requireUser();

    const bloqueio = bloqueioPorLimite("capturar:anexo", user.id);
    if (bloqueio) return { ok: false, error: bloqueio.error };

    // Lê o caminho ANTES de apagar: depois do delete não há de onde tirá-lo, e
    // os bytes ficariam no bucket para sempre. A RLS garante que só o dono
    // enxerga a linha.
    const { data: arquivo } = await supabase
      .from("drive_files")
      .select("storage_path")
      .eq("id", id)
      .single();

    if (!arquivo) return { ok: false, error: ID_INVALIDO };

    const { error } = await supabase.from("drive_files").delete().eq("id", id);
    if (error) return { ok: false, error: "Não foi possível remover a imagem." };

    await supabase.storage.from(BUCKET_DE_ARQUIVOS).remove([arquivo.storage_path]);

    revalidate();
    return { ok: true, id };
  } catch {
    return { ok: false, error: "Não foi possível remover a imagem." };
  }
}

/**
 * Remove os bytes de um upload que não virou anexo.
 *
 * Existe porque eles sobem ANTES da validação: quando a entrada é recusada cedo
 * (schema inválido, sessão expirada), ninguém mais tem o caminho para limpar.
 * Tolerante a tudo de propósito — é limpeza, e uma limpeza que lança esconde o
 * erro original.
 */
async function descartarObjeto(input: unknown): Promise<void> {
  const caminho = (input as { storagePath?: unknown } | null)?.storagePath;
  if (typeof caminho !== "string" || caminho.length === 0) return;
  try {
    const { supabase, user } = await requireUser();
    if (!caminho.startsWith(`${user.id}/`)) return;
    await supabase.storage.from(BUCKET_DE_ARQUIVOS).remove([caminho]);
  } catch {
    // Sem sessão não há o que remover com segurança.
  }
}
