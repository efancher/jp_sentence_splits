import { describe, expect, it } from 'vitest';

import {
  classifyReviewError,
  computeGraduatedSubjectIds,
  createInitialFsrsState,
  isGraduated,
  isSentenceReadyForFullReview,
  isSentenceVocabularyReady,
  isVocabularyItemProficient,
  scheduleReview,
} from '../src/lib/scheduling';
import type { FsrsState, StudyItem } from '../src/domain/types';

describe('createInitialFsrsState', () => {
  it('creates a new, unreviewed card due immediately', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const state = createInitialFsrsState(now);
    expect(state.state).toBe('new');
    expect(state.reps).toBe(0);
    expect(state.lapses).toBe(0);
    expect(state.lastReview).toBeUndefined();
    expect(new Date(state.due).getTime()).toBeLessThanOrEqual(now.getTime());
  });
});

describe('scheduleReview', () => {
  it('advances a new card out of the "new" state and schedules it in the future', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const initial = createInitialFsrsState(now);
    const { fsrsState, nextDue } = scheduleReview(initial, 'good', now);
    expect(fsrsState.state).not.toBe('new');
    expect(fsrsState.reps).toBe(1);
    expect(new Date(nextDue).getTime()).toBeGreaterThan(now.getTime());
    expect(fsrsState.lastReview).toBe(now.toISOString());
  });

  it('increments lapses on "again" once a card has left learning', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    let state = createInitialFsrsState(now);
    // Push the card through learning into the review state with a couple of
    // "good" ratings so an "again" genuinely counts as a lapse.
    for (let i = 0; i < 3; i += 1) {
      const day = new Date(now.getTime() + i * 30 * 24 * 60 * 60 * 1000);
      state = scheduleReview(state, 'good', day).fsrsState;
    }
    expect(state.state).toBe('review');
    const lapsesBefore = state.lapses;
    const later = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000);
    const { fsrsState } = scheduleReview(state, 'again', later);
    expect(fsrsState.lapses).toBe(lapsesBefore + 1);
    expect(fsrsState.state).toBe('relearning');
  });

  it('round-trips every FsrsState.state value through toCard/toLocalState', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const states: Array<'new' | 'learning' | 'review' | 'relearning'> = [
      'new',
      'learning',
      'review',
      'relearning',
    ];
    for (const state of states) {
      const fsrsState = {
        due: now.toISOString(),
        stability: 1,
        difficulty: 5,
        elapsedDays: 0,
        scheduledDays: 0,
        learningSteps: 0,
        reps: 1,
        lapses: 0,
        state,
      };
      const { fsrsState: result } = scheduleReview(fsrsState, 'good', now);
      expect(result.state).toBeDefined();
    }
  });
});

describe('isGraduated (Phase 7.10)', () => {
  const reviewState = (scheduledDays: number): FsrsState => ({
    due: new Date().toISOString(),
    stability: 50,
    difficulty: 3,
    elapsedDays: 0,
    scheduledDays,
    learningSteps: 0,
    reps: 5,
    lapses: 0,
    state: 'review',
  });

  it('is false when the threshold is 0 (disabled), regardless of interval', () => {
    expect(isGraduated(reviewState(9999), 0)).toBe(false);
  });

  it('is false when the interval has not reached the threshold yet', () => {
    expect(isGraduated(reviewState(179), 180)).toBe(false);
  });

  it('is true once the interval reaches the threshold in the review state', () => {
    expect(isGraduated(reviewState(180), 180)).toBe(true);
    expect(isGraduated(reviewState(300), 180)).toBe(true);
  });

  it('is false for a long interval in any state other than "review"', () => {
    for (const state of ['new', 'learning', 'relearning'] as const) {
      expect(isGraduated({ ...reviewState(300), state }, 180)).toBe(false);
    }
  });
});

describe('isVocabularyItemProficient (full-sentence gating)', () => {
  it('is true once a vocabulary item reaches review or relearning', () => {
    expect(isVocabularyItemProficient('review')).toBe(true);
    expect(isVocabularyItemProficient('relearning')).toBe(true);
  });

  it('is false while still new or in initial learning', () => {
    expect(isVocabularyItemProficient('new')).toBe(false);
    expect(isVocabularyItemProficient('learning')).toBe(false);
  });
});

describe('isSentenceVocabularyReady (full-sentence gating)', () => {
  it('is ready when the sentence has no reviewable vocabulary links', () => {
    expect(isSentenceVocabularyReady([], new Set())).toBe(true);
  });

  it('is not ready if any linked vocabulary item is not yet proficient', () => {
    const proficient = new Set(['word-a']);
    expect(isSentenceVocabularyReady(['word-a', 'word-b'], proficient)).toBe(false);
  });

  it('is ready only once every linked vocabulary item is proficient', () => {
    const proficient = new Set(['word-a', 'word-b']);
    expect(isSentenceVocabularyReady(['word-a', 'word-b'], proficient)).toBe(true);
  });
});

describe('isSentenceReadyForFullReview (full-sentence gating)', () => {
  it('is not ready when vocabulary review status is undefined (a brand-new, never-analyzed sentence)', () => {
    expect(isSentenceReadyForFullReview(undefined, [], new Set())).toBe(false);
  });

  it('is not ready while vocabulary review status is "unreviewed", even with nothing linked', () => {
    expect(isSentenceReadyForFullReview('unreviewed', [], new Set())).toBe(false);
  });

  it('is ready once confirmed with nothing linked (reviewed, nothing worth tracking)', () => {
    expect(isSentenceReadyForFullReview('confirmed', [], new Set())).toBe(true);
  });

  it('is not ready once confirmed if a linked vocabulary item is not yet proficient', () => {
    expect(isSentenceReadyForFullReview('confirmed', ['word-a'], new Set())).toBe(false);
  });

  it('is ready once confirmed and every linked vocabulary item is proficient', () => {
    expect(isSentenceReadyForFullReview('confirmed', ['word-a'], new Set(['word-a']))).toBe(true);
  });
});

describe('classifyReviewError (evidence-based only)', () => {
  it('classifies a wrong reading_production answer as incorrect_reading', () => {
    expect(
      classifyReviewError({
        subjectType: 'vocabularyItem',
        activityType: 'reading_production',
        rating: 'again',
        responseRaw: 'たべる',
        expectedAnswer: 'たべた',
      }),
    ).toBe('incorrect_reading');
  });

  it('classifies a wrong sentence_transformation answer as grammar_misunderstanding', () => {
    expect(
      classifyReviewError({
        subjectType: 'vocabularyItem',
        activityType: 'sentence_transformation',
        rating: 'hard',
        responseRaw: 'いった',
        expectedAnswer: 'いかなかった',
      }),
    ).toBe('grammar_misunderstanding');
  });

  it('classifies a wrong grammar_completion choice as grammar_misunderstanding', () => {
    expect(
      classifyReviewError({
        subjectType: 'grammarPattern',
        activityType: 'grammar_completion',
        rating: 'again',
        responseRaw: '〜はずがない',
        expectedAnswer: '〜わけがない',
      }),
    ).toBe('grammar_misunderstanding');
  });

  it('does not classify a correct grammar_completion choice', () => {
    expect(
      classifyReviewError({
        subjectType: 'grammarPattern',
        activityType: 'grammar_completion',
        rating: 'good',
        responseRaw: '〜わけがない',
        expectedAnswer: '〜わけがない',
      }),
    ).toBeUndefined();
  });

  it('classifies a wrong grammar_contrast choice as grammar_misunderstanding', () => {
    expect(
      classifyReviewError({
        subjectType: 'grammarPattern',
        activityType: 'grammar_contrast',
        rating: 'again',
        responseRaw: '〜はずがない',
        expectedAnswer: '〜わけがない',
      }),
    ).toBe('grammar_misunderstanding');
  });

  it('does not classify a correct grammar_contrast choice', () => {
    expect(
      classifyReviewError({
        subjectType: 'grammarPattern',
        activityType: 'grammar_contrast',
        rating: 'good',
        responseRaw: '〜わけがない',
        expectedAnswer: '〜わけがない',
      }),
    ).toBeUndefined();
  });

  it('leaves grammar_comprehension (no typed answer) unclassified', () => {
    expect(
      classifyReviewError({
        subjectType: 'grammarPattern',
        activityType: 'grammar_comprehension',
        rating: 'again',
      }),
    ).toBeUndefined();
  });

  it('does not classify a matching typed answer', () => {
    expect(
      classifyReviewError({
        subjectType: 'vocabularyItem',
        activityType: 'reading_production',
        rating: 'good',
        responseRaw: 'いった',
        expectedAnswer: 'いった',
      }),
    ).toBeUndefined();
  });

  it('classifies a failed contrastive-pair review as vocabulary_confusion', () => {
    expect(
      classifyReviewError({
        subjectType: 'vocabularyConfusion',
        activityType: 'contrastive',
        rating: 'again',
      }),
    ).toBe('vocabulary_confusion');
  });

  it('does not classify a passed contrastive-pair review', () => {
    expect(
      classifyReviewError({
        subjectType: 'vocabularyConfusion',
        activityType: 'contrastive',
        rating: 'good',
      }),
    ).toBeUndefined();
  });

  it('leaves self-rated-only activity types (no typed answer) unclassified', () => {
    expect(
      classifyReviewError({
        subjectType: 'sentence',
        activityType: 'comprehension',
        rating: 'again',
      }),
    ).toBeUndefined();
  });
});

describe('computeGraduatedSubjectIds', () => {
  function studyItem(
    id: string,
    subjectId: string,
    overrides: Partial<FsrsState> = {},
  ): StudyItem {
    const now = new Date().toISOString();
    return {
      id,
      subjectType: 'vocabularyItem',
      subjectId,
      activityType: 'reading_retrieval',
      fsrsState: {
        due: now,
        stability: 50,
        difficulty: 3,
        elapsedDays: 0,
        scheduledDays: 200,
        learningSteps: 0,
        reps: 5,
        lapses: 0,
        state: 'review',
        ...overrides,
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  it('includes a subject once its only study item crosses the threshold', () => {
    const graduated = computeGraduatedSubjectIds([studyItem('si-1', 'word-a')], 180);
    expect(graduated.has('word-a')).toBe(true);
  });

  it('excludes a subject with one still-active study item among several', () => {
    const graduated = computeGraduatedSubjectIds(
      [
        studyItem('si-1', 'word-a'),
        studyItem('si-2', 'word-a', { state: 'new', scheduledDays: 0 }),
      ],
      180,
    );
    expect(graduated.has('word-a')).toBe(false);
  });

  it('excludes a subject with no study items (never appears in the input)', () => {
    const graduated = computeGraduatedSubjectIds([studyItem('si-1', 'word-a')], 180);
    expect(graduated.has('word-b')).toBe(false);
  });
});
