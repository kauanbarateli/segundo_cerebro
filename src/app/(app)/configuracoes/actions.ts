"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  profileInputSchema,
  moduleToggleSchema,
  notificationPreferencesSchema,
  socialLinkSchema,
  socialLinkUpdateSchema,
  socialLinkReorderSchema,
  TAMANHO_MAXIMO_DO_LABEL,
} from "@/lib/validation";
import { MODULE_BY_KEY } from "@/lib/modules";
import { LIMITE_DE_LINKS } from "@/lib/social";
import { bloqueioPorLimite } from "@/lib/rate-limit";

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sessão expirada");
  return { supabase, user };
}

function revalidateShell() {
  revalidatePath("/", "layout");
}

/* ------------------------------------------------------------------- perfil */

export async function updateProfile(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const parsed = profileInputSchema.safeParse({ displayName: formData.get("displayName") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }
  try {
    const { supabase, user } = await requireUser();
    const { error } = await supabase
      .from("profiles")
      .update({ display_name: parsed.data.displayName })
      .eq("id", user.id);
    if (error) return { ok: false, error: error.message };
    revalidateShell();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/* ------------------------------------------------------------------- avatar */

const ALLOWED_AVATAR_MIME = ["image/webp", "image/jpeg", "image/png"];
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/**
 * Recebe o arquivo já redimensionado pelo cliente. Ainda assim revalida MIME e
 * tamanho aqui — o cliente é controlável pelo usuário e não é fonte confiável.
 */
export async function updateAvatar(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  try {
    const { supabase, user } = await requireUser();
    const file = formData.get("file");
    if (!(file instanceof File)) return { ok: false, error: "Arquivo ausente" };

    if (!ALLOWED_AVATAR_MIME.includes(file.type)) {
      return { ok: false, error: "Formato não suportado. Use JPG, PNG ou WebP." };
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return { ok: false, error: "Imagem maior que 2 MB." };
    }

    // Extensão derivada do MIME, nunca do nome enviado.
    const ext = file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : "webp";
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) return { ok: false, error: uploadError.message };

    // Guarda o caminho anterior para remover depois de trocar com sucesso.
    const { data: profile } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: path })
      .eq("id", user.id);
    if (error) {
      await supabase.storage.from("avatars").remove([path]);
      return { ok: false, error: error.message };
    }

    const previous = (profile as { avatar_url: string | null } | null)?.avatar_url;
    if (previous && previous !== path) {
      await supabase.storage.from("avatars").remove([previous]);
    }

    revalidateShell();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

export async function removeAvatar(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { supabase, user } = await requireUser();
    const { data: profile } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    const path = (profile as { avatar_url: string | null } | null)?.avatar_url;
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: null })
      .eq("id", user.id);
    if (error) return { ok: false, error: error.message };

    if (path) await supabase.storage.from("avatars").remove([path]);
    revalidateShell();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/* ------------------------------------------------------------------ módulos */

export async function toggleModule(
  moduleKey: string,
  enabled: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const parsed = moduleToggleSchema.safeParse({ moduleKey, enabled });
  if (!parsed.success) return { ok: false, error: "Módulo inválido" };

  const def = MODULE_BY_KEY.get(parsed.data.moduleKey);
  if (!def) return { ok: false, error: "Módulo desconhecido" };
  // Guard de servidor: um módulo essencial nunca pode ser desligado, mesmo que
  // a requisição venha fabricada.
  if (def.core && !parsed.data.enabled) {
    return { ok: false, error: "Este módulo é essencial e não pode ser desativado." };
  }

  try {
    const { supabase, user } = await requireUser();
    const { error } = await supabase.from("user_modules").upsert(
      { user_id: user.id, module_key: parsed.data.moduleKey, enabled: parsed.data.enabled },
      { onConflict: "user_id,module_key" },
    );
    if (error) return { ok: false, error: error.message };
    revalidateShell();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/* ------------------------------------------------------------- notificações */

export async function updateNotificationPreferences(input: {
  notificationsEnabled: boolean;
  leadMinutes: number[];
  channel: "in_app" | "push" | "both";
}): Promise<{ ok: boolean; error?: string }> {
  const parsed = notificationPreferencesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Preferência inválida" };
  }
  try {
    const { supabase, user } = await requireUser();
    const { error } = await supabase.from("user_preferences").upsert(
      {
        user_id: user.id,
        notifications_enabled: parsed.data.notificationsEnabled,
        // Ordena decrescente para o aviso mais distante vir primeiro na UI.
        notification_lead_minutes: [...parsed.data.leadMinutes].sort((a, b) => b - a),
        notification_channel: parsed.data.channel,
      },
      { onConflict: "user_id" },
    );
    if (error) return { ok: false, error: error.message };
    revalidateShell();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/* ------------------------------------------------------- privacidade valores */

export async function toggleFinanceHideValues(
  hide: boolean,
): Promise<{ ok: boolean; error?: string }> {
  // `boolean` é tipo de compilação; o valor chega pela rede. Sem esta checagem,
  // uma string vai direto para a coluna e o Postgres recusa com erro de cast.
  if (typeof hide !== "boolean") return { ok: false, error: "Valor inválido." };
  try {
    const { supabase, user } = await requireUser();
    const { error } = await supabase
      .from("user_preferences")
      .upsert({ user_id: user.id, finance_hide_values: hide }, { onConflict: "user_id" });
    if (error) return { ok: false, error: error.message };
    revalidateShell();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/* ------------------------------------------------------------- redes sociais */

interface SocialResult {
  ok: boolean;
  error?: string;
  id?: string;
}

/**
 * O bloco de links aparece em DUAS páginas de servidor: a lista discreta no fim
 * da Início e o painel de edição em Configurações. Invalidar só uma delas
 * produziria o pior tipo de incoerência — a pessoa salva, vê o painel atualizado
 * e continua encontrando o link antigo na tela inicial, achando que não salvou.
 *
 * `revalidatePath("/")` sem o segundo argumento invalida a PÁGINA "/", que é o
 * que interessa aqui: os links não estão no layout compartilhado (a barra
 * lateral não os mostra), então derrubar o cache do shell inteiro com
 * `revalidateShell()` seria cobrar de todas as rotas o preço de um dado que só
 * duas usam.
 */
function revalidarLinks() {
  revalidatePath("/");
  revalidatePath("/configuracoes");
}

/**
 * Traduz o erro do PostgREST em uma frase que serve ao usuário.
 *
 * A trigger de limite da 0012 levanta SQLSTATE 23514 (check_violation) com a
 * mensagem literal "Limite de 8 links sociais por usuario atingido". O código
 * 23514 sozinho NÃO serve de discriminador: os CHECK comuns da tabela (https,
 * tamanho, rótulo em branco) devolvem exatamente o mesmo código. Por isso o teste
 * é pelo trecho "links sociais", que só a trigger produz.
 *
 * A mensagem do banco vem sem acentos DE PROPÓSITO (mesma escolha de 0009), para
 * que este casamento por texto não dependa de encoding no caminho até aqui.
 */
function mensagemDoBanco(error: { code?: string; message: string }): string {
  if (error.message.includes("links sociais")) {
    return `Você já tem ${LIMITE_DE_LINKS} links. Remova um antes de adicionar outro.`;
  }
  // 23505 = unique_violation. Só há um índice único que o usuário consegue
  // violar: (user_id, url), o que impede o mesmo endereço duas vezes.
  if (error.code === "23505") {
    return "Esse endereço já está na sua lista.";
  }
  if (error.message.includes("social_links_url_https")) {
    return "Só endereços https:// são aceitos.";
  }
  if (error.message.includes("social_links_label")) {
    return `O rótulo precisa ter de 1 a ${TAMANHO_MAXIMO_DO_LABEL} caracteres.`;
  }
  return error.message;
}

/**
 * Cria um link.
 *
 * O LIMITE É CHECADO AQUI **E** NO BANCO, e os dois têm papéis diferentes: esta
 * checagem existe para dar uma frase em português antes de tentar gravar; a
 * trigger `trg_social_links_limit` da 0012 é que GARANTE o teto — inclusive
 * contra a corrida que esta contagem tem por natureza (duas abas contando 7 ao
 * mesmo tempo). Se a trigger reprovar, `mensagemDoBanco` devolve o mesmo texto.
 * Trocar a ordem — confiar só na trigger — daria uma mensagem crua de constraint
 * no toast; confiar só nesta contagem deixaria o limite furado.
 */
export async function createSocialLink(input: {
  label: string;
  url: string;
}): Promise<SocialResult> {
  const parsed = socialLinkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  try {
    const { supabase, user } = await requireUser();

    /*
      Aqui o limite de taxa NÃO é sobre volume de dados — o teto de 8 links da
      0012 já garante que a tabela não cresce. É sobre TRABALHO: cada tentativa
      custa um SELECT e um INSERT que a trigger de limite recusa, e um laço
      contra uma conta cheia vira carga gratuita no banco com zero linhas de
      resultado. Um limite de taxa é o único freio que atua ANTES do banco.
    */
    const bloqueio = bloqueioPorLimite("social:link", user.id);
    if (bloqueio) return bloqueio;

    // UMA consulta responde as DUAS perguntas: quantos links já existem (limite)
    // e qual a maior posição (onde o novo entra). Um `count: "exact"` seguido de
    // um `max(position)` seriam duas idas ao banco para ler as mesmas oito
    // linhas. A RLS já restringe ao dono.
    const { data: existentes, error: erroLeitura } = await supabase
      .from("social_links")
      .select("position");
    if (erroLeitura) return { ok: false, error: erroLeitura.message };

    const linhas = (existentes as { position: number }[] | null) ?? [];
    if (linhas.length >= LIMITE_DE_LINKS) {
      return {
        ok: false,
        error: `Você já tem ${LIMITE_DE_LINKS} links. Remova um antes de adicionar outro.`,
      };
    }

    // `max + 1` e não `length`: depois de remover o link do meio, as posições
    // ficam 0, 1, 3 — e `length` (3) colidiria com a última. Empate não quebra
    // nada (a leitura desempata por created_at), mas o novo link apareceria
    // grudado no meio da lista em vez de no fim, que é onde a pessoa espera.
    const proximaPosicao = linhas.reduce((maior, l) => Math.max(maior, l.position), -1) + 1;

    const { data, error } = await supabase
      .from("social_links")
      .insert({
        // O dono vem de auth.getUser(), NUNCA do cliente. Mesmo que viesse, a
        // policy de insert (`with check (auth.uid() = user_id)`) recusaria — mas
        // depender disso seria escrever uma linha que só não é um defeito por
        // causa de outra camada.
        user_id: user.id,
        label: parsed.data.label,
        // Já canonizada pelo schema (urlSegura). O banco confere de novo.
        url: parsed.data.url,
        position: proximaPosicao,
      })
      .select("id");
    if (error) return { ok: false, error: mensagemDoBanco(error) };

    // INSERT que não devolve linha significa que a policy de insert barrou sem
    // levantar erro. Sem esta checagem a interface comemoraria o que não gravou.
    const id = (data as { id: string }[] | null)?.[0]?.id;
    if (!id) return { ok: false, error: "Não foi possível salvar o link." };

    revalidarLinks();
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/**
 * Edita rótulo e endereço.
 *
 * Só essas duas colunas entram no `update`. `position` fica de fora porque quem
 * a define é `reorderSocialLinks`, e `user_id` porque trocar dono é justamente o
 * que o trigger `prevent_user_id_change` (0001) existe para impedir — mandá-lo
 * aqui, mesmo com o valor certo, seria convidar o defeito.
 */
export async function updateSocialLink(input: {
  id: string;
  label: string;
  url: string;
}): Promise<SocialResult> {
  const parsed = socialLinkUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  try {
    const { supabase } = await requireUser();
    // Sem `.eq("user_id", ...)`: a RLS já restringe ao dono. O que ela NÃO dá é
    // aviso — um UPDATE que não casa com nenhuma linha (id apagado em outra aba,
    // ou de outra pessoa, que para a RLS é a mesma coisa) volta com
    // `error: null` e zero linhas. O `.select("id")` transforma esse silêncio em
    // erro visível.
    const { data, error } = await supabase
      .from("social_links")
      .update({ label: parsed.data.label, url: parsed.data.url })
      .eq("id", parsed.data.id)
      .select("id");
    if (error) return { ok: false, error: mensagemDoBanco(error) };
    if (!data || data.length === 0) return { ok: false, error: "Link não encontrado." };

    revalidarLinks();
    return { ok: true, id: parsed.data.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

export async function deleteSocialLink(id: string): Promise<SocialResult> {
  // Validar o uuid ANTES do banco: um id malformado não vira "0 linhas", vira
  // erro de cast do Postgres e a mensagem crua acabaria na tela.
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "Link não encontrado." };

  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from("social_links")
      .delete()
      .eq("id", parsed.data)
      .select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: "Link não encontrado." };

    revalidarLinks();
    return { ok: true, id: parsed.data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}

/**
 * Grava a nova ordem: `ids` na sequência em que devem aparecer.
 *
 * POR QUE UM LOTE SÓ, E NÃO N UPDATES. Oito `update ... where id = ?` são oito
 * requisições HTTP independentes, cada uma na sua transação. A quarta falha (rede
 * caiu, sessão expirou) e a lista fica com metade renumerada: uma ordem que não é
 * a antiga nem a nova, e que ninguém pediu. Aqui é UM `insert ... on conflict do
 * update`, ou seja, UMA instrução e UMA transação — ou toda a ordem entra, ou
 * nada muda.
 *
 * POR QUE O LOTE É MONTADO COM DADO LIDO DO BANCO, E NÃO COM O QUE O CLIENTE
 * MANDOU. O upsert do PostgREST precisa das colunas `not null` (`label`, `url`)
 * no corpo: as ausentes assumiriam o default, e como não há default para elas o
 * Postgres reprovaria a instrução inteira por not-null — a checagem de
 * constraints acontece ANTES da resolução do conflito, então nem as linhas que
 * "só iam atualizar" escapariam. Aceitar `label` e `url` do cliente resolveria o
 * not-null e criaria um problema pior: reordenar viraria um caminho de escrita
 * capaz de REESCREVER o texto e o endereço de qualquer link, sem passar pelo
 * formulário de edição. Por isso os valores vêm do `select` logo abaixo.
 *
 * POR QUE UM ID DE OUTRA PESSOA NÃO PASSA — quatro camadas, e a primeira já
 * basta:
 *
 *   1. O `select` roda sob a RLS (`using (auth.uid() = user_id)`), então o id
 *      alheio simplesmente NÃO VOLTA. Sem ele no mapa, o laço aborta e nada é
 *      escrito. É aqui que a defesa realmente acontece.
 *   2. Se por absurdo entrasse no lote: no `insert ... on conflict do update` a
 *      RLS é aplicada duas vezes — a policy de INSERT confere a linha proposta e
 *      a de UPDATE confere a linha EXISTENTE pelo `using`. A linha existente é de
 *      outro dono, o `using` reprova, e nesse caminho o Postgres LEVANTA ERRO em
 *      vez de pular a linha em silêncio (é o comportamento específico do ON
 *      CONFLICT DO UPDATE). A instrução inteira falha; nada é gravado.
 *   3. CRIAR linha nova é impossível: todo id do lote veio de um `select` de
 *      linhas existentes, logo todo id colide e cai no ramo do UPDATE. E o
 *      `user_id` enviado é o de `auth.getUser()`, nunca o do cliente.
 *   4. SOBRESCREVER o dono é impossível: mandamos o nosso próprio `user_id` na
 *      nossa própria linha (nada muda), e qualquer troca real seria recusada pelo
 *      trigger `prevent_user_id_change` da 0001.
 *
 * POR QUE ESTE UPSERT NÃO ESBARRA NO TETO DE 8 — e por que a resposta NÃO é
 * "porque estas linhas caem no ramo do update". No Postgres as triggers BEFORE
 * INSERT por linha rodam ANTES da detecção do conflito: toda linha do lote passa
 * por `trg_social_links_limit`, inclusive as que vão terminar em DO UPDATE. Se a
 * trigger contasse as linhas do usuário em todas elas, quem está com as 8 vagas
 * ocupadas — o estado que este mesmo painel incentiva, exibindo "8 de 8" — teria
 * a instrução inteira abortada com "Limite de 8 links sociais por usuario
 * atingido" ao simplesmente ARRASTAR um item. Quem fecha isso é a trigger da
 * 0012, que sai antes de contar quando o id proposto já existe (linha que já
 * existe não aumenta a conta). Trocar o upsert por N updates para escapar da
 * trigger seria pior: voltaria a meia reordenação descrita acima.
 *
 * Janela conhecida e aceita: se a pessoa APAGAR um link em outra aba entre o
 * `select` e o `upsert`, o lote recria aquela linha com os mesmos id, rótulo e
 * endereço — ela "ressuscita". É a própria linha do próprio usuário; aí o id
 * realmente não existe mais, a trigger conta de verdade (o teto de 8 continua
 * valendo, e como uma linha acabou de sair a conta cabe) e apagar de novo
 * resolve. Fechar essa janela exigiria a renumeração dentro de uma função do
 * banco, o que é mais superfície do que o problema pede.
 */
export async function reorderSocialLinks(ids: string[]): Promise<SocialResult> {
  const parsed = socialLinkReorderSchema.safeParse({ ids });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Ordem inválida" };
  }
  const ordem = parsed.data.ids;

  try {
    const { supabase, user } = await requireUser();

    const { data: atuais, error: erroLeitura } = await supabase
      .from("social_links")
      .select("id, label, url")
      .in("id", ordem);
    if (erroLeitura) return { ok: false, error: erroLeitura.message };

    const porId = new Map(
      ((atuais as { id: string; label: string; url: string }[] | null) ?? []).map((l) => [l.id, l]),
    );

    const lote: {
      id: string;
      user_id: string;
      label: string;
      url: string;
      position: number;
    }[] = [];
    for (const [indice, id] of ordem.entries()) {
      const linha = porId.get(id);
      // Id que não voltou do banco: apagado em outra aba, ou de outra pessoa —
      // a RLS não distingue os dois casos, e a mensagem também não deve
      // distinguir (dizer "esse link é de outro usuário" confirmaria que ele
      // existe). Aborta ANTES de escrever qualquer coisa: meia reordenação é
      // pior que nenhuma.
      if (!linha) {
        return { ok: false, error: "A lista mudou em outra aba. Recarregue a página." };
      }
      lote.push({
        id,
        user_id: user.id,
        label: linha.label,
        url: linha.url,
        position: indice,
      });
    }

    const { data, error } = await supabase
      .from("social_links")
      .upsert(lote, { onConflict: "id" })
      .select("id");
    if (error) return { ok: false, error: mensagemDoBanco(error) };
    if (!data || data.length !== lote.length) {
      return { ok: false, error: "Não foi possível salvar a nova ordem." };
    }

    revalidarLinks();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro" };
  }
}
