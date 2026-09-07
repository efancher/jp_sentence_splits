import { beforeEach, describe, expect, it } from 'vitest';

import { ensureSettings, resetDbForTests } from '../src/db/database';
import {
  getDb,
  getPitchAccentDrillSentences,
  getPitchAccentDrillWords,
} from '../src/db/repository';
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

describe('getPitchAccentDrillWords', () => {
  beforeEach(async () => {
    resetDbForTests(`pa-drill-words-${createId('db')}`);
    await ensureSettings();
  });

  it('returns proficient pitch-carrying words even when the sentence has reference audio', async () => {
    await seedEligibleSentence('s1', { withAudio: true });
    const result = await getPitchAccentDrillWords();
    expect(result).toHaveLength(1);
    expect(result[0]!.vocabularyItem.id).toBe('s1-vocab');
    expect(result[0]!.surfaceForm).toBe('食べる');
    expect(result[0]!.sentence.id).toBe('s1');
  });

  it('excludes words with no dictionary pitch-accent data', async () => {
    await seedEligibleSentence('s1');
    await getDb()
      .vocabularyItems.where('id')
      .equals('s1-vocab')
      .modify((item) => {
        item.pitchAccentPositions = undefined;
      });
    expect(await getPitchAccentDrillWords()).toEqual([]);
  });

  it('excludes words not yet reviewed to proficiency', async () => {
    await seedEligibleSentence('s1');
    await getDb()
      .studyItems.where('subjectId')
      .equals('s1-vocab')
      .modify((item) => {
        item.fsrsState = { ...item.fsrsState, state: 'learning' };
      });
    expect(await getPitchAccentDrillWords()).toEqual([]);
  });

  it('includes the trailing bunsetsu particle and prefers an occurrence that has one', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.vocabularyItems.add({
      id: 'vocab-inu',
      expression: '犬',
      reading: 'いぬ',
      meaning: 'dog',
      pitchAccentPositions: [2],
      createdAt: now,
      updatedAt: now,
    });
    await db.studyItems.add({
      id: 'si-inu',
      subjectType: 'vocabularyItem',
      subjectId: 'vocab-inu',
      activityType: 'reading_retrieval',
      fsrsState: PROFICIENT_FSRS,
      createdAt: now,
      updatedAt: now,
    });
    // Earliest occurrence: no particle (犬。). Later occurrence: 犬が.
    for (const [id, japanese, index] of [
      ['inu-bare', '犬。', 0],
      ['inu-ga', '犬が好き。', 3],
    ] as const) {
      await db.sentences.add({
        id,
        normalizedKey: id,
        japanese,
        readingOnly: '',
        inlineReading: '',
        translation: '',
        targetVocabulary: [],
        vocabularySuggestions: [],
        sourceReferences: [],
        conflicts: [],
        firstOccurrenceIndex: index,
        importBatchIds: [],
        createdAt: now,
        updatedAt: now,
      });
      await db.sentenceVocabulary.add({
        id: `${id}-link`,
        sentenceId: id,
        vocabularyItemId: 'vocab-inu',
        surfaceForm: '犬',
        createdAt: now,
        updatedAt: now,
      });
    }

    const result = await getPitchAccentDrillWords();
    expect(result).toHaveLength(1);
    expect(result[0]!.sentence.id).toBe('inu-ga');
    expect(result[0]!.followingParticle).toBe('が');
  });

  it('returns one entry per distinct word, ordered by the example sentence position', async () => {
    await seedEligibleSentence('s2');
    await seedEligibleSentence('s1');
    // A third sentence reusing s1's word — should not add a second entry.
    const now = new Date().toISOString();
    await getDb().sentences.add({
      id: 's3',
      normalizedKey: 's3',
      japanese: 's3を食べる。',
      readingOnly: '',
      inlineReading: '',
      translation: 'eat it',
      targetVocabulary: [],
      vocabularySuggestions: [],
      sourceReferences: [],
      conflicts: [],
      firstOccurrenceIndex: 5,
      importBatchIds: [],
      createdAt: now,
      updatedAt: now,
    });
    await getDb().sentenceVocabulary.add({
      id: 's3-link',
      sentenceId: 's3',
      vocabularyItemId: 's1-vocab',
      surfaceForm: '食べる',
      createdAt: now,
      updatedAt: now,
    });

    const result = await getPitchAccentDrillWords();
    expect(result.map((entry) => entry.vocabularyItem.id)).toEqual(['s1-vocab', 's2-vocab']);
  });
});
