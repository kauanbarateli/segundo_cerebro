import { entrarComum, expect, temCredencial, test } from "./apoio";

/**
 * =============================================================================
 * FLUXO 2 — CRIAR TAREFA COM DATA E HORA
 *
 * ⭐ ESTE É O TESTE QUE JUSTIFICA A ETAPA INTEIRA.
 * =============================================================================
 * O defeito que ele cobre passou por `tsc`, por `next lint` e pelas 705
 * asserções da suíte — e continuaria passando por todas elas, porque nenhuma
 * das três olha para o lugar onde ele mora.
 *
 * Ele tinha três causas somadas, e só a primeira é de lógica:
 *
 *   A1  `new Date("2026-08-07")` é meia-noite UTC, não local. Em São Paulo o
 *       dia retrocedia. Coberto por unidade hoje (`tempo.test.ts`).
 *
 *   A2  um `<input type="date">` DESCARTA um valor de 16 caracteres. Isso não é
 *       lógica da aplicação: é comportamento do navegador. Nenhum teste de
 *       função pura chega perto.
 *
 *   A3  trocar o `type` de um input não controlado apaga o que estava digitado,
 *       e `defaultValue` não repõe. Idem — é a interação entre React, o DOM e o
 *       parser do navegador.
 *
 * E há uma quarta condição, que é a mais traiçoeira de todas: em
 * desenvolvimento o servidor roda na máquina do desenvolvedor (São Paulo) e o
 * ida-e-volta FECHA, escondendo o defeito. Ele só aparecia na Vercel, que é
 * UTC. Por isso o projeto do Playwright fixa `timezoneId` — e por isso este
 * teste vale rodar contra uma build de produção.
 */
test.describe("tarefa com data e hora", () => {
  test.skip(!temCredencial, "E2E_EMAIL/E2E_SENHA não configurados — ver e2e/README.md");

  // Um título único por execução: sem isso, duas rodadas seguidas encontram a
  // tarefa da anterior e o `getByText` casa com a linha errada.
  const titulo = () => `E2E data ${Date.now()}`;

  test("o horário digitado é o horário exibido", async ({ page }) => {
    await entrarComum(page);
    await page.goto("/tarefas");

    const nome = titulo();
    await page.getByRole("button", { name: /nova tarefa|criar tarefa/i }).first().click();

    await page.getByLabel(/^título$/i).fill(nome);
    await page.getByLabel(/vencimento/i).fill("2026-08-07T14:30");
    await page.getByRole("button", { name: /criar tarefa|salvar/i }).click();

    const linha = page.getByText(nome).first();
    await expect(linha).toBeVisible();

    /*
      ⚠️ A ASSERÇÃO CENTRAL. Antes, num servidor UTC, 14:30 voltava como 11:30 —
      três horas a menos, em toda tarefa com hora. Procurar "11:30" e afirmar
      que ele NÃO aparece é o que prova que a conversão parou de acontecer duas
      vezes.
    */
    const cartao = page.locator("li, tr, div").filter({ hasText: nome }).last();
    await expect(cartao).toContainText("14:30");
    await expect(cartao).not.toContainText("11:30");
    await expect(cartao).not.toContainText("17:30");
  });

  test("'Dia inteiro' NÃO retrocede o dia", async ({ page }) => {
    await entrarComum(page);
    await page.goto("/tarefas");

    const nome = titulo();
    await page.getByRole("button", { name: /nova tarefa|criar tarefa/i }).first().click();
    await page.getByLabel(/^título$/i).fill(nome);

    // Marcar primeiro, para o campo já nascer como `type="date"`.
    await page.getByLabel(/dia inteiro/i).check();
    await page.getByLabel(/vencimento/i).fill("2026-08-07");
    await page.getByRole("button", { name: /criar tarefa|salvar/i }).click();

    const cartao = page.locator("li, tr, div").filter({ hasText: nome }).last();
    await expect(cartao).toBeVisible();
    // 7 de agosto, não 6. O defeito A1 exibia o dia anterior.
    await expect(cartao).toContainText(/7 de ago|07\/08|7 ago/i);
    await expect(cartao).not.toContainText(/6 de ago|06\/08|6 ago/i);
  });

  test("marcar e desmarcar 'Dia inteiro' PRESERVA a data digitada", async ({ page }) => {
    await entrarComum(page);
    await page.goto("/tarefas");

    await page.getByRole("button", { name: /nova tarefa|criar tarefa/i }).first().click();

    const campo = page.getByLabel(/vencimento/i);
    await campo.fill("2026-09-15T09:30");

    const diaInteiro = page.getByLabel(/dia inteiro/i);

    await diaInteiro.check();
    // Modo data: 10 caracteres. Antes chegavam 16 aqui e o navegador esvaziava
    // o campo — a data salva sumia da tela sem nada avisar (defeito A2).
    await expect(campo).toHaveValue("2026-09-15");

    await diaInteiro.uncheck();
    // O ciclo completo é o defeito A3: com campos não controlados, o valor
    // voltava VAZIO aqui e a tarefa era salva sem data nenhuma.
    await expect(campo).toHaveValue("2026-09-15T09:30");
  });
});
