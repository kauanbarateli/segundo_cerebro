/**
 * Sentry no SERVIDOR e no EDGE.
 *
 * O Next chama `register()` uma vez por runtime, antes de qualquer código da
 * aplicação. `NEXT_RUNTIME` diz qual deles está subindo — e são dois de verdade
 * neste projeto: o middleware roda no Edge (ver `src/middleware.ts`) e as
 * server actions rodam no Node.
 *
 * ⚠️ O `import()` é dinâmico de propósito. Um import estático do SDK do Node no
 * topo deste arquivo seria avaliado TAMBÉM ao montar o bundle do Edge, onde
 * metade das APIs que ele usa não existe.
 */
export async function register() {
  const { DSN } = await import("@/lib/observabilidade");
  if (!DSN) return;

  const Sentry = await import("@sentry/nextjs");
  const { AMOSTRAGEM_DE_TRACO, filtrarEvento, filtrarTrilha } = await import(
    "@/lib/observabilidade"
  );

  // A MESMA allowlist dos três ambientes. Duas cópias da regra de privacidade
  // divergiriam na primeira mudança, e a divergência não daria erro de
  // compilação — daria um vazamento só no servidor.
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: AMOSTRAGEM_DE_TRACO,
    sendDefaultPii: false,
    beforeSend: (evento) => filtrarEvento(evento as never) as never,
    beforeBreadcrumb: (trilha) => filtrarTrilha(trilha as never) as never,
    integrations: [],
  });
}

/**
 * Erros de renderização no servidor (React Server Components, rotas, actions).
 *
 * Sem este gancho o Next trata a exceção, mostra o `error.tsx` e NÃO avisa
 * ninguém — que é metade do problema que esta etapa veio resolver.
 */
export async function onRequestError(
  ...args: Parameters<typeof import("@sentry/nextjs").captureRequestError>
) {
  const { DSN } = await import("@/lib/observabilidade");
  if (!DSN) return;
  const Sentry = await import("@sentry/nextjs");
  return Sentry.captureRequestError(...args);
}
