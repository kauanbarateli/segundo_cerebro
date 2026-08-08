import { test as base, expect, type Page } from "@playwright/test";

/**
 * Apoio comum dos cinco fluxos.
 *
 * ⚠️ SEM CREDENCIAL, OS TESTES SÃO **PULADOS** — não falham.
 *
 * A distinção importa mais do que parece. Um teste que fica vermelho por falta
 * de variável de ambiente ensina, em duas semanas, que vermelho é normal. E o
 * dia em que ele ficar vermelho por um defeito de verdade, ninguém vai olhar.
 * "Pulado" é honesto: diz que não foi verificado, sem fingir reprovação.
 */

export const CREDENCIAL = {
  email: process.env.E2E_EMAIL,
  senha: process.env.E2E_SENHA,
  masterEmail: process.env.E2E_MASTER_EMAIL,
  masterSenha: process.env.E2E_MASTER_SENHA,
};

export const temCredencial = Boolean(CREDENCIAL.email && CREDENCIAL.senha);
export const temMaster = Boolean(CREDENCIAL.masterEmail && CREDENCIAL.masterSenha);

export const test = base;
export { expect };

/**
 * Entra no aplicativo.
 *
 * Espera pela URL, e NUNCA por tempo. `waitForTimeout` é a fonte número um de
 * instabilidade em E2E: o número escolhido é sempre curto demais na máquina
 * lenta do CI e longo demais em todo o resto.
 */
export async function entrar(page: Page, email: string, senha: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/e-mail/i).fill(email);
  await page.getByLabel(/senha/i).fill(senha);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
}

/** Entra como o usuário comum de teste. */
export async function entrarComum(page: Page): Promise<void> {
  await entrar(page, CREDENCIAL.email!, CREDENCIAL.senha!);
}

/**
 * A página tem rolagem HORIZONTAL?
 *
 * ⚠️ É esta a medição que nenhum teste de unidade faz. Ela compara a largura do
 * DOCUMENTO com a da VIEWPORT — e é assim que o defeito do cabeçalho aparecia:
 * o `h1` não cabia, empurrava o documento para além da janela, e todos os cards
 * das outras telas surgiam cortados por consequência.
 *
 * A tolerância de 1px é para arredondamento de zoom/DPI, não folga de verdade:
 * o defeito original transbordava dezenas de pixels.
 */
export async function temRolagemHorizontal(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 1;
  });
}

/** Quem transborda — para a mensagem de falha dizer O QUE consertar. */
export async function culpadosDoTransbordo(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limite = document.documentElement.clientWidth;
    const culpados: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= limite + 1) continue;
      const classe = typeof el.className === "string" ? el.className.slice(0, 60) : "";
      culpados.push(`${el.tagName.toLowerCase()}.${classe} → ${Math.round(r.right)}px`);
      if (culpados.length >= 5) break;
    }
    return culpados;
  });
}
