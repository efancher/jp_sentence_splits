import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null | undefined;

export function isSupabaseConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return Boolean(url && key && String(url).length > 0 && String(key).length > 0);
}

/** Returns null when env vars are missing (local-only mode). */
export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  if (!isSupabaseConfigured()) {
    client = null;
    return client;
  }
  client = createClient(
    String(import.meta.env.VITE_SUPABASE_URL),
    String(import.meta.env.VITE_SUPABASE_ANON_KEY),
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    },
  );
  return client;
}

/** Test helper. */
export function resetSupabaseClientForTests(): void {
  client = undefined;
}
