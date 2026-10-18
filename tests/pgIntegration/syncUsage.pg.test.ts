import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, resetDbForTests } from '../../src/db/database';
import { ensureVocabularyItem } from '../../src/db/repository';
import { createId } from '../../src/lib/ids';
import { pushMutations, runSyncCycle } from '../../src/sync/engine';
import { enqueueMutation, readSyncMeta, updateSyncMeta } from '../../src/sync/queue';
import { checkUsageBudget } from '../helpers/usageBudget';
import { PG_TESTS_ENABLED, pgClientFor, resetDatabase, scalar, sql, USER_A } from './harness';

const current = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('../../src/sync/supabaseClient', () => ({
  getSupabase: () => current.client,
  isSupabaseConfigured: () => true,
}));

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

  it('restores mixed entities pushed by another device, then idles and pulls one edit', async () => {
    // Device A (phone) creates words, which fan out into items, kanji and links.
    resetDbForTests(`pg-${createId('db')}`);
    await updateSyncMeta({ userId: USER_A, syncReferenceAudio: false });
    const phone = pgClientFor(USER_A);
    current.client = phone.client;
    const words = Array.from({ length: 40 }, (_, i) => `語${String.fromCodePoint(0x4e00 + i)}`);
    for (const word of words) await ensureVocabularyItem(word, 'ごご');
    let last = -1;
    for (let stable = 0; stable < 3;) { // notifySync enqueues fire-and-forget
      await new Promise((r) => setTimeout(r, 25));
      const n = await getDb().syncQueue.count();
      stable = n === last ? stable + 1 : 0;
      last = n;
    }
    expect(await pushMutations()).toBeUndefined();
    expect(Number(scalar('select (select count(*) from vocabulary_items) + (select count(*) from kanji) + (select count(*) from vocabulary_kanji)')))
      .toBe(40 + 41 + 80);

    // Device B (laptop) has never synced: full restore of all three tables.
    resetDbForTests(`pg-${createId('db')}`);
    await updateSyncMeta({ userId: USER_A, syncReferenceAudio: false });
    const laptop = pgClientFor(USER_A);
    current.client = laptop.client;
    await runSyncCycle();
    expect((await readSyncMeta())?.lastError).toBeUndefined();
    expect(await getDb().vocabularyItems.count()).toBe(40);
    checkUsageBudget('sync-restore-mixed-161-rows', laptop.usage());

    laptop.resetUsage();
    await runSyncCycle();
    expect(laptop.usage()).toEqual({ requests: 1, requestBodyBytes: 0, responseBodyBytes: 2 });

    sql("update vocabulary_items set meaning = 'edited on phone' where id = (select id from vocabulary_items limit 1)");
    laptop.resetUsage();
    await runSyncCycle();
    expect(await getDb().vocabularyItems.filter((v) => v.meaning === 'edited on phone').count()).toBe(1);
    checkUsageBudget('sync-mixed-one-remote-edit', laptop.usage());
  });
});
