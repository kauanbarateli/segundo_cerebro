import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  /**
   * O `tsconfig.json` diz `"jsx": "preserve"` porque quem compila de verdade é o
   * Next. O esbuild do Vite respeita esse valor e entregaria JSX cru ao Node.
   * Esta linha é o que faz os componentes importados por um teste virarem
   * chamadas de função — e `"automatic"` (não `"transform"`) porque o projeto é
   * React 19 e nenhum arquivo importa `React` só para o JSX funcionar.
   */
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    /**
     * `node` continua sendo o PADRÃO de propósito: quase toda a suíte é de
     * lógica pura e não deve pagar o custo de montar um DOM. Os poucos testes
     * que precisam de janela pedem por arquivo, com o comentário
     * `@vitest-environment jsdom` na primeira linha.
     */
    environment: "node",
    globals: true,
    /**
     * `.tsx` entrou aqui junto com o primeiro teste de componente. Ele não
     * estava no padrão antes, e essa ausência tem história: o bug que deixou o
     * módulo do Conhecimento inacessível passou por `tsc`, por `lint` e pela
     * suíte inteira porque NADA renderizava um componente. Um arquivo `.tsx`
     * criado sem esta linha simplesmente não roda — e não roda em silêncio, que
     * é o pior jeito de um teste falhar.
     */
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws when resolved outside an RSC bundle; stub it for tests.
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
});
