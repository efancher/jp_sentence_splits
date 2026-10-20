import type { SupabaseClient } from '@supabase/supabase-js';

import { getObject, putObject } from './audioStorageCore';

/** Base URL of the R2 gateway, or null while reference audio stays on Supabase Storage. */
export function r2GatewayUrl(): string | null {
  const url = import.meta.env.VITE_R2_GATEWAY_URL;
  return url ? url.replace(/\/+$/, '') : null;
}

/** App-side wrappers; the storage rules live in `audioStorageCore.ts`. */
export function putAudioObject(
  supabase: SupabaseClient,
  path: string,
  blob: Blob,
  contentType: string,
): Promise<void> {
  return putObject(r2GatewayUrl(), supabase, path, blob, contentType);
}

export function getAudioObject(
  supabase: SupabaseClient,
  path: string,
): Promise<{ blob: Blob | null; error?: string }> {
  return getObject(r2GatewayUrl(), supabase, path);
}
