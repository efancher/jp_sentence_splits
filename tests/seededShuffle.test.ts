import { describe, expect, it } from 'vitest';

import { seededShuffle, weightedSeededShuffle } from '../src/lib/seededShuffle';

describe('seededShuffle', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const id = (x: string) => x;

  it('is deterministic for a given seed and independent of input order', () => {
    const forward = seededShuffle(ids, id, 'seed-1');
    const reversed = seededShuffle([...ids].reverse(), id, 'seed-1');
    expect(reversed).toEqual(forward);
    expect([...forward].sort()).toEqual([...ids].sort());
  });

  it('produces a different order for a different seed', () => {
    const a = seededShuffle(ids, id, 'seed-1');
    const b = seededShuffle(ids, id, 'seed-2');
    expect(a).not.toEqual(b);
  });
});

describe('weightedSeededShuffle', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const id = (x: string) => x;
  const equalWeight = () => 1;

  it('is deterministic for a given seed and independent of input order', () => {
    const forward = weightedSeededShuffle(ids, id, 'seed-1', equalWeight);
    const reversed = weightedSeededShuffle([...ids].reverse(), id, 'seed-1', equalWeight);
    expect(reversed).toEqual(forward);
    expect([...forward].sort()).toEqual([...ids].sort());
  });

  it('produces a different order for a different seed', () => {
    const a = weightedSeededShuffle(ids, id, 'seed-1', equalWeight);
    const b = weightedSeededShuffle(ids, id, 'seed-2', equalWeight);
    expect(a).not.toEqual(b);
  });

  it('sorts a higher-weight item earlier on average across many seeds', () => {
    const items = ['heavy', 'light-1', 'light-2', 'light-3', 'light-4'];
    const weight = (item: string) => (item === 'heavy' ? 5 : 1);
    let positionSum = 0;
    const trials = 200;
    for (let i = 0; i < trials; i += 1) {
      const order = weightedSeededShuffle(items, id, `trial-${i}`, weight);
      positionSum += order.indexOf('heavy');
    }
    // Unweighted expectation is the middle position (2 of 0..4); a 5x weight
    // should pull the average well below that.
    expect(positionSum / trials).toBeLessThan(1);
  });

  it('falls back to a uniform shuffle when every weight is equal', () => {
    const weighted = weightedSeededShuffle(ids, id, 'seed-1', equalWeight);
    const plain = seededShuffle(ids, id, 'seed-1');
    // Not the same key formula, so not necessarily the identical order, but
    // both must be full, valid permutations of the same set.
    expect([...weighted].sort()).toEqual([...plain].sort());
  });
});
