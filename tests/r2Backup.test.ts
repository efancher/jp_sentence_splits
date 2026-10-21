import { describe, expect, it } from 'vitest';

import { backupClips, type BackupDeps, type FetchResult } from '../scripts/lib/r2Backup';
import type { ClipRow } from '../scripts/lib/r2Migration';

const OWNER = '11111111-1111-1111-1111-111111111111';
const path = (id: string) => `${OWNER}/book_1/${id}.m4a`;
const row = (id: string, bytes = 4, over: Partial<ClipRow> = {}): ClipRow => ({
  id, storagePath: path(id), sizeBytes: bytes, mimeType: 'audio/mp4', ...over,
});
const data = (n = 4) => new Uint8Array(n).fill(7);

function fakeDeps(opts: { r2?: Record<string, FetchResult>; local?: Map<string, Uint8Array>; failWrite?: boolean } = {}) {
  const local = opts.local ?? new Map<string, Uint8Array>();
  const r2 = opts.r2 ?? {};
  const calls = { fetch: 0, write: 0 };
  const deps: BackupDeps = {
    async localSize(key) { return local.get(key)?.length ?? null; },
    async fetchObject(key) { calls.fetch += 1; return r2[key] ?? { status: 'absent' }; },
    async writeLocal(key, bytes) {
      calls.write += 1;
      if (opts.failWrite) throw new Error('disk full');
      local.set(key, bytes);
    },
  };
  return { deps, local, calls };
}
const options = { ownerId: OWNER, apply: true, concurrency: 2 };

describe('backupClips', () => {
  it('downloads missing clips and verifies their size', async () => {
    const { deps, local } = fakeDeps({ r2: { [path('a')]: { status: 'ok', bytes: data() } } });
    const report = await backupClips([row('a')], deps, options);
    expect(report.counts).toEqual({ downloaded: 1 });
    expect(local.has(path('a'))).toBe(true);
    expect(report.bytesDownloaded).toBe(4);
  });

  it('is a dry run by default: no fetches or writes', async () => {
    const { deps, calls } = fakeDeps();
    const report = await backupClips([row('a'), row('b', 6)], deps, { ...options, apply: false });
    expect(report.counts).toEqual({ would_download: 2 });
    expect(report.bytesToDownload).toBe(10);
    expect(calls).toEqual({ fetch: 0, write: 0 });
  });

  it('skips clips already mirrored with the expected size', async () => {
    const { deps, calls } = fakeDeps({ local: new Map([[path('a'), data()]]) });
    const report = await backupClips([row('a')], deps, options);
    expect(report.counts).toEqual({ already_backed_up: 1 });
    expect(calls.fetch).toBe(0);
  });

  it('re-downloads a local file whose size disagrees with the database', async () => {
    const { deps, local } = fakeDeps({
      local: new Map([[path('a'), data(2)]]),
      r2: { [path('a')]: { status: 'ok', bytes: data() } },
    });
    const report = await backupClips([row('a')], deps, options);
    expect(report.counts).toEqual({ redownloaded: 1 });
    expect(local.get(path('a'))!.length).toBe(4);
  });

  it('keeps the old local file when R2 no longer has the object', async () => {
    const { deps, local } = fakeDeps({ local: new Map([[path('a'), data(2)]]) });
    const report = await backupClips([row('a')], deps, options);
    expect(report.counts).toEqual({ missing_in_r2: 1 });
    expect(local.get(path('a'))!.length).toBe(2);
  });

  it('rejects a download whose size does not match the row, without writing', async () => {
    const { deps, calls } = fakeDeps({ r2: { [path('a')]: { status: 'ok', bytes: data(3) } } });
    const report = await backupClips([row('a')], deps, options);
    expect(report.counts).toEqual({ failed_size_mismatch: 1 });
    expect(calls.write).toBe(0);
  });

  it('reports write failures and transient read errors separately', async () => {
    const ok = { status: 'ok', bytes: data() } as const;
    const w = await backupClips([row('a')], fakeDeps({ r2: { [path('a')]: ok }, failWrite: true }).deps, options);
    expect(w.counts).toEqual({ failed_write: 1 });
    const e = await backupClips([row('a')], fakeDeps({ r2: { [path('a')]: { status: 'error' } } }).deps, options);
    expect(e.counts).toEqual({ failed_download: 1 });
  });

  it('stops on a gateway refusal and aborts the remaining clips', async () => {
    const { deps } = fakeDeps({ r2: { [path('a')]: { status: 'refused', code: 429 } } });
    const report = await backupClips([row('a'), row('b'), row('c')], deps, { ...options, concurrency: 1 });
    expect(report.abortedReason).toMatch(/429/);
    expect(report.counts).toEqual({ aborted: 3 });
  });

  it('skips rows that are not valid clips for this owner', async () => {
    const { deps, calls } = fakeDeps();
    const report = await backupClips([
      row('a', 4, { storagePath: null }),
      row('b', 4, { storagePath: '../../etc/passwd' }),
      row('c', 4, { storagePath: `22222222-2222-2222-2222-222222222222/book_1/c.m4a` }),
      row('d', 4, { mimeType: 'text/html' }),
    ], deps, options);
    expect(report.counts).toEqual({
      skipped_no_path: 1, skipped_bad_path: 1, skipped_foreign_owner: 1, skipped_mime: 1,
    });
    expect(calls.fetch).toBe(0);
  });
});
