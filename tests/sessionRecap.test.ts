import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import {
  addMinutesToTodaySession,
  ensureStudyItem,
  getSessionRecap,
  getDb,
  recordReview,
  setSentenceGrammarReviewStatus,
} from '../src/db/repository';
import type {
  SessionRecapInput,
  SessionRecapReviewInput,
  SessionRecapStepInput,
} from '../src/lib/sessionRecap';
import { buildSessionRecap } from '../src/lib/sessionRecap';
import { createId } from '../src/lib/ids';

function baseInput(overrides: Partial<SessionRecapInput> = {}): SessionRecapInput {
  return {
    windowStart: '2026-09-03T08:00:00.000Z',
    windowEnd: '2026-09-03T09:00:00.000Z',
    steps: [],
    reviews: [],
    vocabularyStudyItems: [],
    grammarNoticed: 0,
    ...overrides,
  };
}

const step = (
  bucket: SessionRecapStepInput['bucket'],
  status: SessionRecapStepInput['status'],
): SessionRecapStepInput => ({ bucket, status });

const review = (
  studyItemId: string,
  timestamp: string,
  rating: SessionRecapReviewInput['rating'],
  source?: SessionRecapReviewInput['source'],
): SessionRecapReviewInput => ({ studyItemId, timestamp, rating, source });

describe('buildSessionRecap', () => {
  it('is empty when nothing measurable happened', () => {
    const recap = buildSessionRecap(
      baseInput({ steps: [step('review', 'skipped'), step('glossing', 'pending')] }),
    );
    expect(recap.isEmpty).toBe(true);
  });

  it('counts completed activities per bucket in a fixed order', () => {
    const recap = buildSessionRecap(
      baseInput({
        steps: [
          step('review', 'completed'),
          step('review', 'skipped'),
          step('glossing', 'completed'),
          step('shadowing', 'pending'),
        ],
      }),
    );
    expect(recap.activitiesCompleted).toBe(2);
    expect(recap.activitiesTotal).toBe(4);
    expect(recap.byBucket).toEqual([
      { bucket: 'glossing', completed: 1, total: 1 },
      { bucket: 'shadowing', completed: 0, total: 1 },
      { bucket: 'review', completed: 1, total: 2 },
    ]);
  });

  it('counts scheduled reviews in the window and their recall rate', () => {
    const recap = buildSessionRecap(
      baseInput({
        reviews: [
          review('si-1', '2026-09-03T08:10:00.000Z', 'good'),
          review('si-2', '2026-09-03T08:20:00.000Z', 'again'),
          review('si-3', '2026-09-03T08:30:00.000Z', 'easy'),
          // natural encounter — excluded
          review('si-4', '2026-09-03T08:40:00.000Z', 'good', 'natural_encounter'),
          // outside the window — excluded
          review('si-5', '2026-09-03T07:00:00.000Z', 'good'),
        ],
      }),
    );
    expect(recap.reviews).toEqual({ graded: 3, recalled: 2, accuracy: 2 / 3 });
  });

  it('counts a vocabulary item as new only when its first-ever review is in the window', () => {
    const recap = buildSessionRecap(
      baseInput({
        reviews: [
          // si-new: first review is in-window
          review('si-new', '2026-09-03T08:15:00.000Z', 'good'),
          // si-old: earlier review before the window, so not "new" today
          review('si-old', '2026-09-01T08:00:00.000Z', 'good'),
          review('si-old', '2026-09-03T08:15:00.000Z', 'good'),
        ],
        vocabularyStudyItems: [
          { id: 'si-new', subjectId: 'vocab-a', subjectType: 'vocabularyItem' },
          { id: 'si-old', subjectId: 'vocab-b', subjectType: 'vocabularyItem' },
          { id: 'si-sentence', subjectId: 'sent-a', subjectType: 'sentence' },
        ],
      }),
    );
    expect(recap.newWords).toBe(1);
  });

  it('passes grammarNoticed straight through', () => {
    expect(buildSessionRecap(baseInput({ grammarNoticed: 2 })).grammarNoticed).toBe(2);
  });
});

describe('getSessionRecap (repository)', () => {
  beforeEach(() => {
    resetDbForTests(`session-recap-${createId('db')}`);
  });

  it('windows evidence to the session and surfaces grammar noticed', async () => {
    const db = getDb();
    const session = await addMinutesToTodaySession(20);

    // A scheduled review inside the session window.
    const studyItem = await ensureStudyItem('vocabularyItem', 'vocab-1', 'reading_retrieval');
    await recordReview({ studyItemId: studyItem.id, rating: 'good' });

    // Mark a sentence's grammar reviewed — bumps analyses.updatedAt into the window.
    await db.sentences.add({
      id: 'sent-1',
      normalizedKey: 'sent-1',
      japanese: '猫が寝ています。',
      readingOnly: '',
      inlineReading: '',
      translation: '',
      targetVocabulary: [],
      vocabularySuggestions: [],
      sourceReferences: [],
      conflicts: [],
      firstOccurrenceIndex: 0,
      importBatchIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);
    await setSentenceGrammarReviewStatus('sent-1', 'confirmed');

    const recap = await getSessionRecap(session);
    expect(recap.reviews.graded).toBe(1);
    expect(recap.reviews.recalled).toBe(1);
    expect(recap.newWords).toBe(1);
    expect(recap.grammarNoticed).toBe(1);
  });
});
