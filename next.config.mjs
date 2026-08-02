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

export default nextConfig;
