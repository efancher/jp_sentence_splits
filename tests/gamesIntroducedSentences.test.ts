import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  filterToIntroducedSentenceIds,
  getDb,
  getRemixData,
  logSentenceLearningEvent,
  updateSettings,
} from '../src/db/repository';
import type { VocabularySuggestion } from '../src/domain/types';

const T = '2026-10-10T00:00:00.000Z';

beforeEach(async () => {
  await resetDbForTests();
});

describe('filterToIntroducedSentenceIds (the shared /play gate)', () => {
  it('under the sentence-led flow, a walked-through sentence is introduced without any vocabulary card', async () => {
    await logSentenceLearningEvent({ id: 'e1', visitId: 'v', action: 'walkthrough_completed', sentenceId: 'walked' });
    const introduced = await filterToIntroducedSentenceIds(['walked', 'untouched']);
    expect([...introduced]).toEqual(['walked']);
  });

  it('with the flow off it falls back to the vocabulary-review rule', async () => {
    await updateSettings({ sentenceLedFlow: false });
    await logSentenceLearningEvent({ id: 'e2', visitId: 'v', action: 'walkthrough_completed', sentenceId: 'walked' });
    // No linked words → vacuously ready under the old rule, regardless of the walkthrough.
    expect((await filterToIntroducedSentenceIds(['walked', 'untouched'])).size).toBe(2);
  });
});

// 親鳥がひなに巣を作りました。
const N = '名詞/普通名詞';
const CASE = '助詞/格助詞';
const SEGMENTS: [string, string][] = [
  ['親', N], ['鳥', N], ['が', CASE], ['ひな', N], ['に', CASE], ['巣', N], ['を', CASE],
  ['作り', '動詞/一般'], ['まし', '助動詞'], ['た', '助動詞'], ['。', '補助記号'],
];

async function seedRemixWorld({ walked }: { walked: boolean }) {
  const db = getDb();
  let at = 0;
  const vocabularySuggestions: VocabularySuggestion[] = SEGMENTS.map(([surface, pos], i) => {
    const token = {
      id: `t${i}`, surface, start: at, end: at + surface.length, expression: surface, reading: surface,
      pos, source: 'morphology' as const, selectedByDefault: false,
    };
    at += surface.length;
    return token;
  });
  await db.sentences.put({
    id: 'remix1',
    normalizedKey: 'remix1',
    japanese: SEGMENTS.map(([s]) => s).join(''),
    readingOnly: '', inlineReading: '', translation: 'The parent bird made a nest for the chick.',
    targetVocabulary: [], vocabularySuggestions, sourceReferences: [], conflicts: [],
    firstOccurrenceIndex: 0, importBatchIds: [], createdAt: T, updatedAt: T,
  });
  await db.sentenceAudio.put({
    id: 'a1', sentenceId: 'remix1', sourceId: 's', sourceSentenceId: 'remix1', sourceTitle: 's',
    mimeType: 'audio/mpeg', durationMs: 3000, startMs: 0, endMs: 3000, blob: new Blob(['x']), importedAt: T,
  });
  // Swap-noun pool: vocabulary linked to the same (unconfirmed) sentence; no study items exist for any of it.
  const nouns: [string, string][] = [
    ['犬', 'dog'], ['本', 'book'], ['駅', 'station'], ['水', 'water'], ['窓', 'window'], ['机', 'desk'], ['花', 'flower'],
  ];
  for (const [index, [expression, meaning]] of nouns.entries()) {
    await db.vocabularyItems.put({
      id: `v${index}`, expression, reading: expression, meaning, partOfSpeech: '名詞/普通名詞', createdAt: T, updatedAt: T,
    });
    await db.sentenceVocabulary.put({
      id: `sv${index}`, sentenceId: 'remix1', vocabularyItemId: `v${index}`, createdAt: T, updatedAt: T,
    });
  }
  if (walked) {
    await logSentenceLearningEvent({ id: 'w1', visitId: 'v', action: 'walkthrough_completed', sentenceId: 'remix1' });
  }
}

describe('getRemixData under the sentence-led flow', () => {
  it('offers a walked-through sentence with unconfirmed vocabulary and no vocabulary cards (pool from linked nouns)', async () => {
    await seedRemixWorld({ walked: true });
    const { candidates, pool } = await getRemixData();
    expect(pool.length).toBeGreaterThanOrEqual(6);
    expect(candidates.map((c) => c.id)).toEqual(['remix1']);
    expect(await getDb().studyItems.where('subjectType').equals('vocabularyItem').count()).toBe(0);
  });

  it('offers nothing for a sentence the learner has not met', async () => {
    await seedRemixWorld({ walked: false });
    const { candidates } = await getRemixData();
    expect(candidates).toEqual([]);
  });
});
