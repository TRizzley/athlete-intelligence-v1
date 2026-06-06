import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client. Stores the session in cookies so the server
// (middleware + server components) can read it.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
