/**
 * Sentry no NAVEGADOR — o lado que resolve o problema desta etapa.
 *
 * Erro de servidor sempre apareceu no log da Vercel. Erro de CLIENTE não
 * aparecia em lugar nenhum: se a tela quebrava no navegador de alguém, só se
 * ficava sabendo se essa pessoa contasse. Com um usuário isso é administrável;
 * com a área de admin e usuários novos, deixa de ser.
 *
 * ⚠️ SEM DSN, NADA INICIALIZA — e é estado previsto, não falha. O projeto roda
 * sem Supabase configurado (modo de setup) e precisa rodar sem Sentry também.
 *
 * =============================================================================
 * ⚠️ O PESO — MEDIDO, E ELE DITOU A FORMA DESTE ARQUIVO
 * =============================================================================
 * Três builds, o mesmo projeto, olhando "First Load JS shared by all":
 *
 *     103 kB   antes do Sentry
 *     186 kB   `import * as Sentry` + `Sentry.init()` no topo      (+83 kB)
 *     150 kB   init dinâmico, mas ainda exportando o gancho de rota (+47 kB)
 *     105 kB   init dinâmico e SEM o gancho de rota                  (+2 kB)
 *
 * O primeiro número é o que a instalação padrão entrega: +80% de JavaScript em
 * TODA rota — e mesmo com o DSN vazio, porque `if (DSN)` impede a inicialização,
 * não o empacotamento.
 *
 * As duas decisões que trouxeram 186 kB de volta para 105 kB:
 *
 *   1. `import()` DINÂMICO para o `init`. O SDK vira um chunk separado, buscado
 *      depois da primeira pintura e só quando existe DSN.
 *      Custo: erro disparado nos primeiros milissegundos, antes de o chunk
 *      chegar, escapa. Janela real — mas pagar 83 kB por navegação num app de
 *      uso diário para cobri-la é caro, e ela existe de qualquer forma para erro
 *      anterior à hidratação.
 *
 *   2. NÃO exportar `onRouterTransitionStart`. Sozinho, o import estático que
 *      ele exige custava 45 kB — quase metade do peso do app.
 *      Custo: transições de rota do cliente não viram spans correlacionados no
 *      traço. É perda de CONTEXTO de desempenho, não de captura: os handlers
 *      globais de erro continuam instalados pelo chunk dinâmico, e é isso que
 *      esta etapa veio buscar. Trocar 45 kB por costura de span num app pessoal
 *      não se paga.
 *
 * Se algum dia o problema for justamente "erro que só acontece na montagem", ou
 * "preciso ver a navegação no traço", a volta é reverter uma das duas — com os
 * números acima na mesa, e não por engano.
 */
import { AMOSTRAGEM_DE_TRACO, DSN, filtrarEvento, filtrarTrilha } from "@/lib/observabilidade";

if (DSN) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn: DSN,
      environment: process.env.NODE_ENV,

      tracesSampleRate: AMOSTRAGEM_DE_TRACO,

      /*
        ⚠️ AS TRÊS LINHAS QUE MAIS IMPORTAM.

        `sendDefaultPii: false` é o padrão do SDK, mas está escrito porque o
        contrário é uma linha de distância e o efeito seria e-mail, IP e corpo
        de requisição saindo daqui. Explícito, quem for mexer vê a decisão.

        `beforeSend` e `beforeBreadcrumb` aplicam a allowlist de
        `src/lib/observabilidade.ts`, que é onde a regra mora e onde ela é
        TESTADA — inclusive com um evento carregado de conteúdo de cofre, que o
        teste afirma não sair.
      */
      sendDefaultPii: false,
      beforeSend: (evento) => filtrarEvento(evento as never) as never,
      beforeBreadcrumb: (trilha) => filtrarTrilha(trilha as never) as never,

      /*
        ⚠️ SESSION REPLAY FICA DESLIGADO, e a omissão é decisão.

        Replay grava a tela. Neste produto a tela mostra o conteúdo do Cofre
        decifrado, notas pessoais e finanças — mesmo com `maskAllText`, ele
        continuaria enviando a geometria da página e o que o mascaramento não
        alcança (canvas, imagem, atributo). É a integração de maior risco e a
        mais pesada do SDK, para o benefício mais marginal num app de um usuário
        que consegue relatar o que aconteceu.

        Se um dia entrar, entra com `maskAllText: true`, `blockAllMedia: true` e
        teste próprio — não como uma linha a mais aqui.
      */

      // O SDK registra várias integrações sozinho; a lista vazia desliga o
      // conjunto padrão. Menos superfície, menos peso, e nada que este projeto
      // use hoje.
      integrations: [],
    });
  });
}
