import { describe, expect, it } from 'vitest';

import { buildErrorMix, type ErrorMixInput } from '../src/lib/errorMix';

const NOW = new Date('2026-09-08T12:00:00.000Z');

function baseInput(overrides: Partial<ErrorMixInput> = {}): ErrorMixInput {
  return {
    now: NOW,
    windowDays: 30,
    reviews: [],
    weakWords: [],
    pronunciationHeadline: null,
    pronunciationTopFocus: null,
    ...overrides,
  };
}

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

describe('buildErrorMix', () => {
  it('buckets classified misses and ranks by count', () => {
    const result = buildErrorMix(
      baseInput({
        reviews: [
          { timestamp: daysAgo(1), rating: 'again', errorClassification: 'incorrect_reading' },
          { timestamp: daysAgo(2), rating: 'again', errorClassification: 'incorrect_reading' },
          {
            timestamp: daysAgo(3),
            rating: 'hard',
            errorClassification: 'grammar_misunderstanding',
          },
        ],
      }),
    );
    expect(result.categories.map((category) => category.key)).toEqual([
      'incorrect_reading',
      'grammar_misunderstanding',
    ]);
    expect(result.categories[0]).toMatchObject({
      count: 2,
      label: 'Wrong reading',
      nextAction: 'Drill readings',
      route: '/review',
    });
    expect(result.categories[0]!.shareOfClassified).toBeCloseTo(2 / 3);
    expect(result.classifiedTotal).toBe(3);
  });

  it('normalizes a userDefined classification to its string', () => {
    const result = buildErrorMix(
      baseInput({
        reviews: [
          {
            timestamp: daysAgo(1),
            rating: 'again',
            errorClassification: { userDefined: 'particle choice' },
          },
        ],
      }),
    );
    expect(result.categories[0]).toMatchObject({
      key: 'particle choice',
      label: 'particle choice',
      nextAction: 'Review these',
    });
  });

  it('counts unclassified again misses separately and excludes older ones', () => {
    const result = buildErrorMix(
      baseInput({
        windowDays: 30,
        reviews: [
          { timestamp: daysAgo(1), rating: 'again' },
          { timestamp: daysAgo(2), rating: 'again' },
          { timestamp: daysAgo(2), rating: 'good' },
          { timestamp: daysAgo(90), rating: 'again' },
        ],
      }),
    );
    expect(result.unclassifiedAgainCount).toBe(2);
    expect(result.classifiedTotal).toBe(0);
  });

  it('flags a worsening trend when recent misses outweigh earlier ones', () => {
    const result = buildErrorMix(
      baseInput({
        windowDays: 30,
        reviews: [
          { timestamp: daysAgo(28), rating: 'again', errorClassification: 'incorrect_reading' },
          { timestamp: daysAgo(3), rating: 'again', errorClassification: 'incorrect_reading' },
          { timestamp: daysAgo(2), rating: 'again', errorClassification: 'incorrect_reading' },
          { timestamp: daysAgo(1), rating: 'again', errorClassification: 'incorrect_reading' },
        ],
      }),
    );
    expect(result.categories[0]!.trend).toBe('worsening');
  });

  it('builds a pronunciation block from weak words and the profile focus', () => {
    const result = buildErrorMix(
      baseInput({
        weakWords: [
          { surfaceForm: 'きれい', issueKind: 'pitch_accent_shape', attemptCount: 3, trend: 'steady' },
        ],
        pronunciationHeadline: 'Your most common focus area is pitch-contour shape.',
        pronunciationTopFocus: {
          label: 'Pitch-contour shape',
          sentenceCount: 4,
          trend: 'improving',
        },
      }),
    );
    expect(result.hasData).toBe(true);
    expect(result.pronunciation).toMatchObject({
      topFocusLabel: 'Pitch-contour shape',
      topFocusSentenceCount: 4,
      topFocusTrend: 'improving',
    });
    expect(result.pronunciation!.weakWords).toHaveLength(1);
  });

  it('reports no data when nothing is classified and there is no shadowing signal', () => {
    const result = buildErrorMix(baseInput());
    expect(result.hasData).toBe(false);
  });
});
