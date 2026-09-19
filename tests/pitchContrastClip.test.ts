import { describe, expect, it } from 'vitest';

import type { OddEarClip } from '../src/lib/oddEarOut';
import { inWordShapeKey, pickContrastClip } from '../src/lib/pitchContrastClip';

let n = 0;
function clip(overrides: Partial<OddEarClip> = {}): OddEarClip {
  n += 1;
  return {
    vocabularyItemId: `vi-${n}`,
    expression: `語${n}`,
    reading: `かな${n}`,
    meaning: 'm',
    position: 0,
    moraCount: 2,
    shape: 'hl',
    bookId: 'b1',
    span: { startMs: 100, endMs: 600 },
    ...overrides,
  };
}

const base = {
  moraCount: 2,
  chosenPosition: 1,
  correctPosition: 0,
  excludeVocabularyItemId: 'target',
  excludeReading: 'ターゲット',
};

describe('inWordShapeKey', () => {
  it('matches OddEarClip shapes and folds heiban/odaka together', () => {
    expect(inWordShapeKey(2, 1)).toBe('hl');
    expect(inWordShapeKey(2, 0)).toBe('lh');
    expect(inWordShapeKey(2, 2)).toBe('lh');
    expect(inWordShapeKey(4, 3)).toBe('lhhl');
  });
});

describe('pickContrastClip', () => {
  it('returns a clip with the shape the learner picked and the same mora count', () => {
    const fit = clip({ shape: 'hl' });
    const wrongShape = clip({ shape: 'lh' });
    const wrongLength = clip({ shape: 'hll', moraCount: 3 });
    expect(pickContrastClip([wrongShape, wrongLength, fit], base)).toBe(fit);
  });

  it('skips the target word itself and same-reading homophones', () => {
    const self = clip({ vocabularyItemId: 'target' });
    const homophone = clip({ reading: 'ターゲット' });
    expect(pickContrastClip([self, homophone], base)).toBeNull();
  });

  it('prefers a same-book clip, else falls back to any', () => {
    const other = clip({ bookId: 'b2' });
    const same = clip({ bookId: 'b1' });
    expect(pickContrastClip([other, same], { ...base, preferBookId: 'b1' })).toBe(same);
    expect(pickContrastClip([other], { ...base, preferBookId: 'b1' })).toBe(other);
  });

  it('returns null when heiban and odaka are confused (identical in-word shape)', () => {
    const fit = clip({ shape: 'lh' });
    expect(
      pickContrastClip([fit], { ...base, chosenPosition: 2, correctPosition: 0 }),
    ).toBeNull();
  });

  it('is deterministic for a given target', () => {
    const pool = Array.from({ length: 6 }, () => clip());
    const first = pickContrastClip(pool, base);
    expect(pickContrastClip([...pool].reverse(), base)).toBe(first);
  });

  it('returns null with no clips', () => {
    expect(pickContrastClip([], base)).toBeNull();
  });
});
