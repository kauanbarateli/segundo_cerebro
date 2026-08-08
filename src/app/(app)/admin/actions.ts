"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMaster } from "@/lib/guards";
import { bloqueioPorLimite } from "@/lib/rate-limit";
import { ID_INVALIDO, lerUuid } from "@/lib/validation";
import type { ActionResult } from "@/lib/action-types";

/**
 * Server Actions da área administrativa.
 *
 * =============================================================================
 * ⚠️ A REGRA DESTE ARQUIVO, EM UMA LINHA
 * =============================================================================
 * `await requireMaster()` é a PRIMEIRA linha de toda função exportada daqui.
 * Não a segunda, não depois do parse do input — a primeira.
 *
 * O motivo está no cabeçalho de `requireMaster`, e vale repetir porque é
 * contraintuitivo: uma Server Action **é um endpoint HTTP**. O Next publica um
 * id por função exportada, e um POST para esse id não passa por layout, não
 * renderiza página e não vê guarda de rota nenhuma. A guarda de
 * `admin/layout.tsx` protege a TELA; esta linha protege a OPERAÇÃO.
 *
 * =============================================================================
 * ⚠️ POR QUE `service_role` AQUI, E O QUE ISSO EXIGE
 * =============================================================================
 * Estas operações leem `auth.users` e escrevem `user_roles` — coisas que a RLS
 * do usuário comum não alcança, e que ela NÃO DEVE alcançar. A alternativa
 * seria afrouxar as policies do produto para o master, e essa é a mudança mais
 * arriscada possível: um erro numa condição abre o dado de todo mundo em
 * silêncio.
 *
 * `service_role` IGNORA RLS por natureza. Isso transfere para este arquivo uma
 * responsabilidade que a RLS carregava sozinha: toda consulta aqui precisa
 * filtrar explicitamente pelo que pretende alcançar. Não há rede de proteção
 * embaixo.
 */

/** Trilha de auditoria. Ver `admin_audit_events` na 0021. */
async function auditar(
  atorId: string,
  acao: string,
  alvoId: string | null,
  alvoEmail: string | null,
  detalhe?: Record<string, unknown>,
): Promise<void> {
  try {
    await createAdminClient()
      .from("admin_audit_events")
      .insert({
        ator_id: atorId,
        acao,
        alvo_id: alvoId,
        alvo_email: alvoEmail,
        detalhe: detalhe ?? null,
      });
  } catch {
    /*
      A auditoria NÃO derruba a operação — e a escolha merece registro, porque
      o inverso também é defensável.

      O argumento decisivo: se a auditoria falhar (tabela cheia, rede oscilando)
      e ela abortasse a ação, o efeito seria a área administrativa parar de
      funcionar por causa do log. Bloquear alguém que precisa ser bloqueado
      AGORA é mais importante que registrar que foi bloqueado.

      A contrapartida honesta: existe uma janela em que a ação acontece sem
      registro. Ela é estreita e o modo de falha é conhecido.
    */
  }
}

export interface UsuarioAdmin {
  id: string;
  email: string;
  displayName: string | null;
  criadoEm: string;
  ultimoLogin: string | null;
  bloqueado: boolean;
  bloqueadoEm: string | null;
  motivo: string | null;
  papel: "user" | "admin" | "master";
  /** Sessão nos últimos 30 dias e não bloqueado. Ver `listarUsuarios`. */
  ativo: boolean;
}

/** Um mês de silêncio já é "não está usando". Ver `UsuarioAdmin.ativo`. */
const DIAS_PARA_CONSIDERAR_ATIVO = 30;

/**
 * Lista os usuários — METADADO apenas.
 *
 * ⚠️ O QUE ESTA FUNÇÃO NÃO DEVOLVE, e não por esquecimento: nada de conteúdo.
 * Nem tarefa, nem nota, nem lançamento, nem — em hipótese alguma — Cofre. O
 * master administra CONTAS, não lê a vida das pessoas. E o Cofre continuaria
 * ilegível mesmo se ele tentasse: é cifrado de ponta a ponta com chave derivada
 * da senha mestra do dono, e o banco guarda apenas ciphertext.
 */
export async function listarUsuarios(): Promise<
  { ok: true; usuarios: UsuarioAdmin[] } | { ok: false; error: string }
> {
  try {
    await requireMaster();
    const admin = createAdminClient();

    // A API de Auth não expõe join com `public.*`, então são três leituras e a
    // costura é feita aqui. `perPage` alto porque este produto não terá mil
    // usuários — e se um dia tiver, a paginação entra com a tela que a mostra.
    const { data: lista, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) return { ok: false, error: "Não foi possível listar os usuários." };

    const ids = lista.users.map((u) => u.id);

    const [{ data: perfis }, { data: papeis }] = await Promise.all([
      admin.from("profiles").select("id, display_name, status, blocked_at, blocked_reason").in("id", ids),
      admin.from("user_roles").select("user_id, role").in("user_id", ids),
    ]);

    const perfilPorId = new Map(
      (
        (perfis as
          | {
              id: string;
              display_name: string | null;
              status: string;
              blocked_at: string | null;
              blocked_reason: string | null;
            }[]
          | null) ?? []
      ).map((p) => [p.id, p]),
    );
    const papelPorId = new Map(
      ((papeis as { user_id: string; role: UsuarioAdmin["papel"] }[] | null) ?? []).map((r) => [
        r.user_id,
        r.role,
      ]),
    );

    const corte = Date.now() - DIAS_PARA_CONSIDERAR_ATIVO * 86_400_000;

    const usuarios: UsuarioAdmin[] = lista.users.map((u) => {
      const perfil = perfilPorId.get(u.id);
      const bloqueado = perfil?.status === "blocked";
      const ultimoLogin = u.last_sign_in_at ?? null;

      return {
        id: u.id,
        email: u.email ?? "",
        displayName: perfil?.display_name ?? null,
        criadoEm: u.created_at,
        ultimoLogin,
        bloqueado,
        bloqueadoEm: perfil?.blocked_at ?? null,
        motivo: perfil?.blocked_reason ?? null,
        papel: papelPorId.get(u.id) ?? "user",
        /*
          "Ativo" exige as DUAS coisas: não estar bloqueado E ter aparecido no
          último mês. Contar só o login diria que um usuário bloqueado ontem
          continua ativo — e é justamente esse número que alguém olharia para
          saber quantas pessoas de fato usam o sistema.
        */
        ativo: !bloqueado && ultimoLogin !== null && new Date(ultimoLogin).getTime() > corte,
      };
    });

    usuarios.sort((a, b) => (a.criadoEm < b.criadoEm ? -1 : 1));
    return { ok: true, usuarios };
  } catch {
    return { ok: false, error: "Sem permissão." };
  }
}

const criarSchema = z.object({
  email: z.string().trim().email("E-mail inválido").max(160),
  // 12 e não 8: esta senha é criada POR OUTRA PESSOA e comunicada por algum
  // canal — vale exigir mais do que o mínimo comum.
  senha: z.string().min(12, "A senha precisa de ao menos 12 caracteres").max(200),
  displayName: z.string().trim().max(60).optional(),
});

/**
 * Cadastra um usuário.
 *
 * `email_confirm: true` porque quem cria a conta é o administrador, que já sabe
 * quem é a pessoa — exigir que ela confirme um e-mail que ele mesmo digitou
 * seria cerimônia sem ganho. O cadastro público continua desativado.
 *
 * ⚠️ Não é preciso criar perfil, preferências nem módulos aqui: o trigger
 * `handle_new_user` (0001) provisiona tudo na mesma transação do INSERT em
 * `auth.users`. Repetir isso aqui produziria a segunda definição do que é um
 * usuário novo — e as duas divergiriam na primeira coluna nova.
 */
export async function criarUsuario(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireMaster();

    const bloqueio = bloqueioPorLimite("admin:escrita", ctx.userId);
    if (bloqueio) return bloqueio;

    const parsed = criarSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
    }

    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email: parsed.data.email,
      password: parsed.data.senha,
      email_confirm: true,
      user_metadata: parsed.data.displayName ? { display_name: parsed.data.displayName } : undefined,
    });

    if (error || !data.user) {
      return {
        ok: false,
        error: error?.message.includes("already")
          ? "Já existe uma conta com esse e-mail."
          : "Não foi possível criar o usuário.",
      };
    }

    await auditar(ctx.userId, "usuario_criado", data.user.id, parsed.data.email);
    revalidatePath("/admin");
    return { ok: true, id: data.user.id };
  } catch {
    return { ok: false, error: "Sem permissão." };
  }
}

const bloquearSchema = z.object({
  userId: z.string().uuid(ID_INVALIDO),
  motivo: z.string().trim().max(200).optional(),
});

/**
 * BLOQUEIA um usuário — nas DUAS camadas, e nenhuma delas é dispensável.
 *
 * =============================================================================
 * POR QUE DUAS
 * =============================================================================
 *   `ban_duration` no Auth   impede login NOVO. Sozinho, quem já está logado
 *                            continua usando o app até o JWT expirar — e para
 *                            um bloqueio que existe porque alguém precisa parar
 *                            agora, "até uma hora depois" não serve.
 *
 *   `profiles.status`        é lido por `getAppContext()` em TODA navegação, e
 *                            derruba a sessão já emitida no clique seguinte.
 *                            Sozinho, ele não impediria um login novo.
 *
 * A ordem é: banir primeiro, marcar depois. Se a segunda falhar, o pior caso é
 * um usuário que não consegue mais entrar mas termina a sessão atual — bem
 * melhor que o inverso (marcado como bloqueado e ainda conseguindo entrar).
 *
 * "876000h" são cem anos. O Supabase não tem ban permanente; é a forma
 * idiomática de dizer "até segunda ordem".
 */
export async function bloquearUsuario(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireMaster();

    const bloqueio = bloqueioPorLimite("admin:escrita", ctx.userId);
    if (bloqueio) return bloqueio;

    const parsed = bloquearSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: ID_INVALIDO };

    /*
      ⚠️ NINGUÉM SE AUTOBLOQUEIA.

      Sem esta linha, um clique errado na própria linha da lista tranca o único
      master para fora do sistema — e não há tela para desfazer, porque a tela
      exige ser master. A saída seria o SQL editor do Supabase.
    */
    if (parsed.data.userId === ctx.userId) {
      return { ok: false, error: "Você não pode bloquear a si mesmo." };
    }

    const admin = createAdminClient();

    const { data: alvo } = await admin.auth.admin.getUserById(parsed.data.userId);
    if (!alvo.user) return { ok: false, error: ID_INVALIDO };

    /*
      ⚠️ O ÚLTIMO MASTER NÃO PODE SER BLOQUEADO.

      Dois masters bloqueando um ao outro deixariam o sistema sem ninguém capaz
      de administrar. A contagem é feita agora, não em cache: é uma consulta
      barata contra a decisão irreversível de perder o acesso administrativo.
    */
    const impedimento = await impedirPerdaDoUltimoMaster(parsed.data.userId);
    if (impedimento) return impedimento;

    const { error: erroBan } = await admin.auth.admin.updateUserById(parsed.data.userId, {
      ban_duration: "876000h",
    });
    if (erroBan) return { ok: false, error: "Não foi possível bloquear." };

    await admin
      .from("profiles")
      .update({
        status: "blocked",
        blocked_at: new Date().toISOString(),
        blocked_reason: parsed.data.motivo ?? null,
        blocked_by: ctx.userId,
      })
      .eq("id", parsed.data.userId);

    await auditar(ctx.userId, "usuario_bloqueado", parsed.data.userId, alvo.user.email ?? null, {
      motivo: parsed.data.motivo ?? null,
    });
    revalidatePath("/admin");
    return { ok: true, id: parsed.data.userId };
  } catch {
    return { ok: false, error: "Sem permissão." };
  }
}

/** Desbloqueia — desfaz as duas camadas, na ordem inversa. */
export async function desbloquearUsuario(userId: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireMaster();

    const bloqueio = bloqueioPorLimite("admin:escrita", ctx.userId);
    if (bloqueio) return bloqueio;

    const id = lerUuid(userId);
    if (!id) return { ok: false, error: ID_INVALIDO };

    const admin = createAdminClient();

    // `"none"` é como o Supabase remove um ban.
    const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: "none" });
    if (error) return { ok: false, error: "Não foi possível desbloquear." };

    await admin
      .from("profiles")
      .update({ status: "active", blocked_at: null, blocked_reason: null, blocked_by: null })
      .eq("id", id);

    const { data: alvo } = await admin.auth.admin.getUserById(id);
    await auditar(ctx.userId, "usuario_desbloqueado", id, alvo.user?.email ?? null);
    revalidatePath("/admin");
    return { ok: true, id };
  } catch {
    return { ok: false, error: "Sem permissão." };
  }
}

const papelSchema = z.object({
  userId: z.string().uuid(ID_INVALIDO),
  papel: z.enum(["user", "admin", "master"]),
});

/** Troca o papel de alguém. */
export async function definirPapel(input: unknown): Promise<ActionResult> {
  try {
    const ctx = await requireMaster();

    const bloqueio = bloqueioPorLimite("admin:escrita", ctx.userId);
    if (bloqueio) return bloqueio;

    const parsed = papelSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Dados inválidos" };

    // Rebaixar-se é o caminho mais curto para perder o próprio acesso, e é um
    // clique. Vale o mesmo argumento do autobloqueio.
    if (parsed.data.userId === ctx.userId && parsed.data.papel !== "master") {
      return { ok: false, error: "Você não pode remover o próprio papel de master." };
    }

    if (parsed.data.papel !== "master") {
      const impedimento = await impedirPerdaDoUltimoMaster(parsed.data.userId);
      if (impedimento) return impedimento;
    }

    const admin = createAdminClient();

    /*
      "user" APAGA a linha, em vez de gravar 'user'.

      Ausência de linha é o papel comum — é a convenção que `papel_do_usuario`
      estabelece na 0021. Guardar `role = 'user'` criaria duas representações do
      mesmo estado, e a pergunta "quem tem papel especial?" deixaria de ser
      "quem está na tabela".
    */
    const { error } =
      parsed.data.papel === "user"
        ? await admin.from("user_roles").delete().eq("user_id", parsed.data.userId)
        : await admin.from("user_roles").upsert(
            {
              user_id: parsed.data.userId,
              role: parsed.data.papel,
              granted_by: ctx.userId,
              granted_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );

    if (error) return { ok: false, error: "Não foi possível mudar o papel." };

    const { data: alvo } = await admin.auth.admin.getUserById(parsed.data.userId);
    await auditar(ctx.userId, "papel_alterado", parsed.data.userId, alvo.user?.email ?? null, {
      papel: parsed.data.papel,
    });
    revalidatePath("/admin");
    return { ok: true, id: parsed.data.userId };
  } catch {
    return { ok: false, error: "Sem permissão." };
  }
}

/**
 * Recusa a operação quando ela deixaria o sistema sem nenhum master.
 *
 * Extraída porque duas ações diferentes precisam da MESMA regra (bloquear e
 * rebaixar), e uma regra de segurança copiada em dois lugares é uma regra que
 * vai divergir no dia em que alguém corrigir só uma das cópias.
 */
async function impedirPerdaDoUltimoMaster(alvoId: string): Promise<ActionResult | null> {
  const admin = createAdminClient();
  const { data: masters } = await admin.from("user_roles").select("user_id").eq("role", "master");

  const lista = (masters as { user_id: string }[] | null) ?? [];
  const alvoEhMaster = lista.some((m) => m.user_id === alvoId);

  if (alvoEhMaster && lista.length <= 1) {
    return {
      ok: false,
      error: "Este é o último master. Promova outra pessoa antes de remover o acesso deste.",
    };
  }
  return null;
}
