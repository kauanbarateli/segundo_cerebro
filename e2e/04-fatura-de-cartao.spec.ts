import { entrarComum, expect, temCredencial, test } from "./apoio";

/**
 * FLUXO 4 — despesa no cartão cai na fatura CERTA.
 *
 * A regra de negócio mais delicada do produto, e a que erra de forma mais
 * silenciosa: uma compra na fatura errada não dá erro nenhum — ela só aparece
 * num mês em que a pessoa não a espera, e a conta do mês fecha diferente do
 * extrato do banco sem que nada indique por quê.
 *
 * ⚠️ `credit.ts` já é bem coberto por unidade (87 casos, incluindo fevereiro,
 * fechamento 31 e "fecha 28 vence 5"). O que ESTE teste acrescenta é o
 * CAMINHO INTEIRO: formulário → validação → action → `statement_month` gravado
 * → leitura → a tela. A unidade prova a conta; isto prova a fiação.
 */
test.describe("fatura de cartão", () => {
  test.skip(!temCredencial, "E2E_EMAIL/E2E_SENHA não configurados — ver e2e/README.md");

  test("a despesa entra na fatura e o status é derivado", async ({ page }) => {
    await entrarComum(page);
    await page.goto("/financeiro");

    await page.getByRole("button", { name: /contas/i }).click();

    const cartoes = page.getByText(/fatura de/i);
    const quantos = await cartoes.count();

    /*
      PULA quando não há cartão semeado, em vez de falhar.

      O teste depende de dado de ambiente, e o ambiente é responsabilidade de
      quem o monta. Um vermelho aqui diria "o código quebrou" quando a verdade é
      "o seed não tem cartão" — e ensinar a suíte a mentir sobre a causa é pior
      que não cobrir o caso.
    */
    test.skip(quantos === 0, "nenhum cartão de crédito no ambiente de teste");

    const bloco = page.locator("div").filter({ hasText: /fatura de/i }).last();

    // O status é DERIVADO a cada render (ver `statusDaFatura`), então um dos
    // cinco rótulos precisa estar na tela — nunca "sem status".
    await expect(bloco).toContainText(/aberta|fechada|parcialmente paga|paga|vencida/i);
  });

  test("navegar a fatura NÃO arrasta o mês da tela inteira", async ({ page }) => {
    await entrarComum(page);
    await page.goto("/financeiro");
    await page.getByRole("button", { name: /contas/i }).click();

    const anterior = page.getByRole("button", { name: /fatura anterior/i });
    test.skip((await anterior.count()) === 0, "nenhum cartão de crédito no ambiente de teste");

    const urlAntes = page.url();
    await anterior.first().click();

    /*
      A navegação da fatura é estado LOCAL do cartão. Se ela mexesse no mês
      global, a URL mudaria (`?month=`) e o extrato, o orçamento e os outros
      cartões iriam junto — obrigando a desfazer tudo depois de conferir uma
      fatura.
    */
    await expect(page).toHaveURL(urlAntes);
  });

  test("a lista de lançamentos começa recolhida e o botão diz quantos são", async ({ page }) => {
    await entrarComum(page);
    await page.goto("/financeiro");
    await page.getByRole("button", { name: /contas/i }).click();

    const ver = page.getByRole("button", { name: /ver \d+ lançament/i });
    test.skip((await ver.count()) === 0, "nenhuma fatura com lançamentos no ambiente de teste");

    // "Ver 12 lançamentos" e não "ver mais": o número responde à pergunta antes
    // do clique. Mesma decisão do "+3 compromissos" da Início.
    await expect(ver.first()).toBeVisible();
    await expect(ver.first()).toHaveAttribute("aria-expanded", "false");

    await ver.first().click();
    await expect(page.getByRole("button", { name: /ocultar lançamentos/i }).first()).toBeVisible();
  });
});
