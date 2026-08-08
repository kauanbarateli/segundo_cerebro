import {
  culpadosDoTransbordo,
  entrarComum,
  expect,
  temCredencial,
  temRolagemHorizontal,
  test,
} from "./apoio";

/**
 * =============================================================================
 * FLUXO 3 — 390px SEM ROLAGEM HORIZONTAL
 *
 * ⭐ O SEGUNDO teste que justifica a etapa sozinho.
 * =============================================================================
 * Só um navegador de verdade MEDE largura de layout. Nenhum teste de unidade,
 * nenhum snapshot de DOM e nenhum tipo do TypeScript sabe que
 * "Configurações." mede ~277px em `text-4xl` e não cabe nos 108px que o
 * flexbox deixava para o título.
 *
 * E o defeito era enganoso de duas formas:
 *
 *   1. O `flex-wrap` do cabeçalho NUNCA disparava. O bloco do título é
 *      `flex-1` (basis 0, encolhível), então o flexbox considerava que ele
 *      "coubera" em 108px. Quem transbordava era o CONTEÚDO do `h1`.
 *
 *   2. O sintoma aparecia em OUTRAS telas. Com o documento mais largo que a
 *      viewport, os cards e campos de todas as páginas surgiam cortados — e
 *      cada um parecia um defeito próprio, com correção própria.
 *
 * Por isso a varredura cobre TODAS as rotas: a causa é única e o sintoma se
 * espalha. Consertar o cabeçalho e conferir só o cabeçalho deixaria de provar
 * justamente o que se ganhou.
 */
test.describe("mobile 390px", () => {
  test.skip(!temCredencial, "E2E_EMAIL/E2E_SENHA não configurados — ver e2e/README.md");

  /*
    Só no projeto `mobile`. Rodar isto no desktop não seria errado — seria
    inútil: o transbordo é um defeito de 390px, e em 1280px ele não existe nem
    quando o código está quebrado. Um teste que passa pelo motivo errado é pior
    que nenhum, porque dá a impressão de cobertura.
  */
  test.beforeEach(({}, info) => {
    test.skip(info.project.name !== "mobile", "este arquivo só faz sentido em 390px");
  });

  const ROTAS = [
    "/",
    "/capturar",
    "/tarefas",
    "/calendario",
    "/conhecimento",
    "/habitos",
    "/financeiro",
    "/drive",
    "/projetos",
    "/cofre",
    "/configuracoes",
    "/ajuda",
  ];

  for (const rota of ROTAS) {
    test(`${rota} não rola na horizontal`, async ({ page }) => {
      await entrarComum(page);
      await page.goto(rota);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      const transborda = await temRolagemHorizontal(page);

      /*
        A mensagem de falha diz QUEM transbordou, e não só QUE transbordou.
        "a página rola" manda alguém abrir o inspetor e caçar; a lista de
        elementos aponta o culpado direto — e num defeito cuja causa fica numa
        tela e o sintoma em outra, isso é a diferença entre cinco minutos e uma
        tarde.
      */
      const culpados = transborda ? await culpadosDoTransbordo(page) : [];
      expect(transborda, `transbordam em ${rota}:\n${culpados.join("\n")}`).toBe(false);
    });
  }

  test("o cabeçalho quebra em linhas em vez de espremer o título", async ({ page }) => {
    await entrarComum(page);
    // `/configuracoes` é a rota do título mais longo — "Configurações." é
    // palavra única e sem ponto de quebra natural, que é o pior caso.
    await page.goto("/configuracoes");

    const titulo = page.getByRole("heading", { level: 1 });
    await expect(titulo).toBeVisible();

    const caixa = await titulo.boundingBox();
    // Com as ações em linha própria, o título recebe a largura útil inteira
    // (~350px em 390px de viewport) em vez dos ~108px que sobravam antes.
    expect(caixa!.width).toBeGreaterThan(250);
  });

  test("o botão Capturar continua alcançável e com nome acessível", async ({ page }) => {
    await entrarComum(page);
    await page.goto("/");

    // Abaixo de `sm` o rótulo some e sobra o ícone — os ~78px devolvidos ao
    // título. O `aria-label` é o que sustenta o nome quando o texto está
    // `hidden`, e sem ele isto seria um link sem nome no celular.
    const capturar = page.getByRole("link", { name: "Capturar" });
    await expect(capturar).toBeVisible();

    const caixa = await capturar.boundingBox();
    // 44×44 é o piso de alvo de toque do projeto. Abaixo disso o dedo erra.
    expect(caixa!.width).toBeGreaterThanOrEqual(44);
    expect(caixa!.height).toBeGreaterThanOrEqual(44);
  });
});
