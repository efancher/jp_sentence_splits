import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null | undefined;

const REQUEST_TIMEOUT_MS = 30_000;
/** Storage transfers (audio up to 50 MiB) legitimately take longer. */
const STORAGE_TIMEOUT_MS = 120_000;

/**
 * supabase-js has no request timeout: one connection Safari leaves hanging
 * blocks the sync cycle forever and the status sits on "syncing". Abort after a
 * deadline so the cycle fails (and retries) instead.
 */
export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const timeoutMs = url.includes('/storage/v1/') ? STORAGE_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs / 1000}s`)), timeoutMs);
  const outer = init.signal;
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener('abort', () => controller.abort(outer.reason), { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

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
      global: { fetch: fetchWithTimeout },
    },
  );
  return client;
}

/** Test helper. */
export function resetSupabaseClientForTests(): void {
  client = undefined;
}
