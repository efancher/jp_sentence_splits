import { describe, expect, it } from 'vitest';

import { seededShuffle } from '../src/lib/seededShuffle';

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
