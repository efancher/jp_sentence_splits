import { describe, expect, it } from 'vitest';

import {
  buildProgressReport,
  startOfWeekUtc,
  type ProgressReportInput,
  type ProgressReviewInput,
  type ProgressStudyItemInput,
} from '../src/lib/progressReport';

const NOW = new Date('2026-09-01T12:00:00.000Z'); // a Tuesday

const NO_SHADOWING = {
  attemptsAnalyzed: 0,
  sentencesPracticed: 0,
  timingTrend: 'insufficient_data' as const,
  pitchTrend: 'insufficient_data' as const,
};

function studyItem(overrides: Partial<ProgressStudyItemInput>): ProgressStudyItemInput {
  return {
    id: 'si',
    subjectId: 'subj',
    subjectType: 'vocabularyItem',
    activityType: 'reading_retrieval',
    createdAt: '2026-08-01T00:00:00.000Z',
    state: 'review',
    scheduledDays: 5,
    ...overrides,
  };
}

function review(overrides: Partial<ProgressReviewInput>): ProgressReviewInput {
  return {
    studyItemId: 'si',
    timestamp: '2026-08-20T00:00:00.000Z',
    rating: 'good',
    ...overrides,
  };
}

function run(overrides: Partial<ProgressReportInput>) {
  return buildProgressReport({
    now: NOW,
    reviews: [],
    studyItems: [],
    shadowing: NO_SHADOWING,
    ...overrides,
  });
}

describe('startOfWeekUtc', () => {
  it('returns the Monday of the containing week', () => {
    expect(startOfWeekUtc(new Date('2026-09-01T12:00:00.000Z'))).toBe('2026-08-31');
    expect(startOfWeekUtc(new Date('2026-08-31T00:00:00.000Z'))).toBe('2026-08-31');
    expect(startOfWeekUtc(new Date('2026-08-30T23:59:00.000Z'))).toBe('2026-08-24');
  });
});

describe('buildProgressReport', () => {
  it('reports no data for an empty history', () => {
    const report = run({});
    expect(report.hasData).toBe(false);
    expect(report.vocabulary).toEqual({
      tracked: 0,
      proficient: 0,
      mature: 0,
      learnedInWindow: 0,
    });
    expect(report.retention.windowRate).toBeNull();
    expect(report.weeks).toHaveLength(8);
  });

  it('counts tracked / proficient / mature vocabulary', () => {
    const report = run({
      studyItems: [
        studyItem({ id: 'a1', subjectId: 'w-new', state: 'learning' }),
        studyItem({ id: 'b1', subjectId: 'w-prof', state: 'review', scheduledDays: 5 }),
        studyItem({ id: 'c1', subjectId: 'w-mature', state: 'review', scheduledDays: 40 }),
        studyItem({
          id: 'c2',
          subjectId: 'w-mature',
          activityType: 'cloze',
          state: 'review',
          scheduledDays: 30,
        }),
        // second activity still short -> not mature overall
        studyItem({ id: 'd1', subjectId: 'w-mixed', state: 'review', scheduledDays: 40 }),
        studyItem({
          id: 'd2',
          subjectId: 'w-mixed',
          activityType: 'cloze',
          state: 'review',
          scheduledDays: 2,
        }),
      ],
    });
    expect(report.vocabulary.tracked).toBe(4);
    expect(report.vocabulary.proficient).toBe(3); // w-prof, w-mature, w-mixed
    expect(report.vocabulary.mature).toBe(1); // only w-mature
  });

  it('computes FSRS pass rate over the window and all time, excluding natural encounters', () => {
    const report = run({
      retentionWindowDays: 30,
      studyItems: [studyItem({ id: 'si', subjectId: 'w1' })],
      reviews: [
        review({ timestamp: '2026-08-25T00:00:00.000Z', rating: 'good' }),
        review({ timestamp: '2026-08-26T00:00:00.000Z', rating: 'again' }),
        review({ timestamp: '2026-08-27T00:00:00.000Z', rating: 'hard' }),
        // outside the 30-day window
        review({ timestamp: '2026-07-01T00:00:00.000Z', rating: 'again' }),
        // natural encounter, never counted
        review({
          timestamp: '2026-08-28T00:00:00.000Z',
          rating: 'again',
          source: 'natural_encounter',
        }),
      ],
    });
    expect(report.retention.scheduledReviews).toBe(3);
    expect(report.retention.recalled).toBe(2);
    expect(report.retention.windowRate).toBeCloseTo(2 / 3);
    expect(report.retention.allTimeRate).toBeCloseTo(2 / 4);
  });

  it('counts tracked and recognized grammar patterns', () => {
    const report = run({
      studyItems: [
        studyItem({
          id: 'g1',
          subjectId: 'p1',
          subjectType: 'grammarPattern',
          activityType: 'grammar_comprehension',
          state: 'review',
        }),
        studyItem({
          id: 'g2',
          subjectId: 'p1',
          subjectType: 'grammarPattern',
          activityType: 'grammar_completion',
          state: 'learning',
        }),
        studyItem({
          id: 'g3',
          subjectId: 'p2',
          subjectType: 'grammarPattern',
          activityType: 'grammar_comprehension',
          state: 'learning',
        }),
      ],
    });
    expect(report.grammar.tracked).toBe(2);
    expect(report.grammar.recognized).toBe(1);
  });

  it('builds a cumulative words-learned trend from first passing reviews', () => {
    const report = run({
      weeks: 4,
      studyItems: [
        studyItem({ id: 'x1', subjectId: 'wx', state: 'review' }),
        studyItem({ id: 'y1', subjectId: 'wy', state: 'review' }),
        studyItem({ id: 'z1', subjectId: 'wz', state: 'review' }),
      ],
      reviews: [
        // wx first recalled before the 4-week window -> baseline
        review({ studyItemId: 'x1', timestamp: '2026-07-01T00:00:00.000Z', rating: 'good' }),
        // wy recalled in the week of Aug 17
        review({ studyItemId: 'y1', timestamp: '2026-08-19T00:00:00.000Z', rating: 'again' }),
        review({ studyItemId: 'y1', timestamp: '2026-08-20T00:00:00.000Z', rating: 'good' }),
        // wz recalled in the final week
        review({ studyItemId: 'z1', timestamp: '2026-08-31T12:00:00.000Z', rating: 'easy' }),
      ],
    });
    // weeks start Aug 10 / 17 / 24 / 31; wx is baseline, wy lands in week 2,
    // wz in the final week.
    expect(report.weeks.map((w) => w.cumulativeWordsLearned)).toEqual([1, 2, 2, 3]);
    expect(report.weeks.at(-1)!.wordsLearned).toBe(1);
    expect(report.vocabulary.learnedInWindow).toBe(2); // wy, wz within 30 days
  });

  it('tallies reviews per week', () => {
    const report = run({
      weeks: 2,
      studyItems: [studyItem({ id: 'si', subjectId: 'w1' })],
      reviews: [
        review({ timestamp: '2026-08-25T00:00:00.000Z' }),
        review({ timestamp: '2026-08-26T00:00:00.000Z' }),
        review({ timestamp: '2026-08-31T00:00:00.000Z' }),
      ],
    });
    expect(report.weeks.map((w) => w.reviews)).toEqual([2, 1]);
  });
});
