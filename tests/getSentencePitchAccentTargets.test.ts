import { beforeEach, describe, expect, it } from 'vitest';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb, getSentencePitchAccentTargets } from '../src/db/repository';
import { createId } from '../src/lib/ids';

async function seedSentence(japanese: string) {
  const db = getDb();
  const now = new Date().toISOString();
  await db.sentences.add({
    id: 'sent-1',
    normalizedKey: 'sent-1',
    japanese,
    readingOnly: '',
    inlineReading: '',
    translation: '',
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: now,
    updatedAt: now,
  });
}

async function addVocabLink(params: {
  vocabId: string;
  expression: string;
  reading: string;
  partOfSpeech: string;
  pitchAccentPositions: number[];
  surfaceForm: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  await db.vocabularyItems.add({
    id: params.vocabId,
    expression: params.expression,
    reading: params.reading,
    meaning: 'x',
    partOfSpeech: params.partOfSpeech,
    pitchAccentPositions: params.pitchAccentPositions,
    createdAt: now,
    updatedAt: now,
  });
  await db.sentenceVocabulary.add({
    id: `sv-${params.vocabId}`,
    sentenceId: 'sent-1',
    vocabularyItemId: params.vocabId,
    surfaceForm: params.surfaceForm,
    createdAt: now,
    updatedAt: now,
  });
}

describe('getSentencePitchAccentTargets', () => {
  beforeEach(async () => {
    resetDbForTests(`pa-targets-${createId('db')}`);
    await ensureSettings();
  });

  it('resolves a citation-form occurrence to the dictionary reading/position', async () => {
    await seedSentence('本を読む。');
    await addVocabLink({
      vocabId: 'vocab-yomu',
      expression: '読む',
      reading: 'よむ',
      partOfSpeech: 'v5m; vt',
      pitchAccentPositions: [0],
      surfaceForm: '読む',
    });

    const targets = await getSentencePitchAccentTargets('sent-1');
    expect(targets).toEqual([
      { surfaceForm: '読む', reading: 'よむ', pitchAccentPositions: [0] },
    ]);
  });

  it('resolves a supported inflected occurrence to the conjugated reading/position, not the dictionary one', async () => {
    await seedSentence('公園を走らない。');
    await addVocabLink({
      vocabId: 'vocab-hashiru',
      expression: '走る',
      reading: 'はしる',
      partOfSpeech: 'v5r; vi',
      pitchAccentPositions: [2],
      surfaceForm: '走らない',
    });

    const targets = await getSentencePitchAccentTargets('sent-1');
    // 走る[2] is accented; its negative downsteps one mora past citation
    // (right before ない) — position 3 in はしらない, not 2 in はしる.
    expect(targets).toEqual([
      { surfaceForm: '走らない', reading: 'はしらない', pitchAccentPositions: [3] },
    ]);
  });

  it('drops an inflected occurrence outside the shift calculator\'s coverage rather than showing the wrong (citation-form) contour', async () => {
    await seedSentence('公園を走って帰った。');
    await addVocabLink({
      vocabId: 'vocab-hashiru',
      expression: '走る',
      reading: 'はしる',
      partOfSpeech: 'v5r; vi',
      pitchAccentPositions: [2],
      surfaceForm: '走って', // te-form: not covered by predictInflectedPitchAccentPosition
    });

    const targets = await getSentencePitchAccentTargets('sent-1');
    expect(targets).toEqual([]);
  });

  it('drops a word with no dictionary pitch-accent data at all', async () => {
    await seedSentence('水を飲む。');
    await addVocabLink({
      vocabId: 'vocab-mizu',
      expression: '水',
      reading: 'みず',
      partOfSpeech: 'n',
      pitchAccentPositions: [],
      surfaceForm: '水',
    });

    const targets = await getSentencePitchAccentTargets('sent-1');
    expect(targets).toEqual([]);
  });
});
