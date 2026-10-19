import { describe, expect, it } from 'vitest';

import { classify, migrateClips, type ClipRow, type HeadResult, type MigrationDeps, type PutResult } from '../scripts/lib/r2Migration';

const OWNER = '11111111-1111-1111-1111-111111111111';
const path = (id: string, ext = 'm4a') => `${OWNER}/book_1/${id}.${ext}`;
const row = (id: string, bytes = 100, over: Partial<ClipRow> = {}): ClipRow => ({
  id, storagePath: path(id), sizeBytes: bytes, mimeType: 'audio/mp4', ...over,
});

function fakeDeps(opts: {
  supabase?: Record<string, Uint8Array>;
  r2?: Map<string, Uint8Array>;
  putResult?: (key: string, attempt: number) => PutResult;
  corruptOnStore?: boolean;
  headRefuse?: number;
} = {}) {
  const r2 = opts.r2 ?? new Map<string, Uint8Array>();
  const supabase = opts.supabase ?? {};
  const calls = { head: 0, download: 0, put: 0, get: 0 };
  const attempts = new Map<string, number>();
  const deps: MigrationDeps = {
    async head(key): Promise<HeadResult> {
      calls.head += 1;
      if (opts.headRefuse) return { status: 'refused', code: opts.headRefuse };
      const o = r2.get(key);
      return o ? { status: 'present', size: o.length } : { status: 'absent' };
    },
    async download(storagePath) {
      calls.download += 1;
      return supabase[storagePath] ?? null;
    },
    async put(key, bytes) {
      calls.put += 1;
      const n = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, n);
      const result = opts.putResult?.(key, n) ?? { ok: true as const };
      if (result.ok) r2.set(key, opts.corruptOnStore ? bytes.map((b) => b ^ 1) : bytes);
      return result;
    },
    async get(key) {
      calls.get += 1;
      return r2.get(key) ?? null;
    },
  };
  return { deps, r2, calls };
}

const bytesOf = (n: number, seed = 7) => Uint8Array.from({ length: n }, (_, i) => (i * seed) % 256);
const base = { ownerId: OWNER, concurrency: 2, readback: true };

describe('R2 migration classification', () => {
  it('skips rows that cannot or must not be copied', () => {
    expect(classify({ id: 'a', storagePath: null, sizeBytes: 1, mimeType: 'audio/mp4' }, OWNER)).toBe('skipped_no_path');
    expect(classify(row('a', 1, { storagePath: 'nonsense' }), OWNER)).toBe('skipped_bad_path');
    expect(classify(row('a', 1, { storagePath: `22222222-2222-2222-2222-222222222222/b/a.m4a` }), OWNER)).toBe('skipped_foreign_owner');
    expect(classify(row('a', 1, { mimeType: 'text/plain' }), OWNER)).toBe('skipped_mime');
    expect(classify(row('a'), OWNER)).toEqual({ key: path('a'), mime: 'audio/mp4' });
  });
});

describe('R2 migration run', () => {
  it('dry run reports what would be copied and writes nothing', async () => {
    const { deps, calls, r2 } = fakeDeps({ r2: new Map([[path('done'), bytesOf(50)]]) });
    const report = await migrateClips([row('a', 100), row('b', 200), row('done', 50)], deps, { ...base, apply: false });
    expect(report.counts).toEqual({ would_copy: 2, already_present: 1 });
    expect(report.bytesToCopy).toBe(300);
    expect(calls.put + calls.download).toBe(0);
    expect(r2.size).toBe(1);
  });

  it('copies, verifies size and content, and counts bytes', async () => {
    const data = { [path('a')]: bytesOf(100), [path('b')]: bytesOf(200, 11) };
    const { deps, r2 } = fakeDeps({ supabase: data });
    const report = await migrateClips([row('a', 100), row('b', 200)], deps, { ...base, apply: true });
    expect(report.counts).toEqual({ copied: 2 });
    expect(report.bytesCopied).toBe(300);
    expect(r2.get(path('b'))).toEqual(data[path('b')]);
  });

  it('is idempotent: a second run copies nothing', async () => {
    const data = { [path('a')]: bytesOf(100) };
    const first = fakeDeps({ supabase: data });
    await migrateClips([row('a', 100)], first.deps, { ...base, apply: true });
    const second = fakeDeps({ supabase: data, r2: first.r2 });
    const report = await migrateClips([row('a', 100)], second.deps, { ...base, apply: true });
    expect(report.counts).toEqual({ already_present: 1 });
    expect(second.calls.put).toBe(0);
  });

  it('never overwrites an R2 object whose size differs from the Supabase copy', async () => {
    const newer = bytesOf(150, 3);
    const { deps, r2, calls } = fakeDeps({ supabase: { [path('a')]: bytesOf(100) }, r2: new Map([[path('a'), newer]]) });
    const report = await migrateClips([row('a', 100)], deps, { ...base, apply: true });
    expect(report.counts).toEqual({ r2_differs: 1 });
    expect(calls.put).toBe(0);
    expect(r2.get(path('a'))).toBe(newer);
  });

  it('honours --limit and defers the rest', async () => {
    const data = Object.fromEntries(['a', 'b', 'c', 'd'].map((id) => [path(id), bytesOf(10)]));
    const { deps, r2 } = fakeDeps({ supabase: data });
    const report = await migrateClips(['a', 'b', 'c', 'd'].map((id) => row(id, 10)), deps, { ...base, apply: true, limit: 2, concurrency: 1 });
    expect(report.counts).toEqual({ copied: 2, deferred: 2 });
    expect(r2.size).toBe(2);
  });

  it('flags a source whose bytes do not match the recorded size, without uploading', async () => {
    const { deps, calls } = fakeDeps({ supabase: { [path('a')]: bytesOf(90) } });
    const report = await migrateClips([row('a', 100)], deps, { ...base, apply: true });
    expect(report.counts).toEqual({ failed_size_mismatch: 1 });
    expect(calls.put).toBe(0);
  });

  it('reports a failed download and a missing source', async () => {
    const { deps } = fakeDeps();
    const report = await migrateClips([row('a', 100)], deps, { ...base, apply: true });
    expect(report.counts).toEqual({ failed_download: 1 });
  });

  it('retries a transient upload failure but not a validation failure', async () => {
    const data = { [path('a')]: bytesOf(10), [path('b')]: bytesOf(10) };
    const { deps, calls } = fakeDeps({
      supabase: data,
      putResult: (key, attempt) =>
        key === path('a')
          ? attempt < 3 ? { ok: false, status: 502, retryable: true } : { ok: true }
          : { ok: false, status: 415, retryable: false },
    });
    const report = await migrateClips([row('a', 10), row('b', 10)], deps, { ...base, apply: true, concurrency: 1 });
    expect(report.counts).toEqual({ copied: 1, failed_upload: 1 });
    expect(calls.put).toBe(4); // a: 3 attempts, b: 1
  });

  it('detects content corruption with the read-back, and size-only runs miss it by design', async () => {
    const data = { [path('a')]: bytesOf(100) };
    const checked = fakeDeps({ supabase: data, corruptOnStore: true });
    expect((await migrateClips([row('a', 100)], checked.deps, { ...base, apply: true })).counts).toEqual({ failed_verify: 1 });
    const sizeOnly = fakeDeps({ supabase: data, corruptOnStore: true });
    expect((await migrateClips([row('a', 100)], sizeOnly.deps, { ...base, apply: true, readback: false })).counts).toEqual({ copied: 1 });
  });

  it('stops the whole run when the gateway refuses an upload (quota, rate limit, auth)', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const data = Object.fromEntries(ids.map((id) => [path(id), bytesOf(10)]));
    const { deps, calls } = fakeDeps({ supabase: data, putResult: () => ({ ok: false, status: 507, retryable: false }) });
    const report = await migrateClips(ids.map((id) => row(id, 10)), deps, { ...base, apply: true, concurrency: 1 });
    expect(report.abortedReason).toContain('507');
    expect(report.counts.copied).toBeUndefined();
    expect(calls.put).toBe(1);
    expect(report.counts.aborted).toBe(5);
  });

  it('stops when the gateway refuses a check, even in a dry run', async () => {
    const { deps } = fakeDeps({ headRefuse: 401 });
    const report = await migrateClips([row('a'), row('b')], deps, { ...base, apply: false, concurrency: 1 });
    expect(report.abortedReason).toContain('401');
    expect(report.counts).toEqual({ aborted: 2 });
  });
});
