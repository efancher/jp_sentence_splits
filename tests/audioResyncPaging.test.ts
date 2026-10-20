import { Blob as NodeBlob } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb, resetDbForTests } from '../src/db/database';
import { resyncReferenceAudio } from '../src/sync/audioSync';
import { updateSyncMeta } from '../src/sync/queue';

const current = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../src/sync/supabaseClient', () => ({ getSupabase: () => current.client }));

const TOTAL = 2500;

beforeEach(async () => {
  resetDbForTests();
  vi.stubGlobal('Blob', NodeBlob);
  // Mimic PostgREST's server-side cap: never more than 1000 rows per response.
  const fetchFixture = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === '/auth/v1/user') return Response.json({});
    if (url.pathname !== '/rest/v1/reference_audio') return new Response(new Uint8Array(1));
    const from = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 1000);
    const count = Math.max(0, Math.min(limit, 1000, TOTAL - from));
    return Response.json(
      Array.from({ length: count }, (_, i) => ({
        id: `clip-${from + i}`,
        sentence_id: `s-${from + i}`,
        mime_type: 'audio/wav',
        created_at: '2026-01-01T00:00:00Z',
      })),
    );
  };
  current.client = Object.assign(
    createClient('http://fixture.test', 'fixture-anon-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchFixture },
    }),
  );
  (current.client as { auth: unknown }).auth = {
    getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
  };
  await updateSyncMeta({ syncReferenceAudio: true, wifiOnlyAudioDownload: true });
});
afterEach(() => vi.unstubAllGlobals());

describe('resyncReferenceAudio paging', () => {
  it('creates local rows for every cloud clip, not just the first 1000', async () => {
    expect(await resyncReferenceAudio()).toBe(TOTAL);
    expect(await getDb().sentenceAudio.count()).toBe(TOTAL);
  });
});
