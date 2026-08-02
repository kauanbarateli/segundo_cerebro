import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptRefreshToken, fromPgHex } from "@/lib/crypto/tokens";
import { revokeToken } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

/** Disconnects an account: best-effort token revoke + cascade delete. Body: { accountId }. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let accountId: string | undefined;
  try {
    ({ accountId } = (await request.json()) as { accountId?: string });
  } catch {
    /* ignore */
  }
  if (!accountId) return NextResponse.json({ ok: false, error: "missing_account" }, { status: 400 });

  // Verify ownership through the RLS-scoped client before touching anything.
  const { data: owned } = await supabase
    .from("calendar_accounts")
    .select("id")
    .eq("id", accountId)
    .maybeSingle();
  if (!owned) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const admin = createAdminClient();

  // Best-effort revoke at Google before deleting local credentials.
  const { data: cred } = await admin
    .from("google_oauth_credentials")
    .select("refresh_token_ciphertext, refresh_token_iv, crypto_version, key_id")
    .eq("calendar_account_id", accountId)
    .maybeSingle();
  if (cred) {
    try {
      const token = decryptRefreshToken({
        ciphertext: fromPgHex(cred.refresh_token_ciphertext as string),
        iv: fromPgHex(cred.refresh_token_iv as string),
        cryptoVersion: (cred.crypto_version as number | null) ?? null,
        keyId: (cred.key_id as string | null) ?? null,
        calendarAccountId: accountId,
      });
      await revokeToken(token);
    } catch {
      /* proceed with local disconnect regardless */
    }
  }

  // Cascade delete removes sources, events and credentials via FKs.
  const { error } = await admin.from("calendar_accounts").delete().eq("id", accountId);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
