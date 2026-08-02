"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";
import { cookieOptions } from "@/lib/supabase/cookie-options";

/**
 * Browser Supabase client. Uses only the public anon key — every request is
 * gated by RLS. Never import server-only secrets here.
 *
 * `cookieOptions` é o mesmo objeto dos outros dois clientes — ver o arquivo
 * dele para o motivo de os três terem de concordar, e para por que `httpOnly`
 * não está lá.
 */
export function createClient() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookieOptions,
  });
}
