import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isGoogleConfigured } from "@/lib/env";
import {
  exchangeCodeForTokens,
  fetchUserInfo,
  verifyState,
  GOOGLE_SCOPES,
} from "@/lib/google/oauth";
import { encryptRefreshToken, toPgHex } from "@/lib/crypto/tokens";
import { syncCalendarAccount } from "@/lib/google/calendar";

export const dynamic = "force-dynamic";

function redirectWith(request: NextRequest, params: string) {
  return NextResponse.redirect(new URL(`/calendario?${params}`, request.url));
}

export async function GET(request: NextRequest) {
  if (!isGoogleConfigured()) return redirectWith(request, "error=not_configured");

  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) return redirectWith(request, `error=${encodeURIComponent(oauthError)}`);
  if (!code || !stateRaw) return redirectWith(request, "error=missing_params");

  // Validate the signed state and match it to the current session user.
  const state = verifyState(stateRaw);
  if (!state) return redirectWith(request, "error=invalid_state");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== state.userId) {
    return redirectWith(request, "error=session_mismatch");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // No refresh token -> user had a prior grant. Ask them to reconnect.
      return redirectWith(request, "error=no_refresh_token");
    }
    const info = await fetchUserInfo(tokens.access_token);

    const admin = createAdminClient();

    // Reject connecting the same Google account into the other slot.
    const { data: existingSameSubject } = await admin
      .from("calendar_accounts")
      .select("id, slot")
      .eq("user_id", user.id)
      .eq("google_subject", info.sub)
      .maybeSingle();
    if (existingSameSubject && existingSameSubject.slot !== state.slot) {
      return redirectWith(request, "error=already_connected");
    }

    // Upsert the account metadata (one row per user+slot).
    const { data: account, error: accErr } = await admin
      .from("calendar_accounts")
      .upsert(
        {
          user_id: user.id,
          slot: state.slot,
          google_subject: info.sub,
          email: info.email ?? null,
          display_name: info.name ?? info.email ?? `Conta ${state.slot}`,
          status: "connected",
          scopes: GOOGLE_SCOPES,
          last_error: null,
        },
        { onConflict: "user_id,slot" },
      )
      .select("id, user_id")
      .single();

    if (accErr || !account) {
      // Unique(user_id, google_subject) or other constraint violation.
      return redirectWith(request, "error=connect_failed");
    }

    // Store the refresh token ENCRYPTED (never plaintext, never to the client).
    //
    // O id da conta entra na cifragem como AAD, e por isso esta chamada acontece
    // DEPOIS de a conta existir: o ciphertext fica amarrado à linha em que vai
    // ser gravado. Movido para outra conta, ele deixa de decifrar. Ver
    // src/lib/crypto/tokens.ts.
    const enc = encryptRefreshToken(tokens.refresh_token, account.id as string);
    const { error: credErr } = await admin.from("google_oauth_credentials").upsert(
      {
        calendar_account_id: account.id,
        refresh_token_ciphertext: toPgHex(enc.ciphertext),
        refresh_token_iv: toPgHex(enc.iv),
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        crypto_version: enc.cryptoVersion,
        key_id: enc.keyId,
      },
      { onConflict: "calendar_account_id" },
    );
    if (credErr) return redirectWith(request, "error=credential_store_failed");

    // Initial full sync (best-effort; failure is surfaced but not fatal).
    try {
      await syncCalendarAccount(admin, { id: account.id as string, user_id: account.user_id as string });
    } catch (syncErr) {
      await admin
        .from("calendar_accounts")
        .update({ status: "error", last_error: String(syncErr).slice(0, 300) })
        .eq("id", account.id);
      return redirectWith(request, `connected=${state.slot}&sync=failed`);
    }

    return redirectWith(request, `connected=${state.slot}`);
  } catch {
    return redirectWith(request, "error=oauth_exchange_failed");
  }
}
