import { CREDENCIAL, entrar, entrarComum, expect, temCredencial, temMaster, test } from "./apoio";

/**
 * =============================================================================
 * FLUXO 5 — USUÁRIO COMUM **NÃO** ACESSA /admin
 * =============================================================================
 * O único dos cinco que é sobre SEGURANÇA, e o único capaz de exercitar as
 * quatro camadas de fora, como um atacante faria.
 *
 * As camadas, e o que cada uma cobre:
 *   1. o link some da barra          → conveniência, não proteção
 *   2. `admin/layout.tsx` redireciona → cobre quem digita a URL
 *   3. `requireMaster()` na action    → cobre quem chama o endpoint direto
 *   4. RLS + `eh_master()`            → última linha
 *
 * `guards.test.ts` já prova a camada 3 em unidade, inclusive com uma varredura
 * que exige a guarda em toda action nova. O que ESTE arquivo acrescenta é a
 * verificação de que as camadas 1 e 2 estão MONTADAS no aplicativo real — que a
 * unidade não tem como saber, porque ela testa a função, não a rota.
 */
test.describe("área administrativa fechada", () => {
  test.skip(!temCredencial, "E2E_EMAIL/E2E_SENHA não configurados — ver e2e/README.md");

  test("usuário comum digitando /admin é redirecionado", async ({ page }) => {
    await entrarComum(page);
    await page.goto("/admin");

    // Para a Início, e não para uma tela de "acesso negado": um usuário comum
    // não precisa aprender que existe uma área administrativa.
    await expect(page).toHaveURL(/\/$|\/\?/);
    await expect(page.getByRole("heading", { name: /quem tem acesso/i })).toHaveCount(0);
  });

  test("o link Admin não aparece para usuário comum", async ({ page }) => {
    await entrarComum(page);
    await page.goto("/");
    // Camada 1. Ela sozinha não protege nada — mas se o link VAZAR, é sinal de
    // que a condição de papel no layout quebrou, e aí a camada 2 pode ter ido
    // junto.
    await expect(page.getByRole("link", { name: /^admin$/i })).toHaveCount(0);
  });

  test("nenhuma rota sob /admin abre para usuário comum", async ({ page }) => {
    await entrarComum(page);
    // O guard é do LAYOUT, então toda rota nova sob /admin nasce protegida.
    // Este caso é o que denunciaria alguém movendo a guarda para dentro de uma
    // `page.tsx` específica e deixando as outras descobertas.
    for (const rota of ["/admin", "/admin/", "/admin/usuarios"]) {
      await page.goto(rota);
      await expect(page.locator("body")).not.toContainText(/cadastrar usuário/i);
    }
  });

  test("sem sessão nenhuma, /admin manda para o login", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
  });

  test("o master entra e vê a lista", async ({ page }) => {
    test.skip(!temMaster, "E2E_MASTER_EMAIL/E2E_MASTER_SENHA não configurados");

    await entrar(page, CREDENCIAL.masterEmail!, CREDENCIAL.masterSenha!);
    await page.goto("/admin");

    await expect(page.getByRole("heading", { name: /quem tem acesso/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /cadastrar usuário/i })).toBeVisible();
  });

  test("a área administrativa não mostra conteúdo de ninguém", async ({ page }) => {
    test.skip(!temMaster, "E2E_MASTER_EMAIL/E2E_MASTER_SENHA não configurados");

    await entrar(page, CREDENCIAL.masterEmail!, CREDENCIAL.masterSenha!);
    await page.goto("/admin");

    /*
      ⚠️ A afirmação de PRODUTO, não de implementação.

      Administrar contas não é ler a vida das pessoas. A tela mostra metadado —
      e-mail, entrada, último acesso, papel, bloqueio — e nada mais. Se um dia
      alguém acrescentar "ver as tarefas deste usuário" por conveniência, é aqui
      que a decisão volta à mesa.
    */
    const corpo = page.locator("body");
    await expect(corpo).not.toContainText(/cofre/i);
    await expect(corpo).not.toContainText(/saldo|lançamento/i);
  });
});
