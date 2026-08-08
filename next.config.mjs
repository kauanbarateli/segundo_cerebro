import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */

/**
 * Cabeçalhos de segurança (plano v3, §M8-P0).
 *
 * A CSP NÃO está nesta lista, e agora por um motivo diferente do original: ela
 * existe, já é emitida, e mora em outro lugar — src/lib/csp.ts, aplicada pelo
 * middleware (src/middleware.ts).
 *
 * Por que lá e não aqui: a política precisa citar a URL do projeto Supabase,
 * que é lida em src/lib/env.ts (TypeScript, que este arquivo não importa), e a
 * promoção para modo de bloqueio vai exigir um `nonce` por requisição — que
 * `headers()`, sendo estático, não sabe produzir. O raciocínio completo, as
 * dívidas conhecidas ('unsafe-inline') e o passo a passo da promoção estão no
 * cabeçalho de src/lib/csp.ts.
 *
 * ATENÇÃO ao ler os dois arquivos juntos: o que sobe hoje é
 * `Content-Security-Policy-Report-Only`, que NÃO BLOQUEIA NADA. Os cinco
 * cabeçalhos abaixo continuam sendo a única proteção que de fato vale agora.
 */
const securityHeaders = [
  // Impede o navegador de "adivinhar" o tipo de um arquivo servido. Sem isso,
  // um upload do Drive com Content-Type errado pode ser interpretado como HTML
  // e executar script no contexto do site.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Não vaza o caminho completo da página para sites externos.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // A aplicação não usa nenhuma dessas APIs. Negar por padrão.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // Só tem efeito sob HTTPS; em localhost o navegador ignora.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Defesa contra clickjacking.
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  experimental: {
    /**
     * Correção C1 — cache do roteador no cliente.
     *
     * No Next 15 `staleTimes.dynamic` vale 0 por padrão. Como toda página aqui
     * é dinâmica (lê cookies de sessão), TODA navegação — inclusive voltar para
     * uma aba visitada há dois segundos — refaz o request completo ao servidor.
     *
     * Com 30 s, revisitar uma aba recente é servido do cache do cliente e fica
     * instantâneo. As mutações continuam corretas porque toda Server Action
     * chama `revalidatePath`, que invalida esse cache explicitamente.
     */
    staleTimes: { dynamic: 30, static: 180 },
  },

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

/**
 * O embrulho do Sentry — e as três coisas que ele NÃO deve fazer aqui.
 *
 * `withSentryConfig` existe para enviar SOURCE MAPS na build (sem eles a pilha
 * de um erro de produção é `a.b.c` minificado e não serve para nada) e para
 * instrumentar o servidor.
 *
 * ⚠️ `widenClientFileUpload: false` — o padrão `true` sobe também os mapas dos
 * chunks compartilhados. Ganha stack trace um pouco melhor e faz a build
 * demorar bem mais; não vale num projeto deste tamanho.
 *
 * ⚠️ `disableLogger: true` tira do pacote do navegador as mensagens de
 * depuração do próprio SDK — é peso puro em produção.
 *
 * ⚠️ `tunnelRoute` fica DESLIGADO de propósito. Ele criaria uma rota no
 * próprio domínio para repassar a telemetria e driblar bloqueadores de
 * anúncio. Além de contornar uma escolha do usuário, ele transformaria a
 * aplicação num proxy aberto para o endpoint do Sentry — e a CSP, que esta
 * etapa acabou de ajustar com a origem exata, deixaria de ser a barreira que é.
 *
 * Sem `SENTRY_AUTH_TOKEN` o plugin não sobe mapa nenhum e a build segue
 * normal — que é o caso de quem clonar o projeto sem conta no Sentry.
 */
export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  widenClientFileUpload: false,
  disableLogger: true,
  telemetry: false,
});
