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

    /**
     * Cobertura — para OLHAR, não para bater meta.
     *
     * ⚠️ NÃO existe `thresholds` aqui, e a ausência é a decisão. Um piso global
     * mede a coisa errada neste projeto: `lib/` é lógica pura e naturalmente
     * chega perto de 100%, enquanto componente React sobe devagar e caro.
     * Perseguir um número único produziria o pior teste que existe — o que
     * renderiza um componente e não afirma nada, só para a linha contar como
     * coberta. A suíte atual é boa porque cobre INVARIANTE e caso de borda
     * (fevereiro, virada de mês, vazamento de chave no corpo), e nenhuma dessas
     * qualidades aparece num percentual.
     *
     * O uso real é o inverso: rodar `npm run coverage` e procurar o arquivo com
     * zero. Foi assim que se soube que nenhum componente era montado — e o
     * módulo do Conhecimento ficou inteiramente inacessível com a suíte verde.
     *
     * Codecov ficou de fora: ele comenta a variação de cobertura em PR, e este
     * repositório tem um desenvolvedor commitando direto na main. O relatório
     * local entrega a mesma informação sem serviço externo.
     */
    coverage: {
      provider: "v8",
      // `text` para ler no terminal; `html` para navegar arquivo a arquivo, que
      // é onde a métrica de fato ajuda.
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/lib/database.types.ts",
        // Declaração de rota/layout do Next: são montados pelo framework, e
        // contá-los rebaixaria o número sem indicar nada acionável.
        "src/app/**/{page,layout,loading,error,not-found,route}.tsx",
      ],
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws when resolved outside an RSC bundle; stub it for tests.
      "server-only": fileURLToPath(new URL("./src/test/server-only-stub.ts", import.meta.url)),
    },
  },
});
