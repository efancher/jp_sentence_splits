import { describe, expect, it } from 'vitest';

import type { ReviewTroubleLog } from '../src/domain/types';
import { buildReviewTroubleReport } from '../src/lib/reviewTroubleReport';

function log(overrides: Partial<ReviewTroubleLog> & Pick<ReviewTroubleLog, 'id'>): ReviewTroubleLog {
  return {
    timestamp: '2026-10-21T10:00:00.000Z',
    studyItemId: 'item-1',
    sentenceId: 'sent-1',
    rating: 'hard',
    tags: ['reading'],
    queued: { freshTry: true, shadow: false },
    ...overrides,
  };
}

describe('buildReviewTroubleReport', () => {
  it('reports no data without logs', () => {
    const report = buildReviewTroubleReport({ logs: [], reviews: [], expressionAttempts: [], shadowAttempts: [] });
    expect(report.hasData).toBe(false);
    expect(report.tags.every((row) => row.count === 0)).toBe(true);
  });

  it('counts tags, tag rate and follow-up completion', () => {
    const report = buildReviewTroubleReport({
      logs: [
        log({ id: 'a', tags: ['reading', 'sound'], queued: { freshTry: true, shadow: true } }),
        log({ id: 'b', studyItemId: 'item-2', sentenceId: 'sent-2', tags: ['sound'], queued: { freshTry: false, shadow: true } }),
        // Tagged but nothing queued (sentence not walked through yet).
        log({ id: 'c', studyItemId: 'item-3', sentenceId: 'sent-3', tags: ['meaning'], queued: { freshTry: false, shadow: false } }),
      ],
      reviews: [
        { studyItemId: 'item-1', timestamp: '2026-10-21T10:00:00.000Z', rating: 'hard' },
        { studyItemId: 'item-9', timestamp: '2026-10-21T11:00:00.000Z', rating: 'again' },
        { studyItemId: 'item-8', timestamp: '2026-10-21T12:00:00.000Z', rating: 'good' },
        { studyItemId: 'item-7', timestamp: '2026-10-20T12:00:00.000Z', rating: 'again' },
      ],
      expressionAttempts: [{ sentenceId: 'sent-1', timestamp: '2026-10-21T12:00:00.000Z' }],
      shadowAttempts: [{ sentenceId: 'sent-2', timestamp: '2026-10-21T13:00:00.000Z' }],
    });
    expect(report.taggedReviews).toBe(3);
    expect(Object.fromEntries(report.tags.map((row) => [row.tag, row.count]))).toEqual({
      reading: 1,
      meaning: 1,
      kanji: 0,
      sound: 2,
    });
    expect(report.freshTry).toEqual({ queued: 1, done: 1 });
    expect(report.shadow).toEqual({ queued: 2, done: 1 });
    // Misses since the first tag (the 10-20 one is before it, so excluded): item-1 and item-9.
    expect(report.missReviews).toBe(2);
    expect(report.taggedMisses).toBe(3);
  });

  it('splits next-review outcomes by whether every queued follow-up came first', () => {
    const report = buildReviewTroubleReport({
      logs: [
        log({ id: 'done', studyItemId: 'item-1', sentenceId: 'sent-1' }),
        log({ id: 'late', studyItemId: 'item-2', sentenceId: 'sent-2' }),
        log({ id: 'never', studyItemId: 'item-3', sentenceId: 'sent-3' }),
        log({ id: 'no-next', studyItemId: 'item-4', sentenceId: 'sent-4' }),
      ],
      reviews: [
        { studyItemId: 'item-1', timestamp: '2026-10-25T10:00:00.000Z', rating: 'good' },
        { studyItemId: 'item-2', timestamp: '2026-10-25T10:00:00.000Z', rating: 'hard' },
        { studyItemId: 'item-3', timestamp: '2026-10-25T10:00:00.000Z', rating: 'easy' },
      ],
      expressionAttempts: [
        { sentenceId: 'sent-1', timestamp: '2026-10-22T10:00:00.000Z' },
        // After the next review, so it does not count as "before".
        { sentenceId: 'sent-2', timestamp: '2026-10-26T10:00:00.000Z' },
      ],
      shadowAttempts: [],
    });
    expect(report.followedUp).toEqual({ n: 1, nextGoodOrEasy: 1 });
    expect(report.notFollowedUp).toEqual({ n: 2, nextGoodOrEasy: 1 });
  });
});
