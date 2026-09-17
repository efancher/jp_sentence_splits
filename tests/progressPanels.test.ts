import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addSentencesToBook,
  confirmSentenceVocabulary,
  createBook,
  ensureStudyItem,
  getDb,
  getFsrsConfidenceSnapshot,
  getGateFunnelSnapshot,
  getLeechList,
  getSelfRatingCalibration,
  getSkillCoverage,
  getStepUsefulness,
  recordReview,
  setBookSentenceStatus,
} from '../src/db/repository';
import type { PlannerSession, Sentence, VocabularySelection } from '../src/domain/types';
import { createId } from '../src/lib/ids';

function makeSentence(overrides: Partial<Sentence> = {}): Sentence {
  const timestamp = new Date().toISOString();
  const id = overrides.id ?? createId('sent');
  return {
    id,
    normalizedKey: id,
    japanese: '猫が寝ています。',
    readingOnly: 'ねこがねています。',
    inlineReading: '',
    translation: 'The cat is sleeping.',
    targetVocabulary: [],
    vocabularySuggestions: [],
    sourceReferences: [],
    conflicts: [],
    firstOccurrenceIndex: 0,
    importBatchIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function makeSelection(overrides: Partial<VocabularySelection> = {}): VocabularySelection {
  return {
    id: createId('vocab_selection'),
    surface: '皆',
    start: 0,
    end: 1,
    expression: '皆',
    reading: 'みな',
    source: 'manual',
    ...overrides,
  };
}

async function advanceToProficient(vocabularyItemId: string, activityType: string) {
  const item = await ensureStudyItem('vocabularyItem', vocabularyItemId, activityType);
  let studyItemId = item.id;
  for (let i = 0; i < 3; i += 1) {
    const day = new Date(Date.now() + i * 30 * 24 * 60 * 60 * 1000);
    const result = await recordReview({ studyItemId, rating: 'good', now: day });
    studyItemId = result.studyItem.id;
  }
}

describe('getSelfRatingCalibration', () => {
  beforeEach(() => {
    resetDbForTests(`progress-panels-${createId('db')}`);
  });

  it('joins reviews through their study item to compute pass rates per group', async () => {
    const selfRated = await ensureStudyItem('sentence', 'sent-a', 'reading_in_context');
    await recordReview({ studyItemId: selfRated.id, rating: 'good' });
    await recordReview({ studyItemId: selfRated.id, rating: 'again' });

    const graded = await ensureStudyItem('vocabularyItem', 'vi-a', 'reading_production');
    await recordReview({ studyItemId: graded.id, rating: 'good' });

    const result = await getSelfRatingCalibration();
    expect(result.hasData).toBe(true);
    expect(result.selfRated.reviewCount).toBe(2);
    expect(result.selfRated.passRate).toBeCloseTo(0.5);
    expect(result.graded.reviewCount).toBe(1);
    expect(result.graded.passRate).toBe(1);
  });
});

describe('getSkillCoverage', () => {
  beforeEach(() => {
    resetDbForTests(`progress-panels-${createId('db')}`);
  });

  it('measures production/pitch/word-listening coverage of recognized words', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.vocabularyItems.bulkAdd([
      { id: 'vi-1', expression: '一', reading: 'いち', meaning: 'one', createdAt: now, updatedAt: now },
      { id: 'vi-2', expression: '二', reading: 'に', meaning: 'two', createdAt: now, updatedAt: now },
    ]);
    // vi-1: recognized + production-proficient + word-listening-proficient.
    await advanceToProficient('vi-1', 'reading_retrieval');
    await advanceToProficient('vi-1', 'reading_production');
    await db.sentenceVocabulary.add({
      id: 'sv-1',
      sentenceId: 'sent-1',
      vocabularyItemId: 'vi-1',
      surfaceForm: '一',
      createdAt: now,
      updatedAt: now,
    });
    const wordListeningItem = await ensureStudyItem('sentenceVocabulary', 'sv-1', 'word_listening');
    let studyItemId = wordListeningItem.id;
    for (let i = 0; i < 3; i += 1) {
      const result = await recordReview({
        studyItemId,
        rating: 'good',
        now: new Date(Date.now() + i * 30 * 24 * 60 * 60 * 1000),
      });
      studyItemId = result.studyItem.id;
    }
    // vi-2: recognized only, nothing else.
    await advanceToProficient('vi-2', 'cloze');

    const result = await getSkillCoverage();
    expect(result.recognized).toBe(2);
    const production = result.rungs.find((r) => r.label === 'Can produce the reading')!;
    expect(production.count).toBe(1);
    const heard = result.rungs.find((r) => r.label === 'Heard successfully in a sentence')!;
    expect(heard.count).toBe(1);
  });
});

describe('getFsrsConfidenceSnapshot', () => {
  beforeEach(() => {
    resetDbForTests(`progress-panels-${createId('db')}`);
  });

  it('excludes new items and buckets active ones by predicted retrievability', async () => {
    await ensureStudyItem('vocabularyItem', 'vi-new', 'reading_retrieval'); // stays 'new'
    await advanceToProficient('vi-proficient', 'reading_retrieval'); // pushed to 'review'

    const result = await getFsrsConfidenceSnapshot();
    expect(result.hasData).toBe(true);
    expect(result.activeCount).toBe(1);
    expect(result.averageRetrievability).not.toBeNull();
  });

  it('reports no data when every study item is still new', async () => {
    await ensureStudyItem('vocabularyItem', 'vi-new', 'reading_retrieval');
    const result = await getFsrsConfidenceSnapshot();
    expect(result.hasData).toBe(false);
  });

  it('does not crash on a malformed non-new item with no lastReview', async () => {
    const now = new Date().toISOString();
    await getDb().studyItems.add({
      id: 'si-malformed',
      subjectType: 'vocabularyItem',
      subjectId: 'vi-malformed',
      activityType: 'reading_retrieval',
      fsrsState: {
        due: now,
        stability: 10,
        difficulty: 5,
        elapsedDays: 0,
        scheduledDays: 5,
        learningSteps: 0,
        reps: 3,
        lapses: 0,
        state: 'review',
        // lastReview deliberately omitted.
      },
      createdAt: now,
      updatedAt: now,
    });
    const result = await getFsrsConfidenceSnapshot();
    expect(result.hasData).toBe(false);
    expect(result.activeCount).toBe(0);
  });
});

describe('getStepUsefulness', () => {
  beforeEach(() => {
    resetDbForTests(`progress-panels-${createId('db')}`);
  });

  function fixtureSession(overrides: Partial<PlannerSession> = {}): PlannerSession {
    const now = new Date().toISOString();
    return {
      id: createId('planner_session'),
      createdAt: now,
      updatedAt: now,
      date: '2026-09-16',
      targetMinutes: 30,
      allocation: { glossing: 0, grammar: 0, shadowing: 0, review: 0 },
      explanation: [],
      steps: [],
      status: 'completed',
      ...overrides,
    };
  }

  it('flattens sessions in the window and groups completed/skipped steps by targetKind', async () => {
    await getDb().plannerSessions.add(
      fixtureSession({
        steps: [
          {
            id: 's1',
            bucket: 'shadowing',
            activityType: 'shadowing_practice',
            targetKind: 'shadow',
            label: 'Shadow',
            estimatedMinutes: 5,
            reason: 'x',
            status: 'completed',
          },
          {
            id: 's2',
            bucket: 'shadowing',
            activityType: 'shadowing_practice',
            targetKind: 'shadow',
            label: 'Shadow',
            estimatedMinutes: 5,
            reason: 'x',
            status: 'skipped',
          },
        ],
      }),
    );
    const result = await getStepUsefulness({ now: new Date('2026-09-17') });
    expect(result.hasData).toBe(true);
    const shadow = result.rows.find((r) => r.targetKind === 'shadow')!;
    expect(shadow.completed).toBe(1);
    expect(shadow.skipped).toBe(1);
  });

  it('excludes sessions outside the window', async () => {
    await getDb().plannerSessions.add(
      fixtureSession({
        date: '2020-01-01',
        steps: [
          {
            id: 's1',
            bucket: 'shadowing',
            activityType: 'shadowing_practice',
            targetKind: 'shadow',
            label: 'Shadow',
            estimatedMinutes: 5,
            reason: 'x',
            status: 'completed',
          },
        ],
      }),
    );
    const result = await getStepUsefulness({ windowDays: 56, now: new Date('2026-09-17') });
    expect(result.hasData).toBe(false);
  });
});

describe('getGateFunnelSnapshot', () => {
  beforeEach(() => {
    resetDbForTests(`progress-panels-${createId('db')}`);
  });

  it('counts a confirmed sentence whose word has never been reviewed as continue_book-blocked', async () => {
    const book = await createBook({ title: 'Book' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);
    await confirmSentenceVocabulary(sentence.id, [makeSelection()]);

    const result = await getGateFunnelSnapshot();
    expect(result.continueBookBlocked).toBe(1);
  });

  it('does not count a confirmed sentence once its word has been reviewed once', async () => {
    const book = await createBook({ title: 'Book' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);
    await confirmSentenceVocabulary(sentence.id, [makeSelection()]);
    const link = await db.sentenceVocabulary.where('sentenceId').equals(sentence.id).first();
    const item = await ensureStudyItem('vocabularyItem', link!.vocabularyItemId, 'reading_retrieval');
    await recordReview({ studyItemId: item.id, rating: 'good' });

    const result = await getGateFunnelSnapshot();
    expect(result.continueBookBlocked).toBe(0);
  });

  it('counts an in-progress, audio-bearing, reading-proficient sentence blocked only on pitch', async () => {
    const book = await createBook({ title: 'Book' });
    const db = getDb();
    const sentence = makeSentence();
    await db.sentences.put(sentence);
    await addSentencesToBook(book.id, [sentence.id]);
    await setBookSentenceStatus(book.id, sentence.id, 'in_progress');
    await db.sentenceAudio.add({
      id: 'audio-1',
      sentenceId: sentence.id,
      sourceId: 'src',
      sourceSentenceId: 'src-sent',
      sourceTitle: 'Source',
      mimeType: 'audio/mp3',
      durationMs: 1000,
      startMs: 0,
      endMs: 1000,
      blob: new Blob(['x'], { type: 'audio/mp3' }),
      importedAt: new Date().toISOString(),
    });
    await confirmSentenceVocabulary(sentence.id, [makeSelection()]);
    const link = await db.sentenceVocabulary.where('sentenceId').equals(sentence.id).first();
    const vocabularyItemId = link!.vocabularyItemId;
    await db.vocabularyItems.update(vocabularyItemId, { pitchAccentPositions: [1] });
    await advanceToProficient(vocabularyItemId, 'reading_retrieval');

    const result = await getGateFunnelSnapshot();
    expect(result.shadowBlockedOnPitch).toBe(1);

    // Once pitch is proficient too, it drops out of the blocked count.
    await advanceToProficient(vocabularyItemId, 'pitch_accent');
    const after = await getGateFunnelSnapshot();
    expect(after.shadowBlockedOnPitch).toBe(0);
  });
});

describe('getLeechList', () => {
  beforeEach(() => {
    resetDbForTests(`progress-panels-${createId('db')}`);
  });

  it('excludes an item with recent misses but no real FSRS lapse yet', async () => {
    const item = await ensureStudyItem('vocabularyItem', 'vi-new', 'reading_production');
    await recordReview({
      studyItemId: item.id,
      rating: 'again',
      responseRaw: 'たべる',
      expectedAnswer: 'たべた',
    });
    const result = await getLeechList();
    expect(result.hasData).toBe(false);
  });

  it('surfaces a lapsed item with its subject label and most common recent error reason', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.vocabularyItems.add({
      id: 'vi-1',
      expression: '食べる',
      reading: 'たべる',
      meaning: 'to eat',
      createdAt: now,
      updatedAt: now,
    });
    const item = await ensureStudyItem('vocabularyItem', 'vi-1', 'reading_production');
    await advanceToProficient('vi-1', 'reading_production'); // -> FSRS 'review' state
    // A real lapse: failing from 'review' state.
    await recordReview({
      studyItemId: item.id,
      rating: 'again',
      responseRaw: 'たべる',
      expectedAnswer: 'たべた',
      now: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000),
    });

    const result = await getLeechList();
    expect(result.hasData).toBe(true);
    const row = result.rows.find((r) => r.studyItemId === item.id);
    expect(row).toBeDefined();
    expect(row!.lapses).toBeGreaterThan(0);
    expect(row!.subjectLabel).toBe('食べる (たべる)');
    expect(row!.reasonLabel).toBe('Wrong reading');
    expect(row!.nextAction).toBe('Drill readings');
  });

  it('respects the limit option', async () => {
    for (let i = 0; i < 3; i += 1) {
      const item = await ensureStudyItem('vocabularyItem', `vi-${i}`, 'reading_production');
      await advanceToProficient(`vi-${i}`, 'reading_production');
      await recordReview({
        studyItemId: item.id,
        rating: 'again',
        now: new Date(Date.now() + 200 * 24 * 60 * 60 * 1000),
      });
    }
    const result = await getLeechList({ limit: 2 });
    expect(result.rows).toHaveLength(2);
  });
});
