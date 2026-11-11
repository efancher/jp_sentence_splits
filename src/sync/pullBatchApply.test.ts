import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb, resetDbForTests } from '../db/database';
import { applyRemoteEventsBatch } from './engine';
import { getRecordMeta } from './queue';

let remoteRows: Record<string, Array<Record<string, unknown>>> = {};

function fakeSupabase() {
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user_1' } } } }) },
    from(table: string) {
      return {
        select: () => ({
          in: async (_col: string, ids: string[]) => ({
            data: (remoteRows[table] ?? []).filter((row) => ids.includes(String(row.id))),
            error: null,
          }),
        }),
      };
    },
  };
}

vi.mock('./supabaseClient', () => ({ getSupabase: () => fakeSupabase() }));

function bookRow(id: string, version = 1) {
  return {
    id,
    title: `Book ${id}`,
    archived: false,
    created_at: '2026-11-10T00:00:00.000Z',
    updated_at: '2026-11-10T00:00:00.000Z',
    version,
  };
}

function event(id: number, entity: string, recordId: string, op = 'insert', version = 1) {
  return { id, entity, record_id: recordId, op, version };
}

describe('applyRemoteEventsBatch', () => {
  beforeEach(() => {
    resetDbForTests(`pull-batch-${Math.random().toString(36).slice(2)}`);
    remoteRows = {};
  });

  it('writes a whole page of rows and their record-meta in one transaction', async () => {
    remoteRows.books = [bookRow('b1'), bookRow('b2'), bookRow('b3')];
    const db = getDb();
    const transaction = vi.spyOn(db, 'transaction');

    const { skipped } = await applyRemoteEventsBatch([
      event(1, 'books', 'b1'),
      event(2, 'books', 'b2'),
      event(3, 'books', 'b3'),
    ]);

    expect(skipped).toEqual([]);
    expect(await db.books.count()).toBe(3);
    expect((await getRecordMeta('books', 'b2'))?.syncedVersion).toBe(1);
    // Per-row auto-commits cost ~100ms each on iOS; the page must be one commit.
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('does not re-fetch or rewrite events it already has (echo of our own push)', async () => {
    const db = getDb();
    await db.books.put({
      id: 'b1',
      title: 'Local',
      archived: false,
      chapters: [],
      collapsedChapterIds: [],
      createdAt: '2026-11-10T00:00:00.000Z',
      updatedAt: '2026-11-10T00:00:00.000Z',
    });
    const { putRecordMeta } = await import('./queue');
    await putRecordMeta({
      entity: 'books',
      recordId: 'b1',
      version: 1,
      syncedVersion: 1,
      updatedAt: '2026-11-10T00:00:00.000Z',
    });
    remoteRows.books = [bookRow('b1')];

    await applyRemoteEventsBatch([event(1, 'books', 'b1')]);

    expect((await db.books.get('b1'))?.title).toBe('Local');
  });

  it('applies a book delete event with its book_sentences atomically', async () => {
    const db = getDb();
    await db.books.put({
      id: 'b1',
      title: 'Doomed',
      archived: false,
      chapters: [],
      collapsedChapterIds: [],
      createdAt: '2026-11-10T00:00:00.000Z',
      updatedAt: '2026-11-10T00:00:00.000Z',
    });
    await db.bookSentences.put({
      id: 'bs1',
      bookId: 'b1',
      sentenceId: 's1',
      orderIndex: 0,
    } as never);
    remoteRows.books = [{ ...bookRow('b1', 2), deleted_at: '2026-11-11T00:00:00.000Z' }];

    await applyRemoteEventsBatch([event(5, 'books', 'b1', 'delete', 2)]);

    expect(await db.books.get('b1')).toBeUndefined();
    expect(await db.bookSentences.where('bookId').equals('b1').count()).toBe(0);
    expect((await getRecordMeta('books', 'b1'))?.deletedAt).toBeDefined();
  });
});
