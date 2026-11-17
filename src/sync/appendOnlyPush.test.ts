import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb } from '../db/database';
import { pushMutations } from './engine';
import {
  APPEND_ONLY_ENTITIES,
  addConflict,
  enqueueMutation,
  getRecordMeta,
  listOpenConflicts,
  listPendingMutations,
  sweepNoopConflicts,
} from './queue';

let remoteRow: { version: number } | null = null;
let updates = 0;

function fakeSupabase() {
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user_1' } } } }) },
    from() {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: remoteRow, error: null }) }) }),
        // The real table has no update policy, so RLS filters the update to 0 rows.
        update: () => {
          updates += 1;
          return { eq: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }) };
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

describe('pushing an append-only event the cloud already has', () => {
  it('adopts the cloud row without a conflict', async () => {
    remoteRow = { version: 1 };
    await enqueueMutation({
      entity: 'sentence_learning_events',
      recordId: 'sl_event_1',
      operation: 'upsert',
      expectedVersion: null,
      payload: { id: 'sl_event_1' },
    });

    const failure = await pushMutations();

    expect(failure).toBeUndefined();
    expect(updates).toBe(0);
    expect(await listOpenConflicts()).toHaveLength(0);
    expect(await listPendingMutations()).toHaveLength(0);
    expect(await getRecordMeta('sentence_learning_events', 'sl_event_1')).toMatchObject({
      syncedVersion: 1,
    });
  });

  it.each([...APPEND_ONLY_ENTITIES])('adopts an already-delivered %s row', async (entity) => {
    remoteRow = { version: 1 };
    await enqueueMutation({
      entity,
      recordId: `${entity}_1`,
      operation: 'upsert',
      expectedVersion: null,
      payload: { id: `${entity}_1` },
    });

    expect(await pushMutations()).toBeUndefined();
    expect(updates).toBe(0);
    expect(await listOpenConflicts()).toHaveLength(0);
  });

  it('sweeps an earlier conflict on a live append-only row', async () => {
    await addConflict({
      entity: 'sentence_learning_events',
      recordId: 'sl_event_2',
      localPayload: { id: 'sl_event_2', quietMode: false },
      remotePayload: { id: 'sl_event_2', version: 1, deleted_at: null },
      localVersion: 0,
      remoteVersion: 1,
    });
    expect(await sweepNoopConflicts()).toBe(1);
    expect(await listOpenConflicts()).toHaveLength(0);
  });
});
