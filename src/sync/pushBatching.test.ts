import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb } from '../db/database';
import { pushMutations, sortForPush } from './engine';
import { enqueueMutation, listPendingMutations } from './queue';
import type { SyncQueueItem } from './types';

interface Call {
  table: string;
  kind: 'select_in' | 'select_eq' | 'insert';
  ids?: string[];
  rows?: number;
}

const calls: Call[] = [];
let existing = new Set<string>();
/** ids whose presence in an insert makes the whole insert fail with a DB error. */
let poisoned = new Set<string>();
let transportDown = false;

function fakeSupabase() {
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user_1' } } } }) },
    from(table: string) {
      return {
        select() {
          return {
            in: async (_col: string, ids: string[]) => {
              calls.push({ table, kind: 'select_in', ids });
              if (transportDown) return { data: null, error: { message: 'Request timed out after 30s', code: '' } };
              return {
                data: ids.filter((id) => existing.has(id)).map((id) => ({ id, version: 1 })),
                error: null,
              };
            },
            eq: () => ({
              maybeSingle: async () => {
                calls.push({ table, kind: 'select_eq' });
                return { data: null, error: null };
              },
            }),
          };
        },
        insert: async (rows: Record<string, unknown> | Record<string, unknown>[]) => {
          const list = Array.isArray(rows) ? rows : [rows];
          calls.push({ table, kind: 'insert', rows: list.length });
          if (transportDown) return { error: { message: 'Request timed out after 30s', code: '' } };
          if (list.some((r) => poisoned.has(String(r.id)))) {
            return { error: { message: 'new row violates row-level security policy', code: '42501' } };
          }
          return { error: null };
        },
      };
    },
  };
}

vi.mock('./supabaseClient', () => ({ getSupabase: () => fakeSupabase() }));

function kanjiPayload(id: string) {
  return {
    id,
    character: id,
    meanings: [],
    onyomi: [],
    kunyomi: [],
    nanori: [],
    createdAt: '2026-09-20T00:00:00Z',
    updatedAt: '2026-09-20T00:00:00Z',
  };
}

async function queueKanji(ids: string[]) {
  for (const id of ids) {
    await enqueueMutation({
      entity: 'kanji',
      recordId: id,
      operation: 'upsert',
      expectedVersion: null,
      payload: kanjiPayload(id),
    });
  }
}

beforeEach(async () => {
  calls.length = 0;
  existing = new Set();
  poisoned = new Set();
  transportDown = false;
  await getDb().syncQueue.clear();
});

describe('sortForPush', () => {
  const item = (entity: SyncQueueItem['entity'], recordId: string): SyncQueueItem => ({
    id: `q_${recordId}`,
    entity,
    recordId,
    operation: 'upsert',
    expectedVersion: null,
    payload: {},
    localTimestamp: '',
    retryCount: 0,
  });

  it('puts parents before the links that reference them, grouped by entity within a tier', () => {
    const sorted = sortForPush([
      item('vocabulary_kanji', 'link_1'),
      item('vocabulary_items', 'vi_1'),
      item('reviews', 'rev_1'),
      item('sentence_vocabulary', 'sv_1'),
      item('kanji', 'k_1'),
      item('vocabulary_items', 'vi_2'),
      item('kanji', 'k_2'),
    ]);
    expect(sorted.map((i) => i.recordId)).toEqual([
      'k_1',
      'k_2',
      'vi_1',
      'vi_2',
      'sv_1',
      'link_1',
      'rev_1',
    ]);
  });

  it('keeps queued order within one entity', () => {
    const sorted = sortForPush([item('kanji', 'k_b'), item('vocabulary_items', 'vi'), item('kanji', 'k_a')]);
    expect(sorted.map((i) => i.recordId)).toEqual(['k_b', 'k_a', 'vi']);
  });
});

describe('pushMutations batching', () => {
  it('sends new same-entity rows as one existence check + one bulk insert', async () => {
    await queueKanji(['k_a', 'k_b', 'k_c', 'k_d']);

    expect(await pushMutations()).toBeUndefined();

    expect(calls).toEqual([
      { table: 'kanji', kind: 'select_in', ids: ['k_a', 'k_b', 'k_c', 'k_d'] },
      { table: 'kanji', kind: 'insert', rows: 4 },
    ]);
    expect(await listPendingMutations()).toHaveLength(0);
  });

  it('bisects a rejected bulk insert down to the one bad row and pushes the rest in bulk', async () => {
    await queueKanji(['k_1', 'k_2', 'k_3', 'k_4', 'k_5', 'k_6', 'k_7', 'k_8']);
    poisoned = new Set(['k_6']);

    const failure = await pushMutations();

    expect(failure).toContain('kanji');
    const remaining = await listPendingMutations();
    expect(remaining.map((r) => r.recordId)).toEqual(['k_6']);
    expect(remaining[0]!.retryCount).toBe(1);
    // nowhere near the 16 requests of row-by-row select+insert
    expect(calls.length).toBeLessThan(12);
  });

  it('stops after a transport failure instead of timing out on every remaining batch', async () => {
    await queueKanji(['k_1', 'k_2', 'k_3']);
    for (const id of ['vi_1', 'vi_2']) {
      await enqueueMutation({
        entity: 'vocabulary_items',
        recordId: id,
        operation: 'upsert',
        expectedVersion: null,
        payload: {},
      });
    }
    transportDown = true;

    const failure = await pushMutations();

    expect(failure).toContain('timed out');
    // one request for the first run only — the other entity's run never starts
    expect(calls).toHaveLength(1);
    expect(await listPendingMutations()).toHaveLength(5); // all still queued
  });
});
