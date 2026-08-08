import { CREDENCIAL, entrarComum, expect, temCredencial, test } from "./apoio";

/**
 * FLUXO 1 — entrar e a Início carregar.
 *
 * O mais simples dos cinco, e o que menos precisa de justificativa: se ele
 * quebra, tudo quebrou. Ele também é o único que exercita a sessão de ponta a
 * ponta — cookie, middleware, `getAppContext` — que é infraestrutura que nenhum
 * outro teste toca inteira.
 */
test.describe("entrar", () => {
  test.skip(!temCredencial, "E2E_EMAIL/E2E_SENHA não configurados — ver e2e/README.md");

  test("entra e a Início carrega", async ({ page }) => {
    await entrarComum(page);

    // Um cabeçalho de verdade, e não um seletor de layout: o que se quer provar
    // é que a página RENDEROU, não que uma div existe.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    /*
      A tela de erro é irmã da tela vazia: as duas têm pouco conteúdo, e um
      teste que só verifica "carregou algo" passaria com o `error.tsx` na frente.
      Esta asserção é o que distingue as duas.
    */
    await expect(page.getByText(/não foi possível carregar/i)).toHaveCount(0);
  });

  test("sem sessão, a rota protegida manda para o login", async ({ page }) => {
    // Contexto novo, sem cookie. É o caminho do middleware.
    await page.goto("/tarefas");
    await expect(page).toHaveURL(/\/login/);
  });

  test("senha errada não entra, e a mensagem não diz qual metade falhou", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/e-mail/i).fill(CREDENCIAL.email!);
    await page.getByLabel(/senha/i).fill("senha-errada-de-proposito");
    await page.getByRole("button", { name: /entrar/i }).click();

    await expect(page).toHaveURL(/\/login/);
    const alerta = page.getByRole("alert");
    await expect(alerta).toBeVisible();
    /*
      "Este e-mail não existe" contaria a quem sonda QUAIS contas existem — e
      transformaria a tela de login num verificador de cadastro.
    */
    await expect(alerta).not.toContainText(/não existe|não encontrad/i);
  });

  test("a tela de login não expõe a infraestrutura", async ({ page }) => {
    // A frase "Contas são criadas pelo proprietário no Supabase" saiu na Etapa
    // 5: numa tela pública e não autenticada, o nome do banco e do provedor de
    // autenticação é informação para quem procura superfície de ataque.
    await page.goto("/login");
    await expect(page.locator("body")).not.toContainText(/supabase/i);
  });
});
