import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";

/**
 * Google OAuth 2.0 Authorization Code flow (server-side, offline access).
 * Only read-only calendar scopes are requested.
 */

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
];

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

export interface StatePayload {
  userId: string;
  slot: 1 | 2;
  nonce: string;
  iat: number;
}

/** Signs the OAuth `state` with HMAC so the callback can trust user/slot. */
export function signState(payload: StatePayload): string {
  const { tokenEncryptionKey } = serverEnv();
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", tokenEncryptionKey).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state: string): StatePayload | null {
  const { tokenEncryptionKey } = serverEnv();
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  const expected = createHmac("sha256", tokenEncryptionKey).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
    // 10-minute validity window.
    if (Date.now() - payload.iat > 10 * 60 * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function buildAuthUrl(state: string): string {
  const env = serverEnv();
  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: env.googleRedirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "false",
    prompt: "consent select_account", // force refresh_token + let user pick the account
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const env = serverEnv();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      redirect_uri: env.googleRedirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Falha ao trocar código OAuth: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const env = serverEnv();
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    // 400 invalid_grant => token revoked/expired; caller marks account 'expired'.
    throw new Error(`invalid_grant:${res.status}`);
  }
  return (await res.json()) as TokenResponse;
}

export interface GoogleUserInfo {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

export async function fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Falha ao obter userinfo: ${res.status}`);
  return (await res.json()) as GoogleUserInfo;
}

/**
 * Revoga o token no Google.
 *
 * O token vai no CORPO, nunca na query string. Query string é registrada em
 * toda a cadeia — access log do proxy reverso, APM, histórico do navegador,
 * cabeçalho `Referer` — e um refresh token é credencial de longa duração:
 * quem o obtiver alcança a conta Google dentro dos escopos concedidos até que
 * seja efetivamente revogado. O mesmo raciocínio já estava escrito em
 * `src/lib/cron-auth.ts` para o segredo do agendador.
 *
 * O cabeçalho `x-www-form-urlencoded` já estava aqui — só faltava o corpo que
 * ele descreve.
 */
export async function revokeToken(token: string): Promise<void> {
  await fetch(REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
  }).catch(() => {
    // Best-effort revoke; local disconnect proceeds regardless.
  });
}
