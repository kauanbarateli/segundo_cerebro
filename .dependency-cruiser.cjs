/**
 * CONTRATO DE CAMADAS — as regras que já existiam, agora executáveis.
 *
 * ============================================================================
 * POR QUE ESTE ARQUIVO EXISTE
 * ============================================================================
 * Nenhuma regra aqui é nova. Todas as quatro já estavam escritas, em português,
 * no cabeçalho do arquivo que elas protegem — e cada uma foi aprendida com um
 * defeito real. O problema é que comentário não impede nada: ele avisa quem
 * lê, e o próximo import errado é justamente o de quem não leu.
 *
 * O ganho não é achar violação nova (não há nenhuma hoje — o projeto está
 * limpo). É que a regra passa a valer no dia em que ninguém estiver olhando.
 *
 * ⚠️ A lista é DELIBERADAMENTE curta. Só entram regras que o projeto já
 * decidiu e escreveu; inventar regras de arquitetura "de boa prática" aqui
 * produziria exatamente o inverso do objetivo — uma ferramenta que reprova
 * código legítimo e ensina a desligá-la.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "ui-nao-importa-features",
      severity: "error",
      comment:
        "REGRA 1 — está no cabeçalho de src/components/ui/Modal.tsx. O Modal nasceu " +
        "dentro de features/tasks e era importado por drive, finance e vault: três " +
        "features dependendo de uma quarta só para reaproveitar uma caixa cinza. Ele " +
        "foi movido para ui/ exatamente para que a dependência aponte para BAIXO. Um " +
        "import de ui/ para features/ desfaz a mudança e reabre o ciclo entre camadas.",
      from: { path: "^src/components/ui/" },
      to: { path: "^src/components/features/" },
    },
    {
      name: "estilos-sem-import-nenhum",
      severity: "error",
      comment:
        "REGRA 2 — está no cabeçalho do próprio src/components/ui/estilos.ts, e é a " +
        "mais fácil de violar sem perceber: o arquivo exporta STRINGS de classe. " +
        "Qualquer import ali dentro passa a ser arrastado para o pacote do navegador " +
        "por todo mundo que só queria uma string — ThemeToggle, Avatar e Link " +
        "inteiros no bundle por causa de um `CLASSE_DO_CAMPO`.",
      from: { path: "^src/components/ui/estilos\\.ts$" },
      to: { pathNot: "^$" },
    },
    {
      name: "servidor-nao-vaza-para-cliente",
      severity: "error",
      comment:
        "REGRA 3 — a lista alvo é EXATAMENTE a dos módulos que declaram " +
        '`import "server-only"`, e não `lib/crypto/**` inteiro. A distinção é o ' +
        "ponto: o cofre é ZERO-KNOWLEDGE, então `crypto/vault.ts` e " +
        "`crypto/recovery-kit.ts` rodam NO NAVEGADOR por decisão de projeto — a " +
        "senha mestra nunca sai da máquina. Proibi-los aqui reprovaria " +
        "`VaultClient.tsx`, que é o código correto fazendo a coisa certa. Quem " +
        "não pode atravessar são `crypto/tokens.ts` (cifra credencial de " +
        "terceiro com chave do servidor) e `supabase/admin.ts` (service_role, " +
        "que IGNORA RLS).",
      from: { path: "^src/components/", pathNot: "\\.test\\.tsx?$" },
      to: { path: "^src/lib/(crypto/tokens\\.ts|supabase/admin\\.ts)$" },
    },
    {
      name: "clickup-escreve-so-por-capabilities",
      severity: "error",
      comment:
        "REGRA 4 — está no cabeçalho de src/lib/clickup/capabilities.ts, que é o " +
        "ÚNICO módulo autorizado a falar com api.clickup.com. A tabela de operações " +
        "é fechada e DELETE é inexprimível por decisão: o mesmo PUT /task/{id} que " +
        "muda status também remove colegas, arquiva e move, dependendo do corpo.\n\n" +
        "O alvo é `capabilities.ts`, NÃO `client.ts`: as actions importarem " +
        "`client.ts` é o caminho correto — é ele quem monta o corpo do zero. " +
        "Importar `capabilities` direto é que pularia essa montagem e deixaria o " +
        "corpo vir de fora.\n\n" +
        "⚠️ Esta regra COMPLEMENTA `capabilities.test.ts`, que varre src/ atrás de " +
        "`api.clickup.com` — o teste pega a URL escrita à mão, esta pega o import.",
      from: { path: "^src/", pathNot: "^src/lib/clickup/" },
      to: { path: "^src/lib/clickup/capabilities\\.ts$" },
    },
    {
      name: "sem-ciclo",
      severity: "error",
      comment:
        "Ciclo de dependência. Não vem de decisão escrita do projeto, mas é a única " +
        "regra genérica que vale aqui: um ciclo entre módulos quebra a ordem de " +
        "inicialização de um jeito que só aparece em tempo de execução.",
      from: {},
      to: { circular: true },
    },
    {
      name: "sem-orfaos",
      severity: "warn",
      comment:
        "Arquivo que ninguém importa. `warn` e não `error` de propósito: knip já " +
        "cobre código morto com mais contexto, e alguns arquivos são pontos de " +
        "entrada que o Next resolve por convenção de pasta, não por import.",
      from: {
        orphan: true,
        pathNot: [
          "\\.d\\.ts$",
          "(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$",
          "\\.(config|test)\\.(js|cjs|mjs|ts|tsx)$",
          // O Next descobre estes por CONVENÇÃO DE PASTA — ninguém os importa,
          // e nem por isso são órfãos.
          "^src/app/.*/(page|layout|loading|error|route|not-found)\\.tsx?$",
          "^src/app/(layout|middleware)\\.tsx?$",
          "^src/middleware\\.ts$",
          // Resolvido pelo ALIAS de vitest.config.ts, não por import — para o
          // depcruise ele parece órfão, e não é.
          "^src/test/server-only-stub\\.ts$",
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^(node_modules|\\.next|e2e)/" },
    tsConfig: { fileName: "tsconfig.json" },
    // Sem isto o `@/…` do projeto não resolve e TODO import interno vira
    // "dependência não encontrada" — a ferramenta reportaria centenas de falsos
    // positivos e seria desligada no primeiro dia.
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".js", ".jsx", ".ts", ".tsx"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
