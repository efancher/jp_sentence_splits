import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { getDb, readRowsByKeys } from '../src/db/repository';

async function seedBlock(count: number) {
  const now = new Date().toISOString();
  await getDb().sentenceVocabulary.bulkAdd(
    Array.from({ length: count }, (_, i) => ({
      id: `sv_${i}`,
      sentenceId: `sent_${i % 12}`,
      vocabularyItemId: `vocab_${i}`,
      surfaceForm: `w${i}`,
      createdAt: now,
      updatedAt: now,
    })) as never,
  );
}

describe('readRowsByKeys', () => {
  beforeEach(async () => {
    await resetDbForTests();
    await seedBlock(36);
  });

  it('returns every row for a few keys (indexed lookup)', async () => {
    const rows = await readRowsByKeys(getDb().sentenceVocabulary, 'sentenceId', ['sent_0', 'sent_3']);
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((row) => row.sentenceId))).toEqual(new Set(['sent_0', 'sent_3']));
  });

  it('returns the same rows for many keys (single table read)', async () => {
    const keys = Array.from({ length: 10 }, (_, i) => `sent_${i}`);
    const rows = await readRowsByKeys(getDb().sentenceVocabulary, 'sentenceId', keys);
    const expected = await getDb().sentenceVocabulary.where('sentenceId').anyOf(keys).toArray();
    expect(rows.map((row) => row.id).sort()).toEqual(expected.map((row) => row.id).sort());
    expect(rows).toHaveLength(30);
  });

  it('ignores keys with no rows and handles an empty key list', async () => {
    expect(await readRowsByKeys(getDb().sentenceVocabulary, 'sentenceId', [])).toEqual([]);
    const keys = ['nope_1', 'nope_2', 'nope_3', 'nope_4', 'nope_5', 'nope_6', 'sent_11'];
    expect(await readRowsByKeys(getDb().sentenceVocabulary, 'sentenceId', keys)).toHaveLength(3);
  });
});
