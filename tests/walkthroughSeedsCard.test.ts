import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { getDb, logSentenceLearningEvent } from '../src/db/repository';

async function seededCount(sentenceId: string): Promise<number> {
  return getDb().studyItems.where('subjectId').equals(sentenceId).count();
}

beforeEach(async () => {
  await resetDbForTests();
});

describe('walkthrough completion seeds the sentence card', () => {
  it('creates one reading_in_context item, idempotently', async () => {
    await logSentenceLearningEvent({ id: 'e1', visitId: 'v', action: 'walkthrough_completed', sentenceId: 's1' });
    await logSentenceLearningEvent({ id: 'e2', visitId: 'v2', action: 'walkthrough_completed', sentenceId: 's1' });
    expect(await seededCount('s1')).toBe(1);
  });

  it('does not seed for other actions', async () => {
    await logSentenceLearningEvent({ id: 'e3', visitId: 'v', action: 'walkthrough_opened', sentenceId: 's2' });
    expect(await seededCount('s2')).toBe(0);
  });
});
