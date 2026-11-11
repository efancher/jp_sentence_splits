import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb, resetDbForTests } from '../db/database';
import { pushMutations, requeueUnsyncedParents, resetUnsyncedParentsSweepForTests } from './engine';
import { enqueueMutation, putRecordMeta } from './queue';

/** Sentence ids the fake server already has. */
let serverSentences = new Set<string>();

function fakeSupabase() {
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user_1' } } } }) },
    from(table: string) {
      return {
        select: () => ({
          in: async () => ({ data: [], error: null }),
          eq: (_col: string, id: string) => ({
            maybeSingle: async () => ({
              data: table === 'sentences' && serverSentences.has(id) ? { id, version: 1 } : null,
              error: null,
            }),
          }),
        }),
        insert: async (row: Record<string, unknown>) => {
          if (table === 'book_sentences' && !serverSentences.has(String(row.sentence_id))) {
            return {
              error: {
                code: '23503',
                message:
                  'insert or update on table "book_sentences" violates foreign key constraint "book_sentences_sentence_id_fkey"',
              },
            };
          }
          if (table === 'sentences') serverSentences.add(String(row.id));
          return { error: null };
        },
      };
    },
  };
}

vi.mock('./supabaseClient', () => ({ getSupabase: () => fakeSupabase() }));

const TS = '2026-11-10T00:00:00.000Z';

function sentenceRow(id: string) {
  return {
    id,
    normalizedKey: id,
    japanese: 'テスト',
    readingOnly: '',
    inlineReading: '',
    translation: '',
    createdAt: TS,
    updatedAt: TS,
  } as never;
}

async function queueChild(sentenceId: string) {
  await enqueueMutation({
    entity: 'book_sentences',
    recordId: 'bs_1',
    operation: 'upsert',
    expectedVersion: null,
    payload: { id: 'bs_1', bookId: 'book_1', sentenceId, position: 1, status: 'new', addedAt: TS },
  });
}

async function pendingKeys() {
  const rows = await getDb().syncQueue.toArray();
  return rows.map((row) => `${row.entity}:${row.recordId}`).sort();
}

describe('sentence parent healing on foreign-key failure', () => {
  beforeEach(async () => {
    resetDbForTests(`heal-${Math.random().toString(36).slice(2)}`);
    serverSentences = new Set();
    resetUnsyncedParentsSweepForTests();
    await getDb().syncMeta.put({ id: 'sync', migrationChoice: 'upload', lastSyncAt: TS } as never);
  });

  it('re-queues a sentence that exists locally but was never queued', async () => {
    await getDb().sentences.put(sentenceRow('sent_x'));
    await queueChild('sent_x');
    // Make the sweep irrelevant so this exercises the push-time heal.
    await putRecordMeta({ entity: 'sentences', recordId: 'sent_x', version: 1, syncedVersion: 1, updatedAt: TS });

    await pushMutations();

    expect(await pendingKeys()).toContain('sentences:sent_x');
    expect(await getDb().sentences.get('sent_x')).toBeDefined();
  });

  it('drops only the queue row when the sentence is gone locally, keeping local rows', async () => {
    await getDb().bookSentences.put({
      id: 'bs_1',
      bookId: 'book_1',
      sentenceId: 'sent_gone',
      position: 1,
      status: 'new',
      addedAt: TS,
    } as never);
    await queueChild('sent_gone');

    await pushMutations();

    expect(await pendingKeys()).toEqual([]);
    expect(await getDb().bookSentences.get('bs_1')).toBeDefined();
  });

  it('pushes a child normally when its sentence is queued ahead of it', async () => {
    await getDb().sentences.put(sentenceRow('sent_q'));
    await enqueueMutation({
      entity: 'sentences',
      recordId: 'sent_q',
      operation: 'upsert',
      expectedVersion: null,
      payload: sentenceRow('sent_q'),
    });
    await queueChild('sent_q');

    await pushMutations();

    expect(await pendingKeys()).toEqual([]);
  });
});

describe('requeueUnsyncedParents', () => {
  beforeEach(async () => {
    resetDbForTests(`sweep-${Math.random().toString(36).slice(2)}`);
    resetUnsyncedParentsSweepForTests();
    await getDb().syncMeta.put({ id: 'sync', migrationChoice: 'upload', lastSyncAt: TS } as never);
  });

  it('queues a never-acknowledged sentence with nothing queued, and nothing else', async () => {
    const db = getDb();
    await db.sentences.bulkPut([sentenceRow('sent_lost'), sentenceRow('sent_synced'), sentenceRow('sent_queued')]);
    await putRecordMeta({ entity: 'sentences', recordId: 'sent_synced', version: 3, syncedVersion: 3, updatedAt: TS });
    await enqueueMutation({
      entity: 'sentences',
      recordId: 'sent_queued',
      operation: 'upsert',
      expectedVersion: null,
      payload: {},
    });

    expect(await requeueUnsyncedParents()).toBe(1);
    expect(await pendingKeys()).toEqual(['sentences:sent_lost', 'sentences:sent_queued']);
    // Once per session.
    expect(await requeueUnsyncedParents()).toBe(0);
  });

  it('does nothing when the user chose to keep this device local-only', async () => {
    await getDb().syncMeta.put({ id: 'sync', migrationChoice: 'keep_local', lastSyncAt: TS } as never);
    await getDb().sentences.put(sentenceRow('sent_lost'));

    expect(await requeueUnsyncedParents()).toBe(0);
    expect(await pendingKeys()).toEqual([]);
  });
});
