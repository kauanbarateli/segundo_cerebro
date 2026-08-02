import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/**
 * Admin client using the service_role key. BYPASSES RLS — use only in
 * server-side code for operations that must reach protected tables (e.g. the
 * google_oauth_credentials table). Never expose the returned client to the
 * browser and never trust unvalidated user input when scoping queries.
 */
export function createAdminClient() {
  const env = serverEnv();
  if (!env.supabaseServiceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  return createSupabaseClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
