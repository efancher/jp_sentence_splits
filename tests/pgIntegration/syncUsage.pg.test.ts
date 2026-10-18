import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, resetDbForTests } from '../../src/db/database';
import { runSyncCycle } from '../../src/sync/engine';
import { enqueueMutation, readSyncMeta, updateSyncMeta } from '../../src/sync/queue';
import { checkUsageBudget } from '../helpers/usageBudget';
import { PG_TESTS_ENABLED, pgClientFor, resetDatabase, sql, USER_A } from './harness';

const current = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../../src/sync/supabaseClient', () => ({ getSupabase: () => current.client }));

describe.skipIf(!PG_TESTS_ENABLED)('sync HTTP budgets against real Postgres and RLS', () => {
  beforeEach(async () => {
    resetDatabase();
    resetDbForTests();
    await updateSyncMeta({ userId: USER_A, syncReferenceAudio: false });
  });

  it('bounds first pull, unchanged sync, one edit and a reconnect backlog', async () => {
    const pg = pgClientFor(USER_A);
    current.client = pg.client;
    sql(`insert into books (id, owner_id, title) select 'b-' || n, '${USER_A}', 'Synthetic book ' || n from generate_series(1,120) n`);
    await runSyncCycle();
    expect((await readSyncMeta())?.lastError).toBeUndefined();
    expect(await getDb().books.count()).toBe(120);
    checkUsageBudget('sync-first-pull-120-books', pg.usage());

    pg.resetUsage();
    await runSyncCycle();
    expect(pg.usage()).toEqual({ requests: 1, requestBodyBytes: 0, responseBodyBytes: 2 });
    checkUsageBudget('sync-unchanged', pg.usage());

    sql("update books set title = 'Edited on another device' where id = 'b-1'");
    pg.resetUsage();
    await runSyncCycle();
    expect((await getDb().books.get('b-1'))?.title).toBe('Edited on another device');
    checkUsageBudget('sync-one-remote-edit', pg.usage());

    // Changes accumulate while this device does not run sync, then reconnects.
    sql("update books set title = 'After reconnect ' || id");
    pg.resetUsage();
    await runSyncCycle();
    expect((await getDb().books.toArray()).every((book) => book.title.startsWith('After reconnect'))).toBe(true);
    checkUsageBudget('sync-reconnect-120-books', pg.usage());
  });

  it('batches an import and sends no repeated payload once acknowledged', async () => {
    const pg = pgClientFor(USER_A);
    current.client = pg.client;
    for (let i = 0; i < 120; i++) {
      const book = { id: `import-${i}`, title: `Synthetic book ${i}`, chapters: [], collapsedChapterIds: [], archived: false,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
      await getDb().books.put(book);
      await enqueueMutation({ entity: 'books', recordId: book.id, operation: 'upsert', expectedVersion: null, payload: book });
    }
    await runSyncCycle();
    expect((await readSyncMeta())?.lastError).toBeUndefined();
    expect(await getDb().syncQueue.count()).toBe(0);
    checkUsageBudget('sync-import-120-books', pg.usage());
    pg.resetUsage();
    await runSyncCycle();
    expect(pg.usage()).toEqual({ requests: 1, requestBodyBytes: 0, responseBodyBytes: 2 });
  });
});
