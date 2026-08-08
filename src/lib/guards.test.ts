import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppContext, PapelDoUsuario } from "@/lib/data";

/**
 * ============================================================================
 * O TESTE QUE ESPERA **FALHA** — e é por isso que ele existe
 * ============================================================================
 * A área administrativa tem quatro camadas de proteção, e três delas são fáceis
 * de verificar olhando a tela: o link some, a rota redireciona, a RLS recusa.
 *
 * A que NÃO se vê é a terceira — `requireMaster()` dentro de cada Server
 * Action. E ela é a que importa, porque uma Server Action é um ENDPOINT HTTP:
 * o Next publica um id por função exportada, e um POST para esse id não passa
 * por layout, não renderiza página e não vê guarda de rota nenhuma.
 *
 * O modo de falha é silencioso do pior jeito: tudo continua parecendo certo na
 * tela — o link some, a rota redireciona — enquanto a operação fica aberta para
 * qualquer usuário autenticado que saiba montar a requisição. Nenhum teste de
 * "funciona para o master" pegaria isso.
 *
 * Por isso todo caso aqui afirma sobre a RECUSA, e não sobre o sucesso.
 */

const MODULE_DATA = "@/lib/data";

/** Um contexto de sessão completo, com o papel que o caso precisa. */
function contexto(papel: PapelDoUsuario): AppContext {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    email: "alguem@exemplo.com",
    displayName: "Alguém",
    avatarUrl: null,
    profile: null,
    preferences: null,
    enabledModules: new Set(["inicio"]),
    organized: { done: 0, total: 0, percent: 0 },
    papel,
  };
}

/** Instala o contexto e devolve os guards já com o mock em vigor. */
async function comContexto(ctx: AppContext | null) {
  vi.resetModules();
  vi.doMock(MODULE_DATA, () => ({ getAppContext: async () => ctx }));
  // `next/navigation` lança em `redirect()` fora de um render do Next; o mock
  // troca isso por um erro reconhecível, para os casos de página poderem
  // afirmar que houve redirecionamento sem montar um servidor inteiro.
  vi.doMock("next/navigation", () => ({
    redirect: (destino: string) => {
      throw new Error(`REDIRECT:${destino}`);
    },
  }));
  return import("@/lib/guards");
}

afterEach(() => {
  vi.doUnmock(MODULE_DATA);
  vi.doUnmock("next/navigation");
  vi.resetModules();
});

describe("requireMaster — a guarda das Server Actions", () => {
  it("RECUSA usuário comum", async () => {
    const { requireMaster } = await comContexto(contexto("user"));
    await expect(requireMaster()).rejects.toThrow("Sem permissão.");
  });

  /*
    ⚠️ "admin" NÃO É "master", e o caso existe porque a confusão é natural: o
    enum tem os dois, e alguém poderia ler `papel !== "user"` como suficiente.
    Só master administra contas.
  */
  it("RECUSA papel admin — só master administra contas", async () => {
    const { requireMaster } = await comContexto(contexto("admin"));
    await expect(requireMaster()).rejects.toThrow("Sem permissão.");
  });

  it("RECUSA quem não tem sessão", async () => {
    const { requireMaster } = await comContexto(null);
    await expect(requireMaster()).rejects.toThrow("Sem permissão.");
  });

  /*
    A MESMA mensagem para "sem sessão" e "sem permissão", e isso é deliberado:
    duas mensagens diferentes contariam a quem está sondando que a área existe e
    que a sessão dele é válida — só não é suficiente.
  */
  it("não distingue 'sem sessão' de 'sem permissão' na mensagem", async () => {
    const semSessao = await comContexto(null);
    const erroSemSessao = await semSessao.requireMaster().catch((e: Error) => e.message);

    const comum = await comContexto(contexto("user"));
    const erroComum = await comum.requireMaster().catch((e: Error) => e.message);

    expect(erroSemSessao).toBe(erroComum);
  });

  it("aceita master", async () => {
    const { requireMaster } = await comContexto(contexto("master"));
    await expect(requireMaster()).resolves.toMatchObject({ papel: "master" });
  });

  /*
    ⚠️ LANÇA, e não redireciona. `redirect()` produz uma resposta de navegação,
    que um cliente chamando a action por POST simplesmente ignora — a execução
    continuaria e a operação aconteceria. A exceção interrompe, ponto.
  */
  it("LANÇA em vez de redirecionar — redirect não interrompe uma action", async () => {
    const { requireMaster } = await comContexto(contexto("user"));
    const erro = await requireMaster().catch((e: Error) => e.message);
    expect(erro).toBe("Sem permissão.");
    expect(erro).not.toContain("REDIRECT:");
  });
});

describe("requireMasterPage — a guarda de ROTA", () => {
  it("manda usuário comum para a Início, e não para uma tela de acesso negado", async () => {
    // Um usuário comum não precisa aprender que existe uma área administrativa.
    const { requireMasterPage } = await comContexto(contexto("user"));
    await expect(requireMasterPage()).rejects.toThrow("REDIRECT:/");
  });

  it("manda quem não tem sessão para o login", async () => {
    const { requireMasterPage } = await comContexto(null);
    await expect(requireMasterPage()).rejects.toThrow("REDIRECT:/login");
  });

  it("deixa o master passar", async () => {
    const { requireMasterPage } = await comContexto(contexto("master"));
    await expect(requireMasterPage()).resolves.toMatchObject({ papel: "master" });
  });
});

describe("requireModule", () => {
  it("manda para a Início quando o módulo está desligado", async () => {
    const { requireModule } = await comContexto(contexto("user"));
    await expect(requireModule("financeiro")).rejects.toThrow("REDIRECT:/");
  });

  it("manda para o login sem sessão", async () => {
    const { requireModule } = await comContexto(null);
    await expect(requireModule("inicio")).rejects.toThrow("REDIRECT:/login");
  });

  it("deixa passar quando o módulo está ligado", async () => {
    const { requireModule } = await comContexto(contexto("user"));
    await expect(requireModule("inicio")).resolves.toMatchObject({ papel: "user" });
  });

  /*
    Ser master NÃO dispensa a checagem de módulo: são perguntas independentes
    ("posso administrar contas?" e "este módulo está ligado para mim?"), e
    misturá-las faria o master ver módulos que ele mesmo desligou.
  */
  it("o papel de master não contorna o módulo desligado", async () => {
    const { requireModule } = await comContexto(contexto("master"));
    await expect(requireModule("financeiro")).rejects.toThrow("REDIRECT:/");
  });
});

/* ========================================================================== */
/*  A VARREDURA: nenhuma action administrativa sem guarda                     */
/* ========================================================================== */

describe("toda Server Action de /admin chama requireMaster", () => {
  /**
   * ⚠️ ESTE É O TESTE QUE PROTEGE O FUTURO, e não o presente.
   *
   * Os casos acima provam que `requireMaster` recusa. Este prova que ela é
   * CHAMADA — em toda função exportada de `admin/actions.ts`, inclusive nas que
   * ainda não existem.
   *
   * O risco real não é escrever a guarda errada hoje: é acrescentar a décima
   * action daqui a seis meses, copiando a estrutura de outra e esquecendo a
   * primeira linha. Nada na tela denunciaria — o link continua escondido, a
   * rota continua redirecionando — e a operação ficaria aberta para qualquer
   * usuário autenticado que montasse o POST.
   *
   * É a mesma estratégia de `capabilities.test.ts`, que varre `src/` atrás do
   * domínio da API do ClickUp: uma verificação sobre o TEXTO do código, para
   * uma invariante que nenhum tipo consegue expressar.
   */
  it("nenhuma função exportada fica sem a guarda", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync("src/app/(app)/admin/actions.ts", "utf8");

    // Corta o arquivo nos limites das funções exportadas. O primeiro pedaço é o
    // cabeçalho e os helpers, e é descartado.
    const pedacos = fonte.split(/export async function /).slice(1);

    expect(pedacos.length).toBeGreaterThan(0);

    const semGuarda = pedacos
      .map((p) => ({ nome: p.slice(0, p.indexOf("(")), corpo: p }))
      .filter(({ corpo }) => !corpo.includes("await requireMaster()"))
      .map(({ nome }) => nome);

    expect(semGuarda, "actions sem `await requireMaster()`").toEqual([]);
  });

  /**
   * A guarda tem que vir ANTES do trabalho, não depois.
   *
   * Uma action que valida o input, consulta o banco e só então checa permissão
   * já vazou o que a consulta revela — e gastou o trabalho. Aqui a verificação
   * é grosseira de propósito: exige que `requireMaster` apareça antes de
   * qualquer `createAdminClient`, que é o ponto onde o poder de `service_role`
   * entra em cena.
   */
  it("a guarda vem antes de createAdminClient em toda action", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync("src/app/(app)/admin/actions.ts", "utf8");

    const foraDeOrdem = fonte
      .split(/export async function /)
      .slice(1)
      .map((p) => ({ nome: p.slice(0, p.indexOf("(")), corpo: p }))
      .filter(({ corpo }) => {
        const guarda = corpo.indexOf("await requireMaster()");
        const cliente = corpo.indexOf("createAdminClient(");
        return cliente !== -1 && (guarda === -1 || guarda > cliente);
      })
      .map(({ nome }) => nome);

    expect(foraDeOrdem, "actions que criam o cliente admin antes de checar").toEqual([]);
  });
});
