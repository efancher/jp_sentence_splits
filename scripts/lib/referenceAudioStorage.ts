import type { SupabaseClient } from '@supabase/supabase-js';

import { deleteObjects, getObject, putObject } from '../../src/sync/audioStorageCore';

/**
 * Reference-audio storage for maintenance scripts. The app now sends new clips
 * to R2, so a script that talks to Supabase Storage directly cannot see them.
 * These helpers keep the `{ data, error }` shape of `supabase.storage.from(...)`
 * so call sites change by one line:
 *
 *   download(path)          -> downloadReferenceClip(supabase, path)
 *   upload(path, bytes, o)  -> uploadReferenceClip(supabase, path, bytes, o)
 *   remove(paths)           -> removeReferenceClips(supabase, paths)
 *
 * The gateway address comes from R2_GATEWAY_URL (or VITE_R2_GATEWAY_URL). When
 * neither is set the helpers use Supabase Storage only and say so once, because
 * clips written that way will not be in R2 until the copy script is re-run.
 */
let warned = false;
export function scriptGatewayUrl(): string | null {
  const url = process.env.R2_GATEWAY_URL || process.env.VITE_R2_GATEWAY_URL;
  if (url) return url.replace(/\/+$/, '');
  if (!warned) {
    warned = true;
    console.warn('R2_GATEWAY_URL is not set: reference audio is read from and written to Supabase Storage only.');
  }
  return null;
}

export async function downloadReferenceClip(
  supabase: SupabaseClient,
  path: string,
): Promise<{ data: Blob | null; error: { message: string } | null }> {
  const { blob, error } = await getObject(scriptGatewayUrl(), supabase, path);
  return blob ? { data: blob, error: null } : { data: null, error: { message: error ?? 'download failed' } };
}

export async function uploadReferenceClip(
  supabase: SupabaseClient,
  path: string,
  bytes: Uint8Array | Blob,
  options: { contentType: string; upsert?: boolean },
): Promise<{ error: { message: string } | null }> {
  try {
    await putObject(scriptGatewayUrl(), supabase, path, bytes, options.contentType);
    return { error: null };
  } catch (error) {
    return { error: { message: error instanceof Error ? error.message : String(error) } };
  }
}

export async function removeReferenceClips(
  supabase: SupabaseClient,
  paths: string[],
): Promise<{ error: { message: string } | null }> {
  const { error } = await deleteObjects(scriptGatewayUrl(), supabase, paths);
  return { error: error ? { message: error } : null };
}
