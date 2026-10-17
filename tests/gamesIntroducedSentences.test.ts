import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { filterToMetSentenceIds, logSentenceLearningEvent } from '../src/db/repository';

beforeEach(async () => {
  await resetDbForTests();
});

describe('filterToMetSentenceIds (the sentence-led gate Remix uses)', () => {
  it('under the sentence-led flow, a walked-through sentence is introduced without any vocabulary card', async () => {
    await logSentenceLearningEvent({ id: 'e1', visitId: 'v', action: 'walkthrough_completed', sentenceId: 'walked' });
    const introduced = await filterToMetSentenceIds(['walked', 'untouched']);
    expect([...introduced]).toEqual(['walked']);
  });
});
