import { defineConfig, devices } from "@playwright/test";

/**
 * =============================================================================
 * POR QUE EXISTE E2E AQUI — e por que são só CINCO fluxos
 * =============================================================================
 * A suíte de unidade deste projeto é boa: 705 testes cobrindo invariante e caso
 * de borda, não só caminho feliz. E ela NÃO PEGARIA os dois defeitos mais
 * visíveis desta revisão:
 *
 *   - o horário que voltava diferente. O defeito não estava em `validation.ts`
 *     nem em função pura nenhuma: estava na COMBINAÇÃO entre o `type` do input,
 *     o parser do navegador e o fuso de quem executa. Um teste de
 *     `taskInputSchema` passava com o bug inteiro presente.
 *   - o transbordo em 390px. Só um navegador de verdade MEDE largura de layout.
 *
 * Esses dois justificam a etapa sozinhos. Os outros três cobrem o que, se
 * quebrar, quebra tudo (entrar), a regra de negócio mais delicada (fatura) e a
 * única camada de segurança que um teste consegue exercitar de fora (/admin).
 *
 * ⚠️ E PARAM AÍ. E2E custa manutenção: cada fluxo é um seletor que envelhece e
 * uma espera que pode ficar instável. A suíte em que ninguém confia é a que tem
 * teste demais — foram cortados de propósito "capturar → aparece na lista" e
 * "marcar hábito", que são caminhos simples já cobertos por unidade nas actions
 * e somariam manutenção sem somar confiança.
 *
 * =============================================================================
 * ⚠️ NUNCA APONTE ISTO PARA PRODUÇÃO
 * =============================================================================
 * Estes testes CRIAM e APAGAM dado. Rodar contra o banco real destruiria dado
 * de verdade. `E2E_BASE_URL` não tem padrão de produção, e o `webServer` abaixo
 * sobe uma instância local — a configuração toda é construída para que apontar
 * para produção exija querer.
 *
 * O que é preciso para rodar (ver `e2e/README.md`):
 *   - um projeto Supabase DEDICADO a teste, com as migrations aplicadas;
 *   - `E2E_EMAIL` e `E2E_SENHA` de um usuário comum semeado lá;
 *   - opcionalmente `E2E_MASTER_EMAIL` / `E2E_MASTER_SENHA`.
 *
 * Sem essas variáveis os testes são PULADOS, não falham. Um teste que falha por
 * falta de ambiente ensina a ignorar falha vermelha.
 */
export default defineConfig({
  testDir: "./e2e",

  // Um teste de E2E que espera mais de 30s está travado, não lento.
  timeout: 30_000,
  expect: { timeout: 10_000 },

  // Nada de `.only` esquecido barrando a suíte no CI.
  forbidOnly: !!process.env.CI,

  /*
    Retry SÓ no CI, e é a distinção que mantém a suíte honesta. Localmente um
    teste instável precisa ser sentido para ser corrigido; no CI, uma falha de
    rede não deve reprovar um commit correto. Com retry em desenvolvimento, a
    instabilidade vira ruído de fundo que ninguém investiga.
  */
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    // Artefatos SÓ na falha: o que se quer é o vídeo do teste que quebrou, e
    // guardar o dos que passaram enche o armazenamento do CI sem ajudar.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  },

  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      /*
        390px é a largura do iPhone 14/15 e a que reproduz o transbordo do
        cabeçalho. O `Pixel 5` do Playwright é 393px — perto, e "perto" não
        serve para um defeito de layout que aparece por poucos pixels. Daí a
        largura explícita.
      */
      name: "mobile",
      use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } },
    },
  ],

  /*
    Sobe o app sozinho. `reuseExistingServer` fora do CI para não brigar com um
    `npm run dev` já aberto — e no CI ele é falso de propósito: reaproveitar um
    servidor de origem desconhecida é como um teste passa contra a build errada.
  */
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run build && npm run start",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
