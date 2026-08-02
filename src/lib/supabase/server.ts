import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serverEnv } from "@/lib/env";
import { cookieOptions } from "@/lib/supabase/cookie-options";

/**
 * Server-side Supabase client bound to the request cookies. Runs as the
 * authenticated user (anon key + user JWT), so RLS still applies.
 *
 * `cookieOptions` é o mesmo objeto dos outros dois clientes — ver o arquivo
 * dele para o motivo de os três terem de concordar, e para por que `httpOnly`
 * não está lá.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const env = serverEnv();

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookieOptions,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[],
      ) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component where cookies are read-only.
          // Session refresh is handled by middleware instead — safe to ignore.
        }
      },
    },
  });
}

/** Returns the current user or null (no throw). */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
