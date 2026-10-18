import { Blob as NodeBlob } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb, resetDbForTests } from '../src/db/database';
import { getEpisodeBlob } from '../src/lib/sourceEpisodeCache';
import { downloadReferenceAudio, hydrateMissingReferenceAudio } from '../src/sync/audioSync';
import { updateSyncMeta } from '../src/sync/queue';
import { usageMeter } from './helpers/usageMeter';
import { checkUsageBudget } from './helpers/usageBudget';

const current = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../src/sync/supabaseClient', () => ({ getSupabase: () => current.client }));

const CLIP_BYTES = 32 * 1024;
let failClip = false;
const meter = usageMeter(async (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname === '/rest/v1/reference_audio') {
    const ids = (url.searchParams.get('id') ?? '').slice(4, -1).split(',').map((id) => id.replaceAll('"', ''));
    return Response.json(ids.map((id) => ({ id, storage_path: `fixture/${id}.wav`, mime_type: 'audio/wav' })));
  }
  if (url.pathname.startsWith('/storage/v1/object/')) {
    if (failClip && url.pathname.endsWith('/a-0.wav')) {
      return Response.json({ message: 'temporary failure' }, { status: 503 });
    }
    return new Response(new Uint8Array(CLIP_BYTES), { headers: { 'Content-Type': 'audio/wav' } });
  }
  throw new Error(`Unexpected fixture endpoint: ${url.pathname}`);
});

beforeEach(async () => {
  resetDbForTests();
  // Real Blob cloning in fake-indexeddb requires Node's Blob, not jsdom's.
  vi.stubGlobal('Blob', NodeBlob);
  meter.reset();
  failClip = false;
  current.client = createClient('http://fixture.test', 'fixture-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: meter.fetch },
  });
  await updateSyncMeta({ syncReferenceAudio: true, wifiOnlyAudioDownload: false });
  for (let i = 0; i < 4; i++) {
    await getDb().sentenceAudio.put({
      id: `a-${i}`, sentenceId: `s-${i}`, sourceId: 'source', sourceSentenceId: `s-${i}`,
      sourceTitle: 'Synthetic audio', mimeType: 'audio/wav', blob: new Blob([]),
      durationMs: 1000, startMs: 0, endMs: 1000, importedAt: '2026-01-01T00:00:00Z',
    });
  }
});
afterEach(() => vi.unstubAllGlobals());

describe('audio transfer budgets through the real storage client', () => {
  it('shares concurrent cache restoration, then transfers nothing for warm playback/sync', async () => {
    expect(await Promise.all([hydrateMissingReferenceAudio(), hydrateMissingReferenceAudio()])).toEqual([4, 4]);
    expect(meter.totals('storage')).toEqual({ requests: 4, requestBodyBytes: 0, responseBodyBytes: 4 * CLIP_BYTES });
    expect(meter.totals('database').requests).toBe(1);
    expect(meter.totals('database').responseBodyBytes).toBeLessThanOrEqual(512);
    checkUsageBudget('audio-restore-four-clips', meter.totals());
    meter.reset();
    expect(await hydrateMissingReferenceAudio()).toBe(0);
    for (let i = 0; i < 4; i++) {
      expect((await downloadReferenceAudio(`a-${i}`, `fixture/a-${i}.wav`))?.size).toBe(CLIP_BYTES);
    }
    expect(meter.totals()).toEqual({ requests: 0, requestBodyBytes: 0, responseBodyBytes: 0 });
    checkUsageBudget('audio-warm-cache', meter.totals());
  });

  it('reconnect retries only the failed clip, preserving successful downloads', async () => {
    failClip = true;
    expect(await hydrateMissingReferenceAudio()).toBe(3);
    expect(meter.totals('storage').requests).toBe(4);
    expect(meter.totals('storage').responseBodyBytes).toBeLessThanOrEqual(3 * CLIP_BYTES + 128);
    meter.reset();
    failClip = false;
    expect(await hydrateMissingReferenceAudio()).toBe(1);
    expect(meter.totals('storage')).toEqual({ requests: 1, requestBodyBytes: 0, responseBodyBytes: CLIP_BYTES });
    expect(meter.totals('database').requests).toBe(1);
    expect(meter.totals('database').responseBodyBytes).toBeLessThanOrEqual(128);
    checkUsageBudget('audio-retry-one-clip', meter.totals());
  });

  it('reuses a downloaded source episode on subsequent adjustments', async () => {
    expect((await getEpisodeBlob('synthetic-episode')).size).toBe(CLIP_BYTES);
    expect((await getEpisodeBlob('synthetic-episode')).size).toBe(CLIP_BYTES);
    expect(meter.totals('storage')).toEqual({ requests: 1, requestBodyBytes: 0, responseBodyBytes: CLIP_BYTES });
    checkUsageBudget('source-episode-two-reads', meter.totals());
  });

  it('does not transfer reference audio when audio sync is disabled', async () => {
    await updateSyncMeta({ syncReferenceAudio: false });
    expect(await hydrateMissingReferenceAudio()).toBe(0);
    expect(meter.totals().requests).toBe(0);
  });
});
