import { Blob as NodeBlob } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb, resetDbForTests } from '../src/db/database';
import { refreshSentenceAudioFromCloud } from '../src/sync/audioSync';
import { putRecordMeta, updateSyncMeta } from '../src/sync/queue';

const current = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../src/sync/supabaseClient', () => ({ getSupabase: () => current.client }));

const cloudRows = [
  {
    id: 'keep',
    sentence_id: 's1',
    mime_type: 'audio/wav',
    size_bytes: 1,
    source_start_ms: 500,
    source_end_ms: 900,
    version: 3,
    created_at: '2026-01-01T00:00:00Z',
  },
];

function localClip(id: string, sentenceId = 's1') {
  return {
    id,
    sentenceId,
    sourceId: '',
    sourceSentenceId: '',
    sourceTitle: '',
    mimeType: 'audio/wav',
    durationMs: 1,
    startMs: 0,
    endMs: 1,
    blob: new Blob([new Uint8Array(1)], { type: 'audio/wav' }),
    importedAt: '2026-01-01T00:00:00Z',
  };
}

beforeEach(async () => {
  resetDbForTests();
  vi.stubGlobal('Blob', NodeBlob);
  const fetchFixture = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === '/rest/v1/reference_audio') {
      expect(url.searchParams.get('sentence_id')).toBe('eq.s1');
      return Response.json(cloudRows);
    }
    return new Response(new Uint8Array(1));
  };
  current.client = createClient('http://fixture.test', 'fixture-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchFixture },
  });
  (current.client as { auth: unknown }).auth = {
    getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }),
  };
  await updateSyncMeta({ syncReferenceAudio: true });
});
afterEach(() => vi.unstubAllGlobals());

describe('refreshSentenceAudioFromCloud', () => {
  it('updates cloud clips, drops synced clips the cloud retired, keeps unsynced local ones', async () => {
    const db = getDb();
    await db.sentenceAudio.bulkPut([localClip('keep'), localClip('retired'), localClip('local-only'), localClip('other', 's2')]);
    await putRecordMeta({ entity: 'reference_audio', recordId: 'retired', version: 1, syncedVersion: 1, updatedAt: '2026-01-01T00:00:00Z' });
    await putRecordMeta({ entity: 'reference_audio', recordId: 'other', version: 1, syncedVersion: 1, updatedAt: '2026-01-01T00:00:00Z' });

    expect(await refreshSentenceAudioFromCloud('s1')).toEqual({ refreshed: 1, removed: 1 });

    expect((await db.sentenceAudio.get('keep'))?.startMs).toBe(500);
    expect(await db.sentenceAudio.get('retired')).toBeUndefined();
    expect(await db.sentenceAudio.get('local-only')).toBeDefined();
    expect(await db.sentenceAudio.get('other')).toBeDefined();
  });
});
