import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb, resetDbForTests } from '../src/db/database';
import { ensureGrammarPattern } from '../src/db/repository';
import { createId } from '../src/lib/ids';
import { enqueueMutation, ensureSyncMeta, readSyncMeta, updateSyncMeta } from '../src/sync/queue';

/**
 * runSyncCycle against a scripted PostgREST stand-in: how a cycle behaves when
 * the session is gone, the token has expired, the network drops mid-push or
 * mid-pull, and when the same device asks for two cycles at once. In each case
 * local study data must survive and the next healthy cycle must recover.
 */

type Row = Record<string, any>;

const env = vi.hoisted(() => {
  const state = {
    configured: true,
    signedIn: true,
    /** Message every table request fails with while set (simulates expiry / offline). */
    failWith: null as string | null,
    tables: {} as Record<string, Row[]>,
    requests: [] as string[],
    syncEventQueries: 0,
  };
  const rows = (table: string): Row[] => (state.tables[table] ??= []);

  function from(table: string) {
    state.requests.push(table);
    const filters: [string, string, unknown][] = [];
    let limit = Infinity;
    const matching = () =>
      rows(table)
        .filter((r) =>
          filters.every(([op, c, v]) =>
            op === 'eq' ? r[c] === v : op === 'gt' ? Number(r[c]) > Number(v) : (v as unknown[]).includes(r[c]),
          ),
        )
        .slice(0, limit);
    const failure = () => (state.failWith ? { message: state.failWith } : null);
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push(['eq', c, v]), q),
      gt: (c: string, v: unknown) => (filters.push(['gt', c, v]), q),
      in: (c: string, v: unknown[]) => (filters.push(['in', c, v]), q),
      order: () => q,
      limit: (n: number) => ((limit = n), q),
      maybeSingle: async () => ({ data: failure() ? null : (matching()[0] ?? null), error: failure() }),
      insert: async (row: Row | Row[]) => {
        if (failure()) return { error: failure() };
        for (const r of Array.isArray(row) ? row : [row]) rows(table).push({ ...r });
        return { error: null };
      },
      update: () => q,
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        if (table === 'sync_events') state.syncEventQueries += 1;
        return Promise.resolve({ data: failure() ? null : matching(), error: failure() }).then(resolve, reject);
      },
    };
    return q;
  }
  const client = {
    auth: {
      getSession: async () => ({ data: { session: state.signedIn ? { user: { id: 'user-1' } } : null } }),
    },
    from,
  };
  return { state, rows, client };
});

vi.mock('../src/sync/supabaseClient', () => ({ getSupabase: () => (env.state.configured ? env.client : null) }));

import { pushMutations, runSyncCycle } from '../src/sync/engine';

async function queuePattern(name: string) {
  const pattern = await ensureGrammarPattern(name, {});
  await enqueueMutation({
    entity: 'grammar_patterns',
    recordId: pattern.id,
    operation: 'upsert',
    expectedVersion: null,
    payload: pattern,
  });
  return pattern;
}

/** A non-fresh device whose pull cursor is already past the start of the log. */
async function settledDevice() {
  await ensureSyncMeta();
  await updateSyncMeta({ lastPullEventId: 10 });
}

beforeEach(async () => {
  resetDbForTests(`sync-engine-${createId('db')}`);
  env.state.configured = true;
  env.state.signedIn = true;
  env.state.failWith = null;
  env.state.requests.length = 0;
  env.state.syncEventQueries = 0;
  for (const k of Object.keys(env.state.tables)) delete env.state.tables[k];
  await settledDevice();
});

describe('runSyncCycle without a usable session', () => {
  it('does nothing and reports no error when sync is not configured', async () => {
    env.state.configured = false;
    await queuePattern('～てから');
    await runSyncCycle();
    expect(env.state.requests).toEqual([]);
    expect(await getDb().syncQueue.count()).toBe(1);
    expect((await readSyncMeta()).lastError).toBeUndefined();
  });

  it('leaves the queue untouched while signed out, then pushes after sign-in', async () => {
    env.state.signedIn = false;
    const pattern = await queuePattern('～てから');
    await runSyncCycle();
    expect(env.state.requests).toEqual([]);
    expect(await getDb().syncQueue.count()).toBe(1);

    env.state.signedIn = true;
    await runSyncCycle();
    expect(await getDb().syncQueue.count()).toBe(0);
    expect(env.rows('grammar_patterns').map((r) => r.id)).toEqual([pattern.id]);
  });
});

describe('token expiry', () => {
  it('keeps the queued edit and local row, surfaces the error, and recovers once refreshed', async () => {
    const pattern = await queuePattern('～ながら');
    env.state.failWith = 'JWT expired';

    await runSyncCycle();
    const queued = await getDb().syncQueue.toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.retryCount).toBe(1);
    expect(queued[0]!.lastError).toContain('JWT expired');
    expect((await readSyncMeta()).lastError).toContain('JWT expired');
    expect(await getDb().grammarPatterns.get(pattern.id)).toBeTruthy();

    env.state.failWith = null; // the client refreshed its token
    await runSyncCycle();
    expect(await getDb().syncQueue.count()).toBe(0);
    expect((await readSyncMeta()).lastError).toBeUndefined();
    expect(env.rows('grammar_patterns')).toHaveLength(1);
  });

  it('fails the cycle (not the app) when the pull is rejected, and keeps the cursor', async () => {
    await runSyncCycle(); // healthy: nothing queued, empty log
    env.state.failWith = 'JWT expired';
    await runSyncCycle();
    const meta = await readSyncMeta();
    expect(meta.lastError).toContain('JWT expired');
    expect(meta.lastPullEventId).toBe(10);

    env.state.failWith = null;
    await runSyncCycle();
    expect((await readSyncMeta()).lastError).toBeUndefined();
  });
});

describe('offline and reconnect', () => {
  it('makes one bulk request, not one timeout per row, and keeps every row queued', async () => {
    for (const name of ['～たら', '～ば', '～と']) await queuePattern(name);
    env.state.failWith = 'Failed to fetch';

    const failure = await pushMutations();
    expect(failure).toContain('Failed to fetch');
    // the three same-entity rows go out as one bulk probe, not three timeouts
    expect(env.state.requests.filter((t) => t === 'grammar_patterns')).toHaveLength(1);
    const queued = await getDb().syncQueue.toArray();
    expect(queued).toHaveLength(3);
    expect(queued.every((q) => q.retryCount === 1 && q.lastError?.includes('Failed to fetch'))).toBe(true);
  });

  it('drains everything queued while offline on the next cycle after reconnect', async () => {
    const names = ['～たら', '～ば', '～と'];
    for (const name of names) await queuePattern(name);
    env.state.failWith = 'Failed to fetch';
    await runSyncCycle();
    expect((await readSyncMeta()).lastError).toContain('Failed to fetch');

    env.state.failWith = null;
    await runSyncCycle();
    expect(await getDb().syncQueue.count()).toBe(0);
    expect(env.rows('grammar_patterns')).toHaveLength(names.length);
    expect((await readSyncMeta()).lastError).toBeUndefined();
    expect((await readSyncMeta()).lastSyncAt).toBeTruthy();
  });

  it('summarises several non-transport failures as "first (+N more)" and keeps trying the rest', async () => {
    for (const name of ['～たら', '～ば', '～と']) await queuePattern(name);
    env.state.failWith = 'permission denied for table grammar_patterns';
    const failure = await pushMutations();
    expect(failure).toMatch(/^grammar_patterns: permission denied.* \(\+2 more\)$/);
    expect(env.state.requests.filter((t) => t === 'grammar_patterns').length).toBeGreaterThanOrEqual(3);
  });
});

describe('pull recovery', () => {
  it('drops a deferred event id the cloud can no longer show, rather than retrying it forever', async () => {
    await updateSyncMeta({ deferredPullEventIds: [3, 4] });
    await runSyncCycle();
    expect((await readSyncMeta()).deferredPullEventIds ?? []).toEqual([]);
  });

  it('keeps deferred ids across a failed pull so the retry is not lost', async () => {
    await updateSyncMeta({ deferredPullEventIds: [3] });
    env.state.failWith = 'Failed to fetch';
    await runSyncCycle();
    expect((await readSyncMeta()).deferredPullEventIds).toEqual([3]);
  });

  it('throttles the pull for save-triggered cycles but not for explicit ones', async () => {
    await runSyncCycle(); // explicit: pulls and stamps the throttle clock
    const afterFirst = env.state.syncEventQueries;
    expect(afterFirst).toBeGreaterThan(0);
    await runSyncCycle({ throttlePull: true });
    expect(env.state.syncEventQueries).toBe(afterFirst);
    await runSyncCycle();
    expect(env.state.syncEventQueries).toBeGreaterThan(afterFirst);
  });
});

describe('concurrent cycles on one device', () => {
  it('shares a single in-flight cycle so rows are not pushed twice', async () => {
    await queuePattern('～ても');
    await Promise.all([runSyncCycle(), runSyncCycle(), runSyncCycle()]);
    expect(env.rows('grammar_patterns')).toHaveLength(1);
    expect(await getDb().syncQueue.count()).toBe(0);
  });
});
