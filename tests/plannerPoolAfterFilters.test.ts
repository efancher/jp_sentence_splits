import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { ensureStudyItem, getDb, getSessionPlannerInput, updateSettings } from '../src/db/repository';
import { createInitialFsrsState } from '../src/lib/scheduling';

beforeEach(async () => {
  await resetDbForTests();
});

describe('planner due pool is trimmed after the paused/suspended filters', () => {
  it('keeps a live sentence card when 60+ older paused-drill items are due', async () => {
    await updateSettings({ sentenceLedFlow: true });
    const db = getDb();
    const old = '2026-08-01T00:00:00.000Z';
    for (let i = 0; i < 70; i += 1) {
      const item = await ensureStudyItem('vocabularyItem', `v${i}`, 'reading_retrieval');
      await db.studyItems.put({ ...item, fsrsState: { ...createInitialFsrsState(), due: old } });
    }
    const sentenceItem = await ensureStudyItem('sentence', 's1', 'reading_in_context');
    await db.studyItems.put({
      ...sentenceItem,
      fsrsState: { ...createInitialFsrsState(), due: '2026-09-30T00:00:00.000Z' },
    });
    const input = await getSessionPlannerInput(20, new Date('2026-10-02T12:00:00Z'));
    expect(input.retainDue.map((item) => item.studyItemId)).toEqual([sentenceItem.id]);
  });
});
