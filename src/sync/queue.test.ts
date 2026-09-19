import { describe, expect, it } from 'vitest';

import {
  addConflict,
  dedupeQueueRows,
  enqueueMutation,
  listOpenConflicts,
  listPendingMutations,
  resolveConflictLocally,
  sweepNoopConflicts,
} from './queue';

describe('addConflict', () => {
  it('upserts on (entity, recordId) among open conflicts instead of always inserting', async () => {
    // Regression: several queued mutations for the same record hitting
    // version_conflict in one push cycle each called addConflict, producing
    // one duplicate ConflictPanel card per queue item (34 rows for 10
    // actually-conflicting records in one reported case, 2026-09-04).
    await addConflict({
      entity: 'sentences',
      recordId: 'sent_1',
      localPayload: { japanese: 'first edit' },
      remotePayload: { japanese: 'remote' },
      localVersion: 1,
      remoteVersion: 2,
    });
    await addConflict({
      entity: 'sentences',
      recordId: 'sent_1',
      localPayload: { japanese: 'second edit' },
      remotePayload: { japanese: 'remote' },
      localVersion: 2,
      remoteVersion: 2,
    });

    const open = await listOpenConflicts();
    const forRecord = open.filter(
      (c) => c.entity === 'sentences' && c.recordId === 'sent_1',
    );
    expect(forRecord).toHaveLength(1);
    // Keeps the most recent local edit, not whichever queue item conflicted first.
    expect(forRecord[0]!.localPayload).toEqual({ japanese: 'second edit' });
  });

  it('creates a new row once the prior conflict for that record is resolved', async () => {
    const first = await addConflict({
      entity: 'sentences',
      recordId: 'sent_2',
      localPayload: { japanese: 'a' },
      remotePayload: { japanese: 'b' },
      localVersion: 1,
      remoteVersion: 2,
    });
    await resolveConflictLocally(first.id, 'keep_local');

    const second = await addConflict({
      entity: 'sentences',
      recordId: 'sent_2',
      localPayload: { japanese: 'c' },
      remotePayload: { japanese: 'd' },
      localVersion: 3,
      remoteVersion: 4,
    });

    expect(second.id).not.toBe(first.id);
    const open = await listOpenConflicts();
    expect(open.filter((c) => c.recordId === 'sent_2')).toHaveLength(1);
  });

  it('keeps conflicts for different records independent', async () => {
    await addConflict({
      entity: 'sentences',
      recordId: 'sent_3',
      localPayload: {},
      remotePayload: {},
      localVersion: 1,
      remoteVersion: 2,
    });
    await addConflict({
      entity: 'sentences',
      recordId: 'sent_4',
      localPayload: {},
      remotePayload: {},
      localVersion: 1,
      remoteVersion: 2,
    });

    const open = await listOpenConflicts();
    expect(open.filter((c) => c.recordId === 'sent_3')).toHaveLength(1);
    expect(open.filter((c) => c.recordId === 'sent_4')).toHaveLength(1);
  });
});

describe('sweepNoopConflicts', () => {
  it('auto-resolves an already-open conflict whose frozen payloads no longer diverge', async () => {
    // Regression: a `reviews` conflict recorded before the createdAt-strip
    // fix (conflictDiff.ts's ENTITY_EXTRA_KEYS) sat open forever, since
    // handlePushConflict only re-checks conflictContentsMatch at creation
    // time, not on every later sync cycle (reported via two "Report sync
    // issue" submissions, 2026-09-14 — "the diff doesn't show a difference").
    const conflict = await addConflict({
      entity: 'reviews',
      recordId: 'review_stale',
      localPayload: { id: 'review_stale', timestamp: '2026-09-01T00:00:00Z' },
      remotePayload: {
        id: 'review_stale',
        timestamp: '2026-09-01T00:00:00Z',
        created_at: '2026-09-01T00:00:00Z',
        version: 1,
      },
      localVersion: 0,
      remoteVersion: 1,
    });

    const swept = await sweepNoopConflicts();

    expect(swept).toBe(1);
    const open = await listOpenConflicts();
    expect(open.find((c) => c.id === conflict.id)).toBeUndefined();
  });

  it('clears a stuck book_sentences conflict that differed only by the remote createdAt', async () => {
    // Reported 2026-09-19: 58 book_sentences conflicts (local v3 vs remote v4)
    // open on one laptop; the diff showed nothing but a remote-only createdAt.
    // BookSentence has addedAt, not createdAt, but the mapper fills created_at.
    const stuck = await addConflict({
      entity: 'book_sentences',
      recordId: 'bs_stuck',
      localPayload: {
        id: 'bs_stuck',
        bookId: 'book_1',
        sentenceId: 'sent_1',
        position: 111,
        status: 'unstarted',
        addedAt: '2026-09-18T04:18:06.660Z',
        chapterId: 'chapter_1',
      },
      remotePayload: {
        id: 'bs_stuck',
        book_id: 'book_1',
        sentence_id: 'sent_1',
        position: 111,
        status: 'unstarted',
        added_at: '2026-09-18T04:18:06.66+00:00',
        created_at: '2026-09-18T04:18:06.66+00:00',
        chapter_id: 'chapter_1',
        last_studied_at: null,
        note: null,
        version: 4,
        owner_id: 'user-1',
      },
      localVersion: 3,
      remoteVersion: 4,
    });
    const real = await addConflict({
      entity: 'book_sentences',
      recordId: 'bs_real',
      localPayload: { id: 'bs_real', status: 'completed', addedAt: '2026-09-18T04:18:06.660Z' },
      remotePayload: { id: 'bs_real', status: 'unstarted', added_at: '2026-09-18T04:18:06.66+00:00', created_at: '2026-09-18T04:18:06.66+00:00', version: 4 },
      localVersion: 3,
      remoteVersion: 4,
    });

    expect(await sweepNoopConflicts()).toBe(1);
    const open = await listOpenConflicts();
    expect(open.find((c) => c.id === stuck.id)).toBeUndefined();
    expect(open.find((c) => c.id === real.id)).toBeDefined(); // a real status difference stays for the learner to decide
  });

  it('leaves a conflict with a real content difference open', async () => {
    await addConflict({
      entity: 'reviews',
      recordId: 'review_real',
      localPayload: { id: 'review_real', rating: 'good' },
      remotePayload: { id: 'review_real', rating: 'again', version: 1 },
      localVersion: 0,
      remoteVersion: 1,
    });

    const swept = await sweepNoopConflicts();

    expect(swept).toBe(0);
    const open = await listOpenConflicts();
    expect(open.find((c) => c.recordId === 'review_real')).toBeDefined();
  });
});

describe('enqueueMutation atomic coalescing', () => {
  it('overlapping enqueues for one record leave a single queue row (latest payload wins)', async () => {
    // Reported 2026-09-19: every stuck sentence_grammar link was queued twice. A
    // create and an immediate edit fire without awaiting each other; the
    // read-then-write coalescing used to let both see "nothing queued" and both insert.
    await Promise.all(
      [1, 2, 3, 4, 5, 6].map((n) =>
        enqueueMutation({
          entity: 'sentence_grammar',
          recordId: 'sg_race',
          operation: 'upsert',
          expectedVersion: null,
          payload: { n },
        }),
      ),
    );
    const rows = (await listPendingMutations()).filter((r) => r.recordId === 'sg_race');
    expect(rows).toHaveLength(1);
  });

  it('still keeps separate rows for separate records', async () => {
    await Promise.all(
      ['a', 'b', 'c'].map((id) =>
        enqueueMutation({ entity: 'sentence_grammar', recordId: `sg_${id}`, operation: 'upsert', expectedVersion: null, payload: {} }),
      ),
    );
    const rows = (await listPendingMutations()).filter((r) => r.recordId.startsWith('sg_') && r.entity === 'sentence_grammar');
    expect(new Set(rows.map((r) => r.recordId)).size).toBeGreaterThanOrEqual(3);
  });
});

describe('dedupeQueueRows', () => {
  it('collapses twins to the newest payload under the oldest id and lock base, keeping the highest retry count', async () => {
    const { getDb } = await import('../db/database');
    const db = getDb();
    const row = (id: string, ts: string, payload: unknown, expectedVersion: number | null, retryCount: number) => ({
      id, entity: 'sentence_grammar' as const, recordId: 'sg_twin', operation: 'upsert' as const,
      expectedVersion, payload, localTimestamp: ts, retryCount, lastError: undefined,
    });
    await db.syncQueue.bulkPut([
      row('opq_old', '2026-09-19T10:00:00.000Z', { v: 'old' }, 3, 70),
      row('opq_new', '2026-09-19T10:00:05.000Z', { v: 'new' }, 4, 69),
    ]);
    await db.syncQueue.put({ ...row('opq_solo', '2026-09-19T10:00:01.000Z', { v: 'solo' }, null, 0), recordId: 'sg_solo' });

    expect(await dedupeQueueRows()).toBe(1);

    const twins = (await db.syncQueue.toArray()).filter((r) => r.recordId === 'sg_twin');
    expect(twins).toHaveLength(1);
    expect(twins[0]).toMatchObject({ id: 'opq_old', expectedVersion: 3, retryCount: 70, payload: { v: 'new' } });
    expect((await db.syncQueue.toArray()).some((r) => r.id === 'opq_solo')).toBe(true);
    expect(await dedupeQueueRows()).toBe(0); // idempotent
  });
});
