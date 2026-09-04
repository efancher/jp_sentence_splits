import { describe, expect, it } from 'vitest';

import { addConflict, listOpenConflicts, resolveConflictLocally } from './queue';

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
