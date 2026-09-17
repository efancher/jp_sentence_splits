import { describe, expect, it } from 'vitest';

import { buildLeechList, type LeechCandidateInput } from '../src/lib/leechList';

function candidate(overrides: Partial<LeechCandidateInput> = {}): LeechCandidateInput {
  return {
    studyItemId: 'si_1',
    subjectLabel: '猫 (ねこ)',
    activityType: 'reading_retrieval',
    lapses: 0,
    recentAgainCount: 0,
    recentReviewCount: 0,
    topErrorClassificationKey: null,
    ...overrides,
  };
}

describe('buildLeechList', () => {
  it('reports no data when nothing has lapsed', () => {
    const result = buildLeechList([candidate({ recentAgainCount: 3, recentReviewCount: 3 })]);
    expect(result.hasData).toBe(false);
    expect(result.rows).toEqual([]);
  });

  it('excludes a still-new item with a bad recent record but zero real lapses', () => {
    const result = buildLeechList([
      candidate({ studyItemId: 'new_but_missed', lapses: 0, recentAgainCount: 2, recentReviewCount: 2 }),
    ]);
    expect(result.rows).toEqual([]);
  });

  it('ranks by lapses + weakness, highest first', () => {
    const highLapsesLowWeakness = candidate({
      studyItemId: 'a',
      lapses: 5,
      recentAgainCount: 1,
      recentReviewCount: 4,
    });
    const lowLapsesHighWeakness = candidate({
      studyItemId: 'b',
      lapses: 1,
      recentAgainCount: 4,
      recentReviewCount: 4,
    });
    const result = buildLeechList([lowLapsesHighWeakness, highLapsesLowWeakness]);
    expect(result.hasData).toBe(true);
    expect(result.rows.map((r) => r.studyItemId)).toEqual(['a', 'b']);
    expect(result.rows[0]!.weakness).toBeCloseTo(0.25);
    expect(result.rows[0]!.score).toBeCloseTo(5.25);
  });

  it('maps the top error classification to errorMix\'s label/next-action/route', () => {
    const result = buildLeechList([
      candidate({ lapses: 2, topErrorClassificationKey: 'pronunciation_difficulty' }),
    ]);
    expect(result.rows[0]!.reasonLabel).toBe('Pitch accent');
    expect(result.rows[0]!.nextAction).toBe('Pitch-accent drill');
    expect(result.rows[0]!.route).toBe('/pitch-accent');
  });

  it('falls back to a generic reason when nothing is classified', () => {
    const result = buildLeechList([candidate({ lapses: 3, topErrorClassificationKey: null })]);
    expect(result.rows[0]!.reasonLabel).toBe('No classified reason yet');
  });

  it('respects the limit', () => {
    const inputs = Array.from({ length: 15 }, (_, i) =>
      candidate({ studyItemId: `si_${i}`, lapses: i + 1 }),
    );
    const result = buildLeechList(inputs, 5);
    expect(result.rows).toHaveLength(5);
    // Highest lapses first.
    expect(result.rows[0]!.studyItemId).toBe('si_14');
  });
});
