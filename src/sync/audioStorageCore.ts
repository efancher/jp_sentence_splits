import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Reference-audio object storage shared by the app (`audioStorage.ts`) and the
 * maintenance scripts (`scripts/lib/referenceAudioStorage.ts`). The gateway
 * address is a parameter so nothing here depends on `import.meta.env`, which
 * does not exist under Node. `base === null` means Supabase Storage only.
 */
export const AUDIO_BUCKET = 'reference-audio';
const GATEWAY_TIMEOUT_MS = 120_000;

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
 * Stores an object. With a gateway the bytes go to R2 only, never to Supabase,
 * so the two stores cannot diverge; failures throw so the caller keeps its local
 * copy and retries, instead of silently falling back to the old destination.
 */
export async function putObject(
  base: string | null,
  supabase: SupabaseClient,
  path: string,
  body: Blob | Uint8Array,
  contentType: string,
): Promise<void> {
  if (!base) {
    const { error } = await supabase.storage
      .from(AUDIO_BUCKET)
      .upload(path, body, { contentType, upsert: true });
    if (error) throw new Error(error.message);
    return;
  }
  const token = await accessToken(supabase);
  if (!token) throw new Error('Not signed in');
  const res = await gatewayFetch(objectUrl(base, path), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
    body: body as BodyInit,
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(`R2 upload failed (${res.status}${detail?.error ? `: ${detail.error}` : ''})`);
  }
}

/**
 * Fetches an object. During migration R2 is tried first, so an object overwritten
 * after being copied is never shadowed by its stale Supabase twin; only a
 * definite "not in R2" (404), or an unreachable/failing gateway, falls back to
 * Supabase Storage. A denied request (401/403/429) does not fall back, because
 * those are answers rather than missing data.
 */
export async function getObject(
  base: string | null,
  supabase: SupabaseClient,
  path: string,
): Promise<{ blob: Blob | null; error?: string }> {
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
  const { data, error } = await supabase.storage.from(AUDIO_BUCKET).download(path);
  if (error || !data) return { blob: null, error: error?.message ?? 'download failed' };
  return { blob: data };
}

/**
 * Deletes objects from BOTH stores. While Supabase still holds pre-migration
 * copies, deleting only from R2 would let reads fall back to a stale Supabase
 * copy, so a removal must clear both. Returns the first error message, if any.
 */
export async function deleteObjects(
  base: string | null,
  supabase: SupabaseClient,
  paths: string[],
): Promise<{ error?: string }> {
  if (paths.length === 0) return {};
  let firstError: string | undefined;
  if (base) {
    const token = await accessToken(supabase);
    if (!token) return { error: 'Not signed in' };
    for (const path of paths) {
      try {
        const res = await gatewayFetch(objectUrl(base, path), {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) firstError ??= `R2 delete failed (${res.status}) for ${path}`;
      } catch (error) {
        firstError ??= `R2 delete failed for ${path}: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }
  const { error } = await supabase.storage.from(AUDIO_BUCKET).remove(paths);
  if (error) firstError ??= error.message;
  return firstError ? { error: firstError } : {};
}
