import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { getDb, getSavedWordStatus } from '../src/db/repository';

const now = '2026-09-30T00:00:00.000Z';
const fsrs = (state: 'new' | 'review') => ({
  due: now, stability: 1, difficulty: 1, elapsedDays: 0, scheduledDays: 0, learningSteps: 0, reps: 1, lapses: 0, state,
});

describe('getSavedWordStatus', () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it('marks an expression known only when its reading/meaning card is at review, and returns saved meanings', async () => {
    const db = getDb();
    for (const [id, expression, meaning] of [['v1', '本', 'book'], ['v2', '読む', 'to read'], ['v3', '猫', '']] as const) {
      await db.vocabularyItems.put({ id, expression, reading: 'r', meaning, createdAt: now, updatedAt: now });
    }
    const card = (id: string, subjectId: string, activityType: 'reading_retrieval' | 'pitch_accent', state: 'new' | 'review') =>
      db.studyItems.put({ id, subjectType: 'vocabularyItem', subjectId, activityType, fsrsState: fsrs(state), createdAt: now, updatedAt: now });
    await card('c1', 'v1', 'reading_retrieval', 'review');
    await card('c2', 'v2', 'pitch_accent', 'review'); // pitch reps do not make a word "known" for reading
    await card('c3', 'v3', 'reading_retrieval', 'new');

    const status = await getSavedWordStatus(['本', '読む', '猫', '犬']);
    expect([...status.knownExpressions]).toEqual(['本']);
    expect(status.savedMeanings.get('読む')).toBe('to read');
    expect(status.savedMeanings.has('猫')).toBe(false);
    expect(status.savedMeanings.has('犬')).toBe(false);
  });
});
