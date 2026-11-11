import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb, resetDbForTests } from '../db/database';
import { deleteSentencesCascade } from '../db/repository';
import { updateSyncMeta } from './queue';
import { trackLocalMutationsInTransaction } from './track';

vi.mock('./supabaseClient', () => ({
  isSupabaseConfigured: () => true,
  getSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}));

const TS = '2026-11-10T00:00:00.000Z';

function sentenceRow(id: string) {
  return {
    id,
    normalizedKey: id,
    japanese: 'テスト',
    readingOnly: '',
    inlineReading: '',
    translation: '',
    sourceReferences: [],
    importBatchIds: [],
    createdAt: TS,
    updatedAt: TS,
  } as never;
}

async function queueKeys() {
  const rows = await getDb().syncQueue.toArray();
  return rows.map((row) => `${row.entity}:${row.recordId}:${row.operation}`).sort();
}

describe('transactional sync enqueue', () => {
  beforeEach(() => {
    resetDbForTests(`txn-enqueue-${Math.random().toString(36).slice(2)}`);
  });

  it('queues the cascade ops in the same transaction as the local delete', async () => {
    await updateSyncMeta({ userId: 'user_1' });
    const db = getDb();
    await db.sentences.put(sentenceRow('sent_a'));
    await db.bookSentences.put({
      id: 'bs_a',
      bookId: 'book_1',
      sentenceId: 'sent_a',
      position: 1,
      status: 'new',
      addedAt: TS,
    } as never);

    await deleteSentencesCascade(['sent_a']);

    expect(await db.sentences.get('sent_a')).toBeUndefined();
    expect(await queueKeys()).toEqual(
      expect.arrayContaining(['book_sentences:bs_a:delete', 'sentences:sent_a:delete']),
    );
  });

  it('rolls the queue rows back with the data when the transaction fails', async () => {
    await updateSyncMeta({ userId: 'user_1' });
    const db = getDb();
    await expect(
      db.transaction('rw', [db.sentences, db.syncMeta, db.syncQueue, db.syncRecordMeta], async () => {
        await db.sentences.put(sentenceRow('sent_b'));
        await trackLocalMutationsInTransaction([
          { entity: 'sentences', recordId: 'sent_b', payload: sentenceRow('sent_b') },
        ]);
        throw new Error('suspended mid-transaction');
      }),
    ).rejects.toThrow();

    expect(await db.sentences.get('sent_b')).toBeUndefined();
    expect(await queueKeys()).toEqual([]);
    expect(await db.syncRecordMeta.get('sentences:sent_b')).toBeUndefined();
  });

  it('defers to the post-commit path when sign-in state is unknown', async () => {
    const db = getDb();
    const handled = await db.transaction(
      'rw',
      [db.syncMeta, db.syncQueue, db.syncRecordMeta],
      () =>
        trackLocalMutationsInTransaction([
          { entity: 'sentences', recordId: 'sent_c', payload: {} },
        ]),
    );

    expect(handled).toBe(false);
    expect(await queueKeys()).toEqual([]);
  });
});
