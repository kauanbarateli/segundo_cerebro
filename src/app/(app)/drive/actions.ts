"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  driveFolderSchema,
  driveRenameSchema,
  driveMoveSchema,
  driveFileRegisterSchema,
  lerUuid,
  ID_INVALIDO,
} from "@/lib/validation";
import type { ActionResult } from "@/lib/action-types";

const BUCKET = "drive";

/**
 * Extensões recusadas no registro do arquivo.
 *
 * A lista cobre o que o Windows executa em duplo clique. Ela NÃO é a proteção
 * principal — bloqueio por extensão é frágil (`virus.exe.txt` passa, e qualquer
 * um renomeia o arquivo). O que realmente protege são três coisas já em vigor:
 * o bucket é privado com RLS, o download é servido com
 * `Content-Disposition: attachment` (ver `getDownloadUrl`), e o cabeçalho
 * `X-Content-Type-Options: nosniff` impede o navegador de reinterpretar o tipo.
 *
 * `js`, `sh`, `ts`, `py` e afins ficam LIBERADOS de propósito: são arquivos de
 * código legítimos, e este é um repositório pessoal de estudos.
 */
const BLOCKED_EXTENSIONS = [
  "exe", "bat", "cmd", "com", "cpl", "scr", "msi", "msp", "vbs", "vbe",
  "jse", "wsf", "wsh", "ps1", "jar", "app", "dll", "lnk", "reg", "hta",
];

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada");
  return { supabase, user };
}

function revalidate() {
  revalidatePath("/drive");
}

function fail(e: unknown): ActionResult {
  return { ok: false, error: e instanceof Error ? e.message : "Erro" };
}

function isBlocked(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return BLOCKED_EXTENSIONS.includes(ext);
}

/* ------------------------------------------------------------------ pastas */

export async function createFolder(input: unknown): Promise<ActionResult> {
  const parsed = driveFolderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("drive_folders")
      .insert({
        user_id: user.id,
        name: parsed.data.name,
        parent_id: parsed.data.parentId,
      })
      .select("id")
      .single();

    if (error) {
      return {
        ok: false,
        error:
          error.code === "23505"
            ? "Já existe uma pasta com esse nome aqui."
            : error.message,
      };
    }
    revalidate();
    return { ok: true, id: data.id as string };
  } catch (e) {
    return fail(e);
  }
}

export async function renameFolder(input: unknown): Promise<ActionResult> {
  const parsed = driveRenameSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Nome inválido" };
  }
  try {
    const { supabase } = await requireUser();
    const { error } = await supabase
      .from("drive_folders")
      .update({ name: parsed.data.name })
      .eq("id", parsed.data.id);
    if (error) {
      return {
        ok: false,
        error: error.code === "23505" ? "Já existe uma pasta com esse nome aqui." : error.message,
      };
    }
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function moveFolder(input: unknown): Promise<ActionResult> {
  const parsed = driveMoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Destino inválido" };
  try {
    const { supabase } = await requireUser();
    const { error } = await supabase
      .from("drive_folders")
      .update({ parent_id: parsed.data.targetFolderId })
      .eq("id", parsed.data.id);
    if (error) {
      // O trigger drive_prevent_folder_cycle levanta exceção nesse caso.
      const cycle = error.message.includes("subpasta") || error.message.includes("si mesma");
      return {
        ok: false,
        error: cycle ? "Não é possível mover uma pasta para dentro dela mesma." : error.message,
      };
    }
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Exclui a pasta e tudo abaixo dela.
 *
 * IMPORTANTE: o ON DELETE CASCADE do banco remove as LINHAS, mas os bytes no
 * Storage não somem sozinhos. Por isso coletamos os storage_path antes de
 * apagar e limpamos os objetos explicitamente — senão o espaço fica ocupado
 * por arquivos órfãos e invisíveis.
 */
export async function deleteFolder(id: string): Promise<ActionResult> {
  if (!lerUuid(id)) return { ok: false, error: ID_INVALIDO };
  try {
    const { supabase } = await requireUser();

    const { data: allFolders } = await supabase.from("drive_folders").select("id, parent_id");
    const folders = (allFolders as { id: string; parent_id: string | null }[] | null) ?? [];

    // Coleta descendentes por varredura iterativa (o guard evita loop caso
    // algum dado inconsistente escape do trigger).
    const toDelete = new Set<string>([id]);
    let changed = true;
    let guard = 0;
    while (changed && guard < 256) {
      changed = false;
      guard++;
      for (const f of folders) {
        if (f.parent_id && toDelete.has(f.parent_id) && !toDelete.has(f.id)) {
          toDelete.add(f.id);
          changed = true;
        }
      }
    }

    const ids = [...toDelete];
    const { data: files } = await supabase
      .from("drive_files")
      .select("storage_path")
      .in("folder_id", ids);

    const paths = (files as { storage_path: string }[] | null)?.map((f) => f.storage_path) ?? [];
    if (paths.length > 0) {
      await supabase.storage.from(BUCKET).remove(paths);
    }

    const { error } = await supabase.from("drive_folders").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };

    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* --------------------------------------------------------------- arquivos */

/**
 * Registra o metadado DEPOIS que o cliente enviou os bytes direto ao Storage.
 *
 * O upload não passa pelo servidor Next de propósito: rotas serverless têm
 * limite de corpo (~4,5 MB na Vercel) e passar o arquivo por lá dobraria a
 * banda. O cliente usa a sessão autenticada e a RLS do Storage garante que só
 * é possível escrever dentro da própria pasta.
 */
/**
 * Descarta o objeto já enviado quando o metadado não vai ser gravado.
 *
 * O upload acontece ANTES desta ação: quando ela recusa o registro, os bytes já
 * estão no bucket. Sem esta limpeza eles ficariam órfãos, invisíveis na
 * interface e consumindo cota para sempre — e a cota do plano gratuito é 1 GB.
 *
 * Nunca propaga erro: o que interessa devolver ao usuário é a causa original da
 * recusa, não uma falha de faxina.
 */
async function discardOrphan(input: unknown): Promise<void> {
  const path = (input as { storagePath?: unknown } | null)?.storagePath;
  if (typeof path !== "string" || path === "") return;
  try {
    const { supabase, user } = await requireUser();
    // Só remove o que é comprovadamente deste usuário. A RLS do Storage já
    // barraria o resto, mas checar aqui evita até a tentativa.
    if (!path.startsWith(`${user.id}/`)) return;
    await supabase.storage.from(BUCKET).remove([path]);
  } catch {
    /* sessão expirada ou Storage fora do ar — nada a fazer aqui */
  }
}

/**
 * Tamanho REAL do objeto, perguntado ao Storage.
 *
 * O `sizeBytes` que o cliente mandava era o `File.size` do navegador, e chegava
 * aqui como número solto num corpo de Server Action: qualquer cliente podia
 * enviar 40 MB e declarar 1 KB. Como `drive_usage` soma exatamente essa coluna,
 * a barra de armazenamento passava a descrever uma realidade inventada — e é a
 * barra que diz se ainda cabe alguma coisa no plano gratuito de 1 GB.
 *
 * Perguntar ao Storage resolve os DOIS problemas de uma vez, e o segundo é o mais
 * sério: além de trazer o tamanho verdadeiro, a resposta prova que o objeto
 * EXISTE. Antes, uma chamada direta a `registerFile` com um `storagePath`
 * inventado (mas começando com o uuid do próprio usuário, que é a única coisa
 * checada) criava uma linha apontando para o nada — arquivo fantasma na lista,
 * que só falharia na hora de baixar.
 *
 * O `info()` é o caminho normal. O `list()` fica como reserva porque o endpoint
 * `/object/info` não existe em versões mais antigas do storage-api, e um recurso
 * de escrita não pode depender de um endpoint recente para funcionar.
 */
async function tamanhoRealNoStorage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storagePath: string,
): Promise<number | null> {
  const { data, error } = await supabase.storage.from(BUCKET).info(storagePath);
  if (!error && typeof data?.size === "number") return data.size;

  const barra = storagePath.lastIndexOf("/");
  const pasta = barra === -1 ? "" : storagePath.slice(0, barra);
  const nome = storagePath.slice(barra + 1);

  // `search` do Storage é correspondência PARCIAL, não igualdade: pedir "abc"
  // traz também "abcd". O `find` por nome exato é o que fecha isso.
  const { data: itens } = await supabase.storage
    .from(BUCKET)
    .list(pasta, { search: nome, limit: 100 });
  const achado = itens?.find((o) => o.name === nome);
  const tamanho = (achado?.metadata as { size?: unknown } | null | undefined)?.size;
  return typeof tamanho === "number" ? tamanho : null;
}

export async function registerFile(input: unknown): Promise<ActionResult> {
  const parsed = driveFileRegisterSchema.safeParse(input);
  if (!parsed.success) {
    // Ex.: nome com caractere inválido ou longo demais. O arquivo já subiu.
    await discardOrphan(input);
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  try {
    const { supabase, user } = await requireUser();
    const i = parsed.data;

    if (isBlocked(i.name)) {
      await supabase.storage.from(BUCKET).remove([i.storagePath]);
      return { ok: false, error: "Este tipo de arquivo não é permitido." };
    }

    // O caminho precisa começar pelo uuid do dono — mesma regra da policy.
    if (!i.storagePath.startsWith(`${user.id}/`)) {
      return { ok: false, error: "Caminho inválido." };
    }

    // FALHA FECHADA de propósito: sem conseguir medir, não registra.
    // A alternativa seria cair de volta no número do cliente, que é exatamente o
    // que esta checagem existe para não fazer. O objeto é removido junto — ele
    // acabou de subir, não tem metadado nenhum apontando para ele, e deixá-lo no
    // bucket seria lixo invisível ocupando cota para sempre. `remove` de um
    // caminho inexistente não é erro, então o caso do objeto que nunca chegou
    // passa por aqui sem tratamento especial.
    const sizeBytes = await tamanhoRealNoStorage(supabase, i.storagePath);
    if (sizeBytes === null) {
      await supabase.storage.from(BUCKET).remove([i.storagePath]);
      return {
        ok: false,
        error: "Não foi possível confirmar o envio no armazenamento. Tente de novo.",
      };
    }

    const { data, error } = await supabase
      .from("drive_files")
      .insert({
        user_id: user.id,
        folder_id: i.folderId,
        name: i.name,
        storage_path: i.storagePath,
        mime_type: i.mimeType,
        // Do Storage, nunca do cliente. Ver `tamanhoRealNoStorage`.
        size_bytes: sizeBytes,
      })
      .select("id")
      .single();

    if (error) {
      // Metadado falhou → remove o objeto para não deixar lixo no bucket.
      await supabase.storage.from(BUCKET).remove([i.storagePath]);
      return {
        ok: false,
        error:
          error.code === "23505"
            ? "Já existe um arquivo com esse nome nesta pasta."
            : error.message,
      };
    }

    revalidate();
    return { ok: true, id: data.id as string };
  } catch (e) {
    // Exceção inesperada depois do upload: mesmo raciocínio da validação.
    await discardOrphan(input);
    return fail(e);
  }
}

export async function renameFile(input: unknown): Promise<ActionResult> {
  const parsed = driveRenameSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Nome inválido" };
  }
  if (isBlocked(parsed.data.name)) {
    return { ok: false, error: "Este tipo de arquivo não é permitido." };
  }
  try {
    const { supabase } = await requireUser();
    // Renomear altera só o metadado — o objeto no Storage não se move.
    const { error } = await supabase
      .from("drive_files")
      .update({ name: parsed.data.name })
      .eq("id", parsed.data.id);
    if (error) {
      return {
        ok: false,
        error: error.code === "23505" ? "Já existe um arquivo com esse nome aqui." : error.message,
      };
    }
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function moveFile(input: unknown): Promise<ActionResult> {
  const parsed = driveMoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Destino inválido" };
  try {
    const { supabase } = await requireUser();
    const { error } = await supabase
      .from("drive_files")
      .update({ folder_id: parsed.data.targetFolderId })
      .eq("id", parsed.data.id);
    if (error) {
      return {
        ok: false,
        error: error.code === "23505" ? "Já existe um arquivo com esse nome no destino." : error.message,
      };
    }
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Lixeira: soft delete. Os bytes só somem no esvaziamento definitivo. */
export async function trashFile(id: string): Promise<ActionResult> {
  if (!lerUuid(id)) return { ok: false, error: ID_INVALIDO };
  try {
    const { supabase } = await requireUser();
    const { error } = await supabase
      .from("drive_files")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreFile(id: string): Promise<ActionResult> {
  if (!lerUuid(id)) return { ok: false, error: ID_INVALIDO };
  try {
    const { supabase } = await requireUser();
    const { error } = await supabase
      .from("drive_files")
      .update({ deleted_at: null })
      .eq("id", id);
    if (error) {
      return {
        ok: false,
        error:
          error.code === "23505"
            ? "Já existe um arquivo com esse nome no destino original."
            : error.message,
      };
    }
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteFilePermanently(id: string): Promise<ActionResult> {
  if (!lerUuid(id)) return { ok: false, error: ID_INVALIDO };
  try {
    const { supabase } = await requireUser();
    const { data: file } = await supabase
      .from("drive_files")
      .select("storage_path")
      .eq("id", id)
      .maybeSingle();

    const path = (file as { storage_path: string } | null)?.storage_path;
    const { error } = await supabase.from("drive_files").delete().eq("id", id);
    if (error) return { ok: false, error: error.message };

    if (path) await supabase.storage.from(BUCKET).remove([path]);
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function toggleStar(id: string, starred: boolean): Promise<ActionResult> {
  if (!lerUuid(id)) return { ok: false, error: ID_INVALIDO };
  try {
    const { supabase } = await requireUser();
    const { error } = await supabase.from("drive_files").update({ starred }).eq("id", id);
    if (error) return { ok: false, error: error.message };
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** URL assinada de curta duração para download/preview. */
export async function getDownloadUrl(id: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!lerUuid(id)) return { ok: false, error: ID_INVALIDO };
  try {
    const { supabase } = await requireUser();
    const { data: file } = await supabase
      .from("drive_files")
      .select("storage_path, name")
      .eq("id", id)
      .maybeSingle();

    const row = file as { storage_path: string; name: string } | null;
    if (!row) return { ok: false, error: "Arquivo não encontrado" };

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(row.storage_path, 60, { download: row.name });

    if (error || !data) return { ok: false, error: error?.message ?? "Falha ao gerar link" };
    return { ok: true, url: data.signedUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}
