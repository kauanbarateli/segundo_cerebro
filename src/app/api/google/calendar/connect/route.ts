import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isGoogleConfigured } from "@/lib/env";
import { buildAuthUrl, signState } from "@/lib/google/oauth";

export const dynamic = "force-dynamic";

/** Starts the OAuth flow for a given slot (1 or 2). */
export async function GET(request: NextRequest) {
  if (!isGoogleConfigured()) {
    return NextResponse.redirect(new URL("/calendario?error=not_configured", request.url));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const slotRaw = request.nextUrl.searchParams.get("slot");
  const slot = slotRaw === "2" ? 2 : slotRaw === "1" ? 1 : null;
  if (slot === null) {
    return NextResponse.redirect(new URL("/calendario?error=invalid_slot", request.url));
  }

  // Signed, short-lived state binds the callback to this user + slot.
  const nonce = crypto.randomUUID();
  const state = signState({ userId: user.id, slot, nonce, iat: Date.now() });

  return NextResponse.redirect(buildAuthUrl(state));
}
