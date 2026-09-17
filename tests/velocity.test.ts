import { describe, expect, it } from 'vitest';

import { buildVelocityReport } from '../src/lib/velocity';
import type { WeekBucket } from '../src/lib/progressReport';

function week(weekStart: string, wordsLearned: number): WeekBucket {
  return { weekStart, reviews: 0, wordsLearned, cumulativeWordsLearned: 0 };
}

describe('buildVelocityReport', () => {
  it('reports no rate/ETA with fewer than two week buckets', () => {
    const result = buildVelocityReport(50, [week('2026-09-14', 5)]);
    expect(result.backlogSize).toBe(50);
    expect(result.weeklyWordsLearnedRate).toBeNull();
    expect(result.weeksToClearBacklog).toBeNull();
  });

  it('averages complete weeks only, excluding the current in-progress week', () => {
    const weeks = [week('2026-08-31', 10), week('2026-09-07', 6), week('2026-09-14', 999)];
    const result = buildVelocityReport(40, weeks);
    expect(result.weeklyWordsLearnedRate).toBe(8);
    expect(result.weeksToClearBacklog).toBe(5);
  });

  it('reports no ETA when the recent rate is zero', () => {
    const weeks = [week('2026-08-31', 0), week('2026-09-07', 0), week('2026-09-14', 12)];
    const result = buildVelocityReport(40, weeks);
    expect(result.weeklyWordsLearnedRate).toBe(0);
    expect(result.weeksToClearBacklog).toBeNull();
  });

  it('rounds the ETA up to a whole week', () => {
    const weeks = [week('2026-08-31', 3), week('2026-09-07', 3), week('2026-09-14', 0)];
    const result = buildVelocityReport(10, weeks);
    expect(result.weeklyWordsLearnedRate).toBe(3);
    expect(result.weeksToClearBacklog).toBe(4);
  });
});
