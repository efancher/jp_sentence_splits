import { describe, expect, it } from 'vitest';

import { mapOffset, planEdits } from '../scripts/lib/restoreKanji';

describe('restoreKanji planning', () => {
  it('applies substitutions and remaps offsets around them', () => {
    const original = 'デュッセルドルフはおおきいので、おみせがたくさんあります。';
    const plan = planEdits(original, [['おおきい', '大きい'], ['おみせ', 'お店']]);
    expect(plan.text).toBe('デュッセルドルフは大きいので、お店がたくさんあります。');
    // おおきいので: 9-15 in the old string
    const start = mapOffset(plan.regions, 9);
    const end = mapOffset(plan.regions, 15);
    expect(plan.text.slice(start, end)).toBe('大きいので');
  });

  it('rejects ambiguous or overlapping edits', () => {
    expect(() => planEdits('まちのまち', [['まち', '町']])).toThrow(/more than once/);
    expect(() => planEdits('こうえん', [['こう', 'x'], ['うえ', 'y']])).toThrow(/overlapping/);
    expect(() => planEdits('こうえん', [['ぬ', 'x']])).toThrow(/not found/);
  });

  it('refuses an offset inside a replaced region', () => {
    const plan = planEdits('おみせ', [['おみせ', 'お店']]);
    expect(() => mapOffset(plan.regions, 1)).toThrow(/inside replaced/);
    expect(mapOffset(plan.regions, 0)).toBe(0);
    expect(mapOffset(plan.regions, 3)).toBe(2);
  });
});
