/**
 * Centralized, typed environment access.
 *
 * `publicEnv` values are safe for the browser (they are NEXT_PUBLIC_*).
 * `serverEnv()` throws if called from the client bundle and reads secrets that
 * must never be exposed. Import `serverEnv` only from server code.
 */

/**
 * Apara espaços das pontas do valor.
 *
 * Um `.env` com `GOOGLE_CLIENT_ID= 348263...` (espaço depois do "=") carrega o
 * espaço para dentro do valor. O Google devolve `invalid_client`, que não diz
 * nada sobre a causa e custa horas para achar.
 *
 * ⚠️ NÃO transforme isto em `env("NEXT_PUBLIC_X")` lendo `process.env[key]`.
 * O Next substitui `process.env.NEXT_PUBLIC_X` no bundle do cliente por
 * SUBSTITUIÇÃO DE TEXTO, e só reconhece o acesso literal por ponto. Com chave
 * dinâmica a expressão sobrevive até a execução e cai no shim de `process` do
 * navegador, cujo `env` é um objeto vazio — as variáveis públicas viram string
 * vazia e todo cliente Supabase no navegador para de funcionar.
 *
 * Por isso o nome da variável aparece por extenso em cada linha abaixo. É
 * repetitivo de propósito: é o que o bundler precisa enxergar.
 */
function trimmed(value: string | undefined, fallback = ""): string {
  return (value ?? fallback).trim();
}

export const publicEnv = {
  appUrl: trimmed(process.env.NEXT_PUBLIC_APP_URL, "http://localhost:3000"),
  supabaseUrl: trimmed(process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: trimmed(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
};

export function isSupabaseConfigured(): boolean {
  return Boolean(publicEnv.supabaseUrl && publicEnv.supabaseAnonKey);
}

/** True only when every Google OAuth variable is present (server-side check). */
export function isGoogleConfigured(): boolean {
  return Boolean(
    trimmed(process.env.GOOGLE_CLIENT_ID) &&
      trimmed(process.env.GOOGLE_CLIENT_SECRET) &&
      trimmed(process.env.GOOGLE_REDIRECT_URI) &&
      // Qualquer uma das duas serve: a lista (formato novo, com rotação) ou a
      // chave única (formato antigo, ainda suportado).
      (trimmed(process.env.TOKEN_ENCRYPTION_KEYS) || trimmed(process.env.TOKEN_ENCRYPTION_KEY)),
  );
}

export function serverEnv() {
  if (typeof window !== "undefined") {
    throw new Error("serverEnv() must not be called in the browser");
  }
  return {
    appUrl: trimmed(process.env.NEXT_PUBLIC_APP_URL, "http://localhost:3000"),
    supabaseUrl: trimmed(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseAnonKey: trimmed(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    supabaseServiceRoleKey: trimmed(process.env.SUPABASE_SERVICE_ROLE_KEY),
    googleClientId: trimmed(process.env.GOOGLE_CLIENT_ID),
    googleClientSecret: trimmed(process.env.GOOGLE_CLIENT_SECRET),
    googleRedirectUri: trimmed(process.env.GOOGLE_REDIRECT_URI),
    /**
     * Chave única, formato antigo. Continua valendo — é o que está no ambiente
     * hoje, e renomeá-la invalidaria os refresh tokens já gravados. Usada
     * quando `TOKEN_ENCRYPTION_KEYS` não está definida.
     */
    tokenEncryptionKey: trimmed(process.env.TOKEN_ENCRYPTION_KEY),
    /**
     * Lista ordenada `id:base64,id:base64`, da chave ATIVA para a mais antiga.
     * É o que permite rotacionar sem reconectar as contas do Google. Ver
     * `chavesDeToken()` em src/lib/crypto/tokens.ts.
     */
    tokenEncryptionKeys: trimmed(process.env.TOKEN_ENCRYPTION_KEYS),
    cronSecret: trimmed(process.env.CRON_SECRET),
  };
}
