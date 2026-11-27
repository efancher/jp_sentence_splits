import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  miningDiagnosticsSnapshot,
  miningFetch,
  recordMiningEvent,
  resetMiningDiagnosticsForTests,
} from '../src/lib/miningDiagnostics';
import { createResumeTracker } from '../src/lib/useMiningReportContext';

const BASE = 'https://box.example.ts.net/youtube-mining';

describe('mining connection diagnostics', () => {
  beforeEach(() => resetMiningDiagnosticsForTests());
  afterEach(() => vi.unstubAllGlobals());

  it('records successful, HTTP-error and failed requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response('{}', { status: 200 }))
        .mockResolvedValueOnce(new Response('nope', { status: 404 }))
        .mockRejectedValueOnce(new TypeError('Load failed')),
    );

    await miningFetch(`${BASE}/jobs/a?x=1`);
    await miningFetch(`${BASE}/jobs/b`, { method: 'post' });
    await expect(miningFetch(`${BASE}/jobs/c`)).rejects.toThrow('Load failed');

    const snap = miningDiagnosticsSnapshot();
    const reqs = snap.recentRequests as Array<Record<string, unknown>>;
    expect(reqs.map((r) => r.outcome)).toEqual(['ok', 'http_error', 'network_error']);
    expect(reqs[0].url).toBe(`${BASE}/jobs/a`);
    expect(reqs[1]).toMatchObject({ method: 'POST', status: 404 });
    expect(reqs[2].error).toBe('TypeError: Load failed');
    expect(snap.totals).toEqual({ total: 3, ok: 2, failed: 1 });
    expect(snap.consecutiveFailures).toBe(1);
  });

  it('labels an aborted request as a timeout', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
    await expect(miningFetch(`${BASE}/health`, { signal: controller.signal })).rejects.toThrow();
    const reqs = miningDiagnosticsSnapshot().recentRequests as Array<Record<string, unknown>>;
    expect(reqs[0].outcome).toBe('timeout');
  });

  it('keeps only the most recent entries', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    for (let i = 0; i < 50; i += 1) await miningFetch(`${BASE}/jobs/${i}`);
    for (let i = 0; i < 40; i += 1) recordMiningEvent(`e${i}`);
    const snap = miningDiagnosticsSnapshot();
    const reqs = snap.recentRequests as Array<Record<string, unknown>>;
    expect(reqs).toHaveLength(40);
    expect(reqs[39].url).toBe(`${BASE}/jobs/49`);
    expect((snap.recentEvents as unknown[]).length).toBe(30);
    expect(snap.totals).toMatchObject({ total: 50 });
  });

  it('resume tracker probes health once, on the first failure', () => {
    const probe = vi.fn(async () => true);
    const tracker = createResumeTracker(probe);
    tracker.noteAttempt();
    expect(probe).not.toHaveBeenCalled();
    tracker.noteFailure();
    tracker.noteAttempt();
    tracker.noteFailure();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(tracker.snapshot()).toMatchObject({ attempts: 2, failures: 2 });
  });
});
