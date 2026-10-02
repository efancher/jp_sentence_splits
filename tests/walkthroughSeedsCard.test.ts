import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { getDb, logSentenceLearningEvent, updateSettings } from '../src/db/repository';

async function seededCount(sentenceId: string): Promise<number> {
  return getDb().studyItems.where('subjectId').equals(sentenceId).count();
}

beforeEach(async () => {
  await resetDbForTests();
});

describe('walkthrough completion seeds the sentence card', () => {
  it('creates one reading_in_context item under the sentence-led flow, idempotently', async () => {
    await logSentenceLearningEvent({ id: 'e1', visitId: 'v', action: 'walkthrough_completed', sentenceId: 's1' });
    await logSentenceLearningEvent({ id: 'e2', visitId: 'v2', action: 'walkthrough_completed', sentenceId: 's1' });
    expect(await seededCount('s1')).toBe(1);
  });

  it('does not seed for other actions or when the led flow is off', async () => {
    await logSentenceLearningEvent({ id: 'e3', visitId: 'v', action: 'walkthrough_opened', sentenceId: 's2' });
    expect(await seededCount('s2')).toBe(0);
    await updateSettings({ sentenceLedFlow: false });
    await logSentenceLearningEvent({ id: 'e4', visitId: 'v', action: 'walkthrough_completed', sentenceId: 's3' });
    expect(await seededCount('s3')).toBe(0);
  });
});
