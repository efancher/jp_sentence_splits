import { describe, expect, it } from 'vitest';

import {
  buildReport, classifyAction, fetchAnalytics, MAX_ROWS, toMarkdown, windows,
  type Analytics, type OperationRow, type StorageRow,
} from '../scripts/lib/r2Usage';

const NOW = new Date('2026-10-20T12:00:00Z');
const START = '2026-10-01T00:00:00.000Z';
const storage = (datetime: string, payload: number, extra: Partial<StorageRow> = {}): StorageRow =>
  ({ datetime, payloadSize: payload, metadataSize: 0, objectCount: 10, uploadCount: 0, ...extra });
const ops = (...rows: Array<[string, number, string?]>): OperationRow[] =>
  rows.map(([actionType, requests, bucketName]) => ({ actionType, requests, bucketName: bucketName ?? 'b' }));
const analytics = (over: Partial<Analytics> = {}): Analytics => ({
  operations: ops(['PutObject', 2800], ['GetObject', 5700], ['DeleteObject', 50]),
  operationsTruncated: false,
  storage: [storage('2026-10-20T00:00:00Z', 700_000_000)],
  storageTruncated: false,
  ...over,
});
const report = (a: Analytics, extra: object = {}) => buildReport({ analytics: a, bucket: 'b', periodStart: START, now: NOW, ...extra });

describe('operation classes', () => {
  it('follows the published Class A, Class B and free lists', () => {
    expect(classifyAction('PutObject')).toBe('A');
    expect(classifyAction('ListObjects')).toBe('A');
    expect(classifyAction('GetObject')).toBe('B');
    expect(classifyAction('HeadObject')).toBe('B');
    expect(classifyAction('DeleteObject')).toBe('free');
    expect(classifyAction('SomethingNew')).toBe('unclassified');
  });
});

describe('R2 usage report', () => {
  it('sums Class A and B, ignores free operations and reports healthy usage as ok', () => {
    const r = report(analytics());
    expect(r.metrics.map((m) => [m.used, m.status])).toEqual([[700_000_000, 'ok'], [2800, 'ok'], [5700, 'ok']]);
    expect(r.status).toBe('ok');
    expect(r.bucketOperations.b).toEqual({ classA: 2800, classB: 5700 });
  });

  it('counts every bucket in the account, since the allowance is shared', () => {
    const r = report(analytics({ operations: ops(['PutObject', 600_000, 'a'], ['PutObject', 500_000, 'other']) }));
    expect(r.metrics[1]).toMatchObject({ used: 1_100_000, status: 'exceeded' });
    expect(r.status).toBe('exceeded');
  });

  it('warns above the engineering thresholds and flags exceeded above the allowance', () => {
    expect(report(analytics({ storage: [storage('2026-10-20T00:00:00Z', 8_500_000_000)] })).metrics[0].status).toBe('warning');
    expect(report(analytics({ storage: [storage('2026-10-20T00:00:00Z', 10_500_000_000)] })).metrics[0].status).toBe('exceeded');
    expect(report(analytics({ operations: ops(['GetObject', 5_500_000]) })).metrics[2].status).toBe('warning');
  });

  it('never reports missing or truncated data as zero usage', () => {
    const empty = report(analytics({ storage: [] }));
    expect(empty.metrics[0]).toMatchObject({ used: null, status: 'unknown' });
    expect(empty.status).toBe('unknown');
    const truncatedOps = report(analytics({ operationsTruncated: true }));
    expect(truncatedOps.metrics[1]).toMatchObject({ used: null, status: 'unknown' });
    expect(truncatedOps.warnings.join()).toMatch(/row limit/);
    const truncatedStorage = report(analytics({ storageTruncated: true }));
    expect(truncatedStorage.metrics[0].used).toBeNull();
  });

  it('treats a stale storage sample as unknown rather than current', () => {
    const r = report(analytics({ storage: [storage('2026-10-10T00:00:00Z', 1_000)] }));
    expect(r.metrics[0].status).toBe('unknown');
    expect(r.warnings.join()).toMatch(/older than 48 hours/);
  });

  it('averages daily storage peaks, which is what R2 bills on', () => {
    const r = report(analytics({
      storage: [
        storage('2026-10-18T01:00:00Z', 100), storage('2026-10-18T23:00:00Z', 300),
        storage('2026-10-19T12:00:00Z', 500), storage('2026-10-20T00:00:00Z', 700),
      ],
    }));
    expect(r.storage.dailyPeakAverageBytes).toBe((300 + 500 + 700) / 3);
    expect(r.storage.payloadBytes).toBe(700);
  });

  it('lists unclassified operations instead of silently dropping them', () => {
    const r = report(analytics({ operations: ops(['PutObject', 1], ['BrandNewOp', 9]) }));
    expect(r.unclassifiedOperations).toEqual({ BrandNewOp: 9 });
    expect(r.metrics[1].used).toBe(1);
    expect(r.warnings.join()).toMatch(/BrandNewOp/);
  });

  it('flags a gateway ledger that disagrees with analytics', () => {
    const ledger = { storageBytes: 100_000_000, classA: 0, classB: 0, seeded: true };
    expect(report(analytics(), { ledger }).warnings.join()).toMatch(/outside the gateway/);
    const agree = { ...ledger, storageBytes: 700_000_000 };
    expect(report(analytics(), { ledger: agree }).warnings).toEqual([]);
  });

  it('renders Markdown that shows unknown values as unknown', () => {
    const md = toMarkdown(report(analytics({ storage: [] })));
    expect(md).toContain('Status: **UNKNOWN**');
    expect(md).toContain('| Storage (latest, payload + metadata) | unknown |');
  });
});

describe('R2 analytics fetching', () => {
  const okBody = (opsRows: unknown[], storageRows: unknown[], which: 'ops' | 'storage') => ({
    data: { viewer: { accounts: [which === 'ops' ? { r2OperationsAdaptiveGroups: opsRows } : { r2StorageAdaptiveGroups: storageRows }] } },
  });

  function fakeFetch(handlers: { ops?: unknown[]; storage?: unknown[]; status?: number; errors?: unknown[]; noAccount?: boolean }) {
    const requests: Array<{ auth: string; variables: Record<string, unknown> }> = [];
    const fn = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
      requests.push({ auth: new Headers(init.headers).get('Authorization') ?? '', variables: body.variables });
      if (handlers.status) return new Response('{}', { status: handlers.status });
      if (handlers.errors) return Response.json({ errors: handlers.errors });
      if (handlers.noAccount) return Response.json({ data: { viewer: { accounts: [] } } });
      return Response.json(body.query.includes('r2Operations') ? okBody(handlers.ops ?? [], [], 'ops') : okBody([], handlers.storage ?? [], 'storage'));
    }) as unknown as typeof fetch;
    return { fn, requests };
  }
  const base = { token: 'tok', accountId: 'acc', bucket: 'b', start: new Date('2026-10-01T00:00:00Z'), end: NOW };

  it('maps operations and storage rows and sends the bearer token', async () => {
    const { fn, requests } = fakeFetch({
      ops: [{ sum: { requests: 7 }, dimensions: { actionType: 'PutObject', bucketName: 'b' } }],
      storage: [{ max: { objectCount: 3, uploadCount: 1, payloadSize: 900, metadataSize: 20 }, dimensions: { datetime: '2026-10-20T00:00:00Z' } }],
    });
    const a = await fetchAnalytics({ ...base, fetch: fn });
    expect(a.operations).toEqual([{ actionType: 'PutObject', bucketName: 'b', requests: 7 }]);
    expect(a.storage[0]).toMatchObject({ payloadSize: 900, metadataSize: 20, objectCount: 3, uploadCount: 1 });
    expect(requests[0].auth).toBe('Bearer tok');
    expect(requests[0].variables).toMatchObject({ accountTag: 'acc' });
  });

  it('marks results that reach the row limit as truncated', async () => {
    const rows = Array.from({ length: MAX_ROWS }, () => ({ sum: { requests: 1 }, dimensions: { actionType: 'GetObject' } }));
    const a = await fetchAnalytics({ ...base, fetch: fakeFetch({ ops: rows }).fn });
    expect(a.operationsTruncated).toBe(true);
  });

  it('splits periods longer than the 31-day API maximum', async () => {
    const start = new Date('2026-08-01T00:00:00Z');
    const w = windows(start, NOW);
    expect(w.length).toBeGreaterThan(1);
    expect(w.every(([s, e]) => e.getTime() - s.getTime() <= 31 * 86_400_000)).toBe(true);
    const { requests, fn } = fakeFetch({});
    await fetchAnalytics({ ...base, start, fetch: fn });
    expect(requests.length).toBe(w.length * 2);
  });

  it('fails loudly, without echoing the token, on HTTP errors, GraphQL errors and a missing account', async () => {
    await expect(fetchAnalytics({ ...base, fetch: fakeFetch({ status: 403 }).fn })).rejects.toThrow('(403)');
    await expect(fetchAnalytics({ ...base, fetch: fakeFetch({ errors: [{ message: 'not authorized' }] }).fn })).rejects.toThrow('not authorized');
    await expect(fetchAnalytics({ ...base, fetch: fakeFetch({ noAccount: true }).fn })).rejects.toThrow(/no account/);
    for (const handler of [{ status: 403 }, { errors: [{ message: 'x' }] }]) {
      await fetchAnalytics({ ...base, fetch: fakeFetch(handler).fn }).catch((e: Error) => expect(e.message).not.toContain('tok'));
    }
  });
});
