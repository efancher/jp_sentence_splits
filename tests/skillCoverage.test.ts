import { describe, expect, it } from 'vitest';

import { buildSkillCoverage } from '../src/lib/skillCoverage';

describe('buildSkillCoverage', () => {
  it('reports no data when nothing is recognized yet', () => {
    const result = buildSkillCoverage({
      recognizedIds: [],
      productionProficientIds: new Set(),
      pitchProficientIds: new Set(),
      heardProficientIds: new Set(),
    });
    expect(result.hasData).toBe(false);
    expect(result.rungs.every((rung) => rung.share === null)).toBe(true);
  });

  it('computes each rung as a share of recognized words', () => {
    const result = buildSkillCoverage({
      recognizedIds: ['a', 'b', 'c', 'd'],
      productionProficientIds: new Set(['a', 'b']),
      pitchProficientIds: new Set(['a']),
      heardProficientIds: new Set([]),
    });
    expect(result.recognized).toBe(4);
    const production = result.rungs.find((r) => r.label === 'Can produce the reading')!;
    expect(production.count).toBe(2);
    expect(production.share).toBeCloseTo(0.5);
    const pitch = result.rungs.find((r) => r.label === 'Pitch known')!;
    expect(pitch.count).toBe(1);
    expect(pitch.share).toBeCloseTo(0.25);
    const heard = result.rungs.find((r) => r.label === 'Heard successfully in a sentence')!;
    expect(heard.count).toBe(0);
    expect(heard.share).toBe(0);
  });

  it('only counts membership within the recognized set, not the raw set sizes', () => {
    const result = buildSkillCoverage({
      recognizedIds: ['a'],
      // 'z' is production-proficient but not recognized — shouldn't inflate the count.
      productionProficientIds: new Set(['a', 'z']),
      pitchProficientIds: new Set(),
      heardProficientIds: new Set(),
    });
    const production = result.rungs.find((r) => r.label === 'Can produce the reading')!;
    expect(production.count).toBe(1);
  });
});
