import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb, resetDbForTests } from '../db/database';
import { isFreshDevice } from './engine';
import { putRecordMeta } from './queue';

vi.mock('./supabaseClient', () => ({ getSupabase: () => null }));

describe('isFreshDevice', () => {
  beforeEach(() => {
    resetDbForTests(`fresh-device-${Math.random().toString(36).slice(2)}`);
  });

  it('is true for an empty device that has never pulled', async () => {
    expect(await isFreshDevice({ lastPullEventId: 0 })).toBe(true);
  });

  it('is false once a pull cursor exists', async () => {
    expect(await isFreshDevice({ lastPullEventId: 42 })).toBe(false);
  });

  it('is false when local study data exists', async () => {
    await getDb().books.put({
      id: 'b1',
      title: 'Local book',
      archived: false,
      createdAt: '2026-11-10T00:00:00.000Z',
      updatedAt: '2026-11-10T00:00:00.000Z',
    } as never);
    expect(await isFreshDevice({ lastPullEventId: 0 })).toBe(false);
  });

  it('is false when records are already tracked', async () => {
    await putRecordMeta({
      entity: 'books',
      recordId: 'b1',
      version: 1,
      syncedVersion: 1,
      updatedAt: '2026-11-10T00:00:00.000Z',
    });
    expect(await isFreshDevice({ lastPullEventId: 0 })).toBe(false);
  });
});
