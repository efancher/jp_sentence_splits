import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb } from '../db/database';
import { pushMutations } from './engine';
import {
  addConflict,
  enqueueMutation,
  getRecordMeta,
  listOpenConflicts,
  listPendingMutations,
  sweepNoopConflicts,
} from './queue';

let remoteRow: { version: number; deleted_at: string | null } | null = null;
let updates = 0;

function fakeSupabase() {
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user_1' } } } }) },
    from() {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: remoteRow, error: null }) }) }),
        update: () => {
          updates += 1;
          return { eq: () => ({ eq: () => ({ select: async () => ({ data: [{ version: 99 }], error: null }) }) }) };
        },
      };
    },
  };
}

vi.mock('./supabaseClient', () => ({ getSupabase: () => fakeSupabase() }));

beforeEach(async () => {
  remoteRow = null;
  updates = 0;
  await getDb().syncQueue.clear();
  await getDb().syncConflicts.clear();
});

describe('deleting a row the server already tombstoned', () => {
  // Merging two sentences: the sentences delete lands first and the server's
  // cascade trigger soft-deletes the live book_sentences/reference_audio
  // children, bumping their version past the client's lock (reported 2026-11-08).
  for (const entity of ['book_sentences', 'reference_audio'] as const) {
    it(`settles a ${entity} delete without a conflict`, async () => {
      remoteRow = { version: 6, deleted_at: '2026-11-08T01:47:33.882Z' };
      await enqueueMutation({
        entity,
        recordId: 'row_1',
        operation: 'delete',
        expectedVersion: 5,
        payload: { id: 'row_1' },
      });

      const failure = await pushMutations();

      expect(failure).toBeUndefined();
      expect(updates).toBe(0);
      expect(await listOpenConflicts()).toHaveLength(0);
      expect(await listPendingMutations()).toHaveLength(0);
      expect(await getRecordMeta(entity, 'row_1')).toMatchObject({ version: 6, syncedVersion: 6 });
    });
  }

  it('still raises a conflict for a delete against a live row that moved on', async () => {
    remoteRow = { version: 6, deleted_at: null };
    await enqueueMutation({
      entity: 'book_sentences',
      recordId: 'row_2',
      operation: 'delete',
      expectedVersion: 5,
      payload: { id: 'row_2' },
    });
    await pushMutations();
    expect(updates).toBe(0);
    expect(await listOpenConflicts()).toHaveLength(1);
  });

  it('sweeps earlier delete conflicts whose cloud row is already tombstoned', async () => {
    await addConflict({
      entity: 'book_sentences',
      recordId: 'bs_old',
      localPayload: { id: 'bs_old' },
      remotePayload: { id: 'bs_old', version: 6, deleted_at: '2026-11-08T01:47:33.882Z' },
      localVersion: 5,
      remoteVersion: 6,
    });
    await addConflict({
      entity: 'book_sentences',
      recordId: 'bs_edit',
      localPayload: { id: 'bs_edit', position: 2 },
      remotePayload: { id: 'bs_edit', version: 6, deleted_at: '2026-11-08T01:47:33.882Z' },
      localVersion: 5,
      remoteVersion: 6,
    });

    expect(await sweepNoopConflicts()).toBe(1);
    const open = await listOpenConflicts();
    expect(open.map((c) => c.recordId)).toEqual(['bs_edit']);
  });
});
