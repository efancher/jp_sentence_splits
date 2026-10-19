import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAudioObject, putAudioObject, r2GatewayUrl } from '../src/sync/audioStorage';

const PATH = '11111111-1111-1111-1111-111111111111/book 1/audio_1.m4a';

function fakeSupabase(opts: { signedIn?: boolean; supabaseCopy?: Blob | null } = {}) {
  const upload = vi.fn(async () => ({ error: null }));
  const download = vi.fn(async () =>
    opts.supabaseCopy ? { data: opts.supabaseCopy, error: null } : { data: null, error: { message: 'Object not found' } },
  );
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: opts.signedIn === false ? null : { access_token: 'jwt-123' } },
      }),
    },
    storage: { from: () => ({ upload, download }) },
  } as unknown as SupabaseClient;
  return { client, upload, download };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('reference audio storage adapter', () => {
  it('uses Supabase Storage unchanged when no gateway is configured', async () => {
    vi.stubEnv('VITE_R2_GATEWAY_URL', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { client, upload, download } = fakeSupabase({ supabaseCopy: new Blob(['old']) });
    expect(r2GatewayUrl()).toBeNull();
    await putAudioObject(client, PATH, new Blob(['a']), 'audio/mp4');
    expect(upload).toHaveBeenCalledWith(PATH, expect.anything(), { contentType: 'audio/mp4', upsert: true });
    expect((await getAudioObject(client, PATH)).blob).not.toBeNull();
    expect(download).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uploads only to R2 with the session token when the gateway is configured', async () => {
    vi.stubEnv('VITE_R2_GATEWAY_URL', 'https://gw.example/');
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const { client, upload } = fakeSupabase();
    await putAudioObject(client, PATH, new Blob(['a']), 'audio/mp4');
    expect(upload).not.toHaveBeenCalled();
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://gw.example/v1/objects/11111111-1111-1111-1111-111111111111/book%201/audio_1.m4a');
    expect(init.method).toBe('PUT');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt-123', 'Content-Type': 'audio/mp4' });
  });

  it('throws instead of falling back to Supabase when an R2 upload fails or is refused', async () => {
    vi.stubEnv('VITE_R2_GATEWAY_URL', 'https://gw.example');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'storage_limit' }, { status: 507 })));
    const { client, upload } = fakeSupabase();
    await expect(putAudioObject(client, PATH, new Blob(['a']), 'audio/mp4')).rejects.toThrow(/507: storage_limit/);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    await expect(putAudioObject(client, PATH, new Blob(['a']), 'audio/mp4')).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
    await expect(putAudioObject(fakeSupabase({ signedIn: false }).client, PATH, new Blob(['a']), 'audio/mp4')).rejects.toThrow(/signed in/);
  });

  it('prefers the R2 copy, so a stale Supabase twin is never served', async () => {
    vi.stubEnv('VITE_R2_GATEWAY_URL', 'https://gw.example');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('new-bytes', { status: 200 })));
    const { client, download } = fakeSupabase({ supabaseCopy: new Blob(['stale']) });
    const { blob } = await getAudioObject(client, PATH);
    expect(await blob?.text()).toBe('new-bytes');
    expect(download).not.toHaveBeenCalled();
  });

  it('falls back to Supabase for a clip not yet copied (404) or an unreachable/failing gateway', async () => {
    vi.stubEnv('VITE_R2_GATEWAY_URL', 'https://gw.example');
    for (const behaviour of [
      async () => new Response('{}', { status: 404 }),
      async () => new Response('{}', { status: 503 }),
      async () => { throw new TypeError('network down'); },
    ]) {
      vi.stubGlobal('fetch', vi.fn(behaviour));
      const { client, download } = fakeSupabase({ supabaseCopy: new Blob(['legacy']) });
      expect(await (await getAudioObject(client, PATH)).blob?.text()).toBe('legacy');
      expect(download).toHaveBeenCalledOnce();
    }
  });

  it('does not fall back when the gateway refuses the request (401/403/429)', async () => {
    vi.stubEnv('VITE_R2_GATEWAY_URL', 'https://gw.example');
    for (const status of [401, 403, 429]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
      const { client, download } = fakeSupabase({ supabaseCopy: new Blob(['legacy']) });
      const result = await getAudioObject(client, PATH);
      expect(result.blob).toBeNull();
      expect(result.error).toContain(String(status));
      expect(download).not.toHaveBeenCalled();
    }
  });
});
