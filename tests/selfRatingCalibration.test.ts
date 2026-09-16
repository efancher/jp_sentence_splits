import { describe, expect, it } from 'vitest';

import {
  buildSelfRatingCalibration,
  type CalibrationReviewInput,
} from '../src/lib/selfRatingCalibration';

describe('buildSelfRatingCalibration', () => {
  it('reports no data when either side is empty', () => {
    expect(buildSelfRatingCalibration([]).hasData).toBe(false);
    expect(
      buildSelfRatingCalibration([{ activityType: 'reading_in_context', rating: 'good' }])
        .hasData,
    ).toBe(false);
  });

  it('computes separate pass rates for self-rated and graded activity types', () => {
    const reviews: CalibrationReviewInput[] = [
      { activityType: 'reading_in_context', rating: 'good' },
      { activityType: 'reading_in_context', rating: 'good' },
      { activityType: 'listening', rating: 'again' },
      { activityType: 'reading_production', rating: 'again' },
      { activityType: 'reading_production', rating: 'again' },
      { activityType: 'reading_production', rating: 'good' },
    ];
    const result = buildSelfRatingCalibration(reviews);
    expect(result.hasData).toBe(true);
    expect(result.selfRated.reviewCount).toBe(3);
    expect(result.selfRated.passRate).toBeCloseTo(2 / 3);
    expect(result.graded.reviewCount).toBe(3);
    expect(result.graded.passRate).toBeCloseTo(1 / 3);
    expect(result.gap).toBeCloseTo(2 / 3 - 1 / 3);
  });

  it('ignores activity types on neither list', () => {
    const result = buildSelfRatingCalibration([
      { activityType: 'reading_in_context', rating: 'good' },
      { activityType: 'reading_production', rating: 'good' },
      { activityType: 'unrelated_thing', rating: 'again' },
    ]);
    expect(result.selfRated.reviewCount).toBe(1);
    expect(result.graded.reviewCount).toBe(1);
  });

  it('breaks self-rated results down per activity type', () => {
    const result = buildSelfRatingCalibration([
      { activityType: 'listening', rating: 'good' },
      { activityType: 'listening', rating: 'again' },
      { activityType: 'reading_production', rating: 'good' },
    ]);
    const listeningRow = result.selfRatedByActivityType.find(
      (row) => row.activityType === 'listening',
    );
    expect(listeningRow?.reviewCount).toBe(2);
    expect(listeningRow?.passRate).toBeCloseTo(0.5);
    const clozeRow = result.selfRatedByActivityType.find((row) => row.activityType === 'cloze');
    expect(clozeRow?.reviewCount).toBe(0);
    expect(clozeRow?.passRate).toBeNull();
  });
});
