import type { SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'reference-audio';
const GATEWAY_TIMEOUT_MS = 120_000;

/** Base URL of the R2 gateway, or null while reference audio stays on Supabase Storage. */
export function r2GatewayUrl(): string | null {
  const url = import.meta.env.VITE_R2_GATEWAY_URL;
  return url ? url.replace(/\/+$/, '') : null;
}

async function accessToken(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function gatewayFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS) });
}

function objectUrl(base: string, path: string): string {
  return `${base}/v1/objects/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Stores a reference-audio object. With the gateway configured the bytes go to
 * R2 only, never to Supabase, so the two stores cannot diverge; failures throw
 * so the caller keeps the local copy and retries, instead of silently falling
 * back to the old destination.
 */
export async function putAudioObject(
  supabase: SupabaseClient,
  path: string,
  blob: Blob,
  contentType: string,
): Promise<void> {
  const base = r2GatewayUrl();
  if (!base) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, { contentType, upsert: true });
    if (error) throw new Error(error.message);
    return;
  }
  const token = await accessToken(supabase);
  if (!token) throw new Error('Not signed in');
  const res = await gatewayFetch(objectUrl(base, path), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body: blob,
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(`R2 upload failed (${res.status}${detail?.error ? `: ${detail.error}` : ''})`);
  }
}

/**
 * Fetches a reference-audio object. During migration R2 is tried first, so an
 * object overwritten after being copied is never shadowed by its stale Supabase
 * twin; only a definite "not in R2" (404), or an unreachable/failing gateway,
 * falls back to Supabase Storage. A denied request (401/403/429/507) does not
 * fall back, because those are answers rather than missing data.
 */
export async function getAudioObject(
  supabase: SupabaseClient,
  path: string,
): Promise<{ blob: Blob | null; error?: string }> {
  const base = r2GatewayUrl();
  if (base) {
    const token = await accessToken(supabase);
    if (token) {
      try {
        const res = await gatewayFetch(objectUrl(base, path), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) return { blob: await res.blob() };
        if (res.status !== 404 && res.status < 500) {
          return { blob: null, error: `R2 download refused (${res.status})` };
        }
      } catch {
        // Gateway unreachable: fall through to the Supabase copy.
      }
    }
  }
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return { blob: null, error: error?.message ?? 'download failed' };
  return { blob: data };
}
