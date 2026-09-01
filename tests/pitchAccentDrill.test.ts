import { beforeEach, describe, expect, it } from 'vitest';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import { getDb, getPitchAccentDrillSentences } from '../src/db/repository';
import { createId } from '../src/lib/ids';

const PROFICIENT_FSRS = {
  due: '2026-10-01T00:00:00.000Z',
  stability: 10,
  difficulty: 5,
  elapsedDays: 0,
  scheduledDays: 6,
  learningSteps: 0,
  reps: 3,
  lapses: 0,
  state: 'review' as const,
};

async function seedEligibleSentence(id: string, { withAudio = false } = {}) {
  const db = getDb();
  const now = new Date().toISOString();
  await db.sentences.add({
    id,
    normalizedKey: id,
    japanese: `${id}を食べる。`,
    readingOnly: '',
    inlineReading: '',
    translation: 'eat it',
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: id === 's1' ? 0 : 1,
    importBatchIds: [],
    createdAt: now,
    updatedAt: now,
  });
  await db.analyses.add({
    sentenceId: id,
    chunks: [],
    notes: '',
    status: 'empty',
    formatVersion: 2,
    vocabularyReviewStatus: 'confirmed',
    vocabularySelections: [],
    createdAt: now,
    updatedAt: now,
  });
  const vocabId = `${id}-vocab`;
  await db.vocabularyItems.add({
    id: vocabId,
    expression: '食べる',
    reading: 'たべる',
    meaning: 'to eat',
    pitchAccentPositions: [2],
    createdAt: now,
    updatedAt: now,
  });
  await db.sentenceVocabulary.add({
    id: `${id}-link`,
    sentenceId: id,
    vocabularyItemId: vocabId,
    surfaceForm: '食べる',
    createdAt: now,
    updatedAt: now,
  });
  await db.studyItems.add({
    id: `${id}-si`,
    subjectType: 'vocabularyItem',
    subjectId: vocabId,
    activityType: 'reading_retrieval',
    fsrsState: PROFICIENT_FSRS,
    createdAt: now,
    updatedAt: now,
  });
  if (withAudio) {
    await db.sentenceAudio.add({
      id: `${id}-audio`,
      sentenceId: id,
      sourceId: 'src',
      sourceSentenceId: `src-${id}`,
      sourceTitle: 'ref',
      mimeType: 'audio/mp3',
      durationMs: 1000,
      startMs: 0,
      endMs: 1000,
      blob: new Blob(['x'], { type: 'audio/mp3' }),
      importedAt: now,
    });
  }
}

describe('getPitchAccentDrillSentences', () => {
  beforeEach(async () => {
    resetDbForTests(`pa-drill-${createId('db')}`);
    await ensureSettings();
  });

  it('returns audio-less sentences whose confirmed vocab has pitch-accent data', async () => {
    await seedEligibleSentence('s1');
    const result = await getPitchAccentDrillSentences();
    expect(result).toHaveLength(1);
    expect(result[0]!.sentence.id).toBe('s1');
    expect(result[0]!.targets).toEqual([
      { surfaceForm: '食べる', reading: 'たべる', pitchAccentPositions: [2] },
    ]);
  });

  it('excludes sentences that have a reference recording', async () => {
    await seedEligibleSentence('s1', { withAudio: true });
    expect(await getPitchAccentDrillSentences()).toEqual([]);
  });

  it('excludes sentences whose vocabulary is not yet proficient', async () => {
    await seedEligibleSentence('s1');
    await getDb().studyItems.where('subjectId').equals('s1-vocab').modify((item) => {
      item.fsrsState = { ...item.fsrsState, state: 'learning' };
    });
    expect(await getPitchAccentDrillSentences()).toEqual([]);
  });

  it('excludes sentences whose vocabulary has no dictionary pitch-accent data', async () => {
    await seedEligibleSentence('s1');
    await getDb()
      .vocabularyItems.where('id')
      .equals('s1-vocab')
      .modify((item) => {
        item.pitchAccentPositions = undefined;
      });
    expect(await getPitchAccentDrillSentences()).toEqual([]);
  });

  it('orders by reading position', async () => {
    await seedEligibleSentence('s2');
    await seedEligibleSentence('s1');
    const result = await getPitchAccentDrillSentences();
    expect(result.map((entry) => entry.sentence.id)).toEqual(['s1', 's2']);
  });
});
