import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Server-only client using the service role key. Bypasses RLS.
// Only import this from server code that has already verified the caller is
// an admin. Never expose the service role key to the browser.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
