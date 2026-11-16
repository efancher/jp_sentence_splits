import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb, resetDbForTests } from '../src/db/database';
import type { SentenceAudio } from '../src/domain/types';
import {
  clearDownloadedAudioCache,
  downloadReferenceAudio,
  hydrateMissingReferenceAudio,
  pushMissingReferenceAudio,
  repairSentenceAudio,
  uploadReferenceAudio,
} from '../src/sync/audioSync';
import { updateSyncMeta } from '../src/sync/queue';

type Row = Record<string, unknown>;
type QueryResult = { data: Row[] | Row | null; error: { message: string } | null };

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  putAudioObject: vi.fn(),
  getAudioObject: vi.fn(),
  trackLocalMutation: vi.fn(),
}));
vi.mock('../src/sync/supabaseClient', () => ({ getSupabase: () => mocks.client }));
vi.mock('../src/sync/audioStorage', () => ({
  putAudioObject: mocks.putAudioObject,
  getAudioObject: mocks.getAudioObject,
}));
vi.mock('../src/sync/track', () => ({ trackLocalMutation: mocks.trackLocalMutation }));

/** A chainable stand-in for the PostgREST builder that resolves to whatever `respond` returns. */
function fakeClient(respond: (table: string, calls: string[]) => QueryResult, userId: string | null = 'u1') {
  const builder = (table: string) => {
    const calls: string[] = [];
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'order', 'range', 'in']) {
      chain[method] = (...args: unknown[]) => {
        calls.push(`${method}:${args.map(String).join(',')}`);
        return chain;
      };
    }
    chain.maybeSingle = async () => respond(table, calls);
    chain.then = (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(respond(table, calls)).then(resolve, reject);
    return chain;
  };
  return {
    from: builder,
    auth: { getSession: async () => ({ data: { session: userId ? { user: { id: userId } } : null } }) },
  };
}

function clip(id: string, bytes = 3, sentenceId = `s-${id}`): SentenceAudio {
  return {
    id,
    sentenceId,
    sourceId: '',
    sourceSentenceId: '',
    sourceTitle: '',
    mimeType: 'audio/ogg',
    durationMs: 1,
    startMs: 0,
    endMs: 1,
    blob: new Blob([new Uint8Array(bytes)], { type: 'audio/ogg' }),
    importedAt: '2026-01-01T00:00:00Z',
  };
}

function blobOf(bytes: number, type = 'audio/ogg'): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

beforeEach(async () => {
  resetDbForTests();
  vi.stubGlobal('Blob', NodeBlob);
  mocks.putAudioObject.mockReset().mockResolvedValue(undefined);
  mocks.getAudioObject.mockReset();
  mocks.trackLocalMutation.mockReset().mockResolvedValue(undefined);
  mocks.client = fakeClient(() => ({ data: [], error: null }));
  await updateSyncMeta({ syncReferenceAudio: true, wifiOnlyAudioDownload: false });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('uploadReferenceAudio', () => {
  it('uploads to an owner/book path with an extension matching the MIME type and queues the metadata', async () => {
    const path = await uploadReferenceAudio({ audio: clip('a1'), bookId: 'book1', ownerId: 'u1' });

    expect(path).toBe('u1/book1/a1.opus');
    expect(mocks.putAudioObject).toHaveBeenCalledWith(mocks.client, 'u1/book1/a1.opus', expect.anything(), 'audio/ogg');
    expect(mocks.trackLocalMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'reference_audio',
        recordId: 'a1',
        operation: 'upsert',
        payload: expect.objectContaining({ storagePath: 'u1/book1/a1.opus', sizeBytes: 3 }),
      }),
    );
  });

  it('files a clip with no book under "unassigned" and maps mpeg/wav/other types to their extensions', async () => {
    const upload = (mimeType: string) => uploadReferenceAudio({ audio: { ...clip('a2'), mimeType }, ownerId: 'u1' });
    expect(await upload('audio/mpeg')).toBe('u1/unassigned/a2.mp3');
    expect(await upload('audio/wav')).toBe('u1/unassigned/a2.wav');
    expect(await upload('audio/mp4')).toBe('u1/unassigned/a2.m4a');
  });

  it('does nothing when reference-audio sync is off', async () => {
    await updateSyncMeta({ syncReferenceAudio: false });
    expect(await uploadReferenceAudio({ audio: clip('a3'), ownerId: 'u1' })).toBeNull();
    expect(mocks.putAudioObject).not.toHaveBeenCalled();
    expect(mocks.trackLocalMutation).not.toHaveBeenCalled();
  });

  it('rejects an unsupported MIME type before touching storage', async () => {
    await expect(
      uploadReferenceAudio({ audio: { ...clip('a4'), mimeType: 'video/mp4' }, ownerId: 'u1' }),
    ).rejects.toThrow('Unsupported audio type: video/mp4');
    expect(mocks.putAudioObject).not.toHaveBeenCalled();
  });

  it('rejects a clip over 50 MiB', async () => {
    const huge = { ...clip('a5'), blob: { size: 50 * 1024 * 1024 + 1, type: 'audio/ogg' } as Blob };
    await expect(uploadReferenceAudio({ audio: huge, ownerId: 'u1' })).rejects.toThrow('50 MiB');
    expect(mocks.putAudioObject).not.toHaveBeenCalled();
  });

  it('does not queue metadata when the storage upload fails, so no row points at a missing object', async () => {
    mocks.putAudioObject.mockRejectedValue(new Error('network down'));
    await expect(uploadReferenceAudio({ audio: clip('a6'), ownerId: 'u1' })).rejects.toThrow('network down');
    expect(mocks.trackLocalMutation).not.toHaveBeenCalled();
  });
});

describe('pushMissingReferenceAudio', () => {
  it('uploads only clips the cloud lacks, skipping blob-less stubs, and files them under their book', async () => {
    const db = getDb();
    await db.sentenceAudio.bulkPut([clip('have'), clip('lack'), clip('stub', 0)]);
    await db.bookSentences.put({
      id: 'bs1',
      bookId: 'bookX',
      sentenceId: 's-lack',
      addedAt: '2026-01-01T00:00:00Z',
    } as never);
    mocks.client = fakeClient(() => ({ data: [{ id: 'have' }], error: null }));

    expect(await pushMissingReferenceAudio()).toEqual({ uploaded: 1, failed: 0 });
    expect(mocks.putAudioObject).toHaveBeenCalledTimes(1);
    expect(mocks.putAudioObject.mock.calls[0]![1]).toBe('u1/bookX/lack.opus');
  });

  it('keeps going after one clip fails, reporting the failure instead of stranding the rest', async () => {
    await getDb().sentenceAudio.bulkPut([clip('one'), clip('two'), clip('three')]);
    mocks.putAudioObject.mockImplementation(async (_c: unknown, path: string) => {
      if (path.includes('/two.')) throw new Error('transient');
    });

    expect(await pushMissingReferenceAudio()).toEqual({ uploaded: 2, failed: 1 });
    expect(mocks.putAudioObject).toHaveBeenCalledTimes(3);
  });

  it('uploads nothing when the cloud listing fails (cannot tell what is missing)', async () => {
    await getDb().sentenceAudio.put(clip('x'));
    mocks.client = fakeClient(() => ({ data: null, error: { message: 'boom' } }));
    expect(await pushMissingReferenceAudio()).toEqual({ uploaded: 0, failed: 0 });
    expect(mocks.putAudioObject).not.toHaveBeenCalled();
  });

  it('does nothing when signed out or when audio sync is off', async () => {
    await getDb().sentenceAudio.put(clip('x'));
    mocks.client = fakeClient(() => ({ data: [], error: null }), null);
    expect(await pushMissingReferenceAudio()).toEqual({ uploaded: 0, failed: 0 });

    mocks.client = fakeClient(() => ({ data: [], error: null }));
    await updateSyncMeta({ syncReferenceAudio: false });
    expect(await pushMissingReferenceAudio()).toEqual({ uploaded: 0, failed: 0 });
    expect(mocks.putAudioObject).not.toHaveBeenCalled();
  });
});

describe('hydrateMissingReferenceAudio', () => {
  const stub = (id: string) => ({ ...clip(id), blob: new Blob([], { type: 'audio/ogg' }) });
  const cloudInfo = (ids: string[]) =>
    fakeClient(() => ({
      data: ids.map((id) => ({ id, storage_path: `u1/b/${id}.opus`, mime_type: 'audio/opus' })),
      error: null,
    }));

  it('downloads blobs for metadata-only rows and keeps the cloud MIME type', async () => {
    await getDb().sentenceAudio.bulkPut([stub('m1'), stub('m2'), clip('whole')]);
    mocks.client = cloudInfo(['m1', 'm2']);
    mocks.getAudioObject.mockResolvedValue({ blob: blobOf(7) });

    expect(await hydrateMissingReferenceAudio()).toBe(2);
    const m1 = await getDb().sentenceAudio.get('m1');
    expect(m1?.blob.size).toBe(7);
    expect(m1?.mimeType).toBe('audio/opus');
    expect(mocks.getAudioObject).toHaveBeenCalledTimes(2);
  });

  it('leaves a row whose download failed blank so the next cycle retries it', async () => {
    await getDb().sentenceAudio.bulkPut([stub('ok'), stub('bad')]);
    mocks.client = cloudInfo(['ok', 'bad']);
    mocks.getAudioObject.mockImplementation(async (_c: unknown, path: string) =>
      path.includes('bad') ? { blob: null, error: 'gone' } : { blob: blobOf(4) },
    );

    expect(await hydrateMissingReferenceAudio()).toBe(1);
    expect((await getDb().sentenceAudio.get('bad'))?.blob.size).toBe(0);

    mocks.getAudioObject.mockResolvedValue({ blob: blobOf(4) });
    expect(await hydrateMissingReferenceAudio()).toBe(1);
    expect((await getDb().sentenceAudio.get('bad'))?.blob.size).toBe(4);
  });

  it('skips downloads on cellular when Wi-Fi-only is set, and downloads on Wi-Fi', async () => {
    await updateSyncMeta({ wifiOnlyAudioDownload: true });
    await getDb().sentenceAudio.put(stub('w1'));
    mocks.client = cloudInfo(['w1']);
    mocks.getAudioObject.mockResolvedValue({ blob: blobOf(2) });

    vi.stubGlobal('navigator', { ...navigator, connection: { type: 'cellular' } });
    expect(await hydrateMissingReferenceAudio()).toBe(0);
    expect(mocks.getAudioObject).not.toHaveBeenCalled();

    vi.stubGlobal('navigator', { ...navigator, connection: { type: 'wifi' } });
    expect(await hydrateMissingReferenceAudio()).toBe(1);
  });

  it('treats data-saver as metered for Wi-Fi-only downloads', async () => {
    await updateSyncMeta({ wifiOnlyAudioDownload: true });
    await getDb().sentenceAudio.put(stub('w2'));
    mocks.client = cloudInfo(['w2']);
    vi.stubGlobal('navigator', { ...navigator, connection: { type: 'wifi', saveData: true } });

    expect(await hydrateMissingReferenceAudio()).toBe(0);
    expect(mocks.getAudioObject).not.toHaveBeenCalled();
  });

  it('gives up on a stalled download after the timeout instead of wedging the pass', async () => {
    await getDb().sentenceAudio.put(stub('slow'));
    mocks.client = cloudInfo(['slow']);
    mocks.getAudioObject.mockReturnValue(new Promise(() => {}));
    // Fire only the 30s download timeout immediately; fake-indexeddb needs real timers.
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) =>
      realSetTimeout(fn, ms === 30_000 ? 0 : ms, ...rest)) as typeof setTimeout);

    expect(await hydrateMissingReferenceAudio()).toBe(0);
    expect((await getDb().sentenceAudio.get('slow'))?.blob.size).toBe(0);
  });

  it('shares one pass between overlapping callers', async () => {
    await getDb().sentenceAudio.put(stub('s1'));
    mocks.client = cloudInfo(['s1']);
    mocks.getAudioObject.mockResolvedValue({ blob: blobOf(1) });

    const [a, b] = await Promise.all([hydrateMissingReferenceAudio(), hydrateMissingReferenceAudio()]);
    expect([a, b]).toEqual([1, 1]);
    expect(mocks.getAudioObject).toHaveBeenCalledTimes(1);
  });

  it('downloads nothing when the metadata lookup errors', async () => {
    await getDb().sentenceAudio.put(stub('e1'));
    mocks.client = fakeClient(() => ({ data: null, error: { message: 'rls' } }));
    expect(await hydrateMissingReferenceAudio()).toBe(0);
    expect(mocks.getAudioObject).not.toHaveBeenCalled();
  });
});

describe('downloadReferenceAudio and repairSentenceAudio', () => {
  it('serves a cached local blob without touching storage', async () => {
    await getDb().sentenceAudio.put(clip('c1', 5));
    const blob = await downloadReferenceAudio('c1', 'u1/b/c1.opus');
    expect(blob?.size).toBe(5);
    expect(mocks.getAudioObject).not.toHaveBeenCalled();
  });

  it('fetches from storage when there is no usable local blob', async () => {
    mocks.getAudioObject.mockResolvedValue({ blob: blobOf(9) });
    expect((await downloadReferenceAudio('missing', 'u1/b/missing.opus'))?.size).toBe(9);
  });

  it('repair overwrites a corrupt local blob with the cloud copy', async () => {
    await getDb().sentenceAudio.put(clip('r1', 2));
    mocks.client = fakeClient(() => ({ data: { storage_path: 'u1/b/r1.opus', mime_type: 'audio/opus' }, error: null }));
    mocks.getAudioObject.mockResolvedValue({ blob: blobOf(8) });

    expect((await repairSentenceAudio('r1'))?.size).toBe(8);
    const row = await getDb().sentenceAudio.get('r1');
    expect(row?.blob.size).toBe(8);
    expect(row?.mimeType).toBe('audio/opus');
  });

  it('repair leaves the local blob alone when there is no cloud copy or the download fails', async () => {
    await getDb().sentenceAudio.put(clip('r2', 2));
    mocks.client = fakeClient(() => ({ data: null, error: null }));
    expect(await repairSentenceAudio('r2')).toBeNull();

    mocks.client = fakeClient(() => ({ data: { storage_path: 'u1/b/r2.opus' }, error: null }));
    mocks.getAudioObject.mockResolvedValue({ blob: null, error: 'offline' });
    expect(await repairSentenceAudio('r2')).toBeNull();
    expect((await getDb().sentenceAudio.get('r2'))?.blob.size).toBe(2);
  });
});

describe('clearDownloadedAudioCache', () => {
  it('empties the local table and reports how many clips were dropped', async () => {
    await getDb().sentenceAudio.bulkPut([clip('z1'), clip('z2')]);
    expect(await clearDownloadedAudioCache()).toBe(2);
    expect(await getDb().sentenceAudio.count()).toBe(0);
  });
});
