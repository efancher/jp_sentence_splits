import { createClient } from '@supabase/supabase-js';

import { requireEnv } from './env';

/**
 * Node-side Supabase client for maintenance scripts, authed the same way
 * the browser app authenticates (anon key + real user session) rather than
 * a service-role key — there's no service-role precedent in this repo
 * outside one Edge Function, and every RLS policy here is already
 * `owner_id = auth.uid()`, which a signed-in anon session satisfies exactly
 * like the browser does.
 */
export async function createScriptSupabaseClient() {
  const url = requireEnv('VITE_SUPABASE_URL');
  const anonKey = requireEnv('VITE_SUPABASE_ANON_KEY');
  const email = requireEnv('SCRIPT_SUPABASE_EMAIL');
  const password = requireEnv('SCRIPT_SUPABASE_PASSWORD');

  const client = createClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(`Supabase sign-in failed: ${error.message}`);
  }
  return client;
}
