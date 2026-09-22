import { describe, expect, it } from 'vitest';

import { compareFallToNative } from '../src/lib/pitchContinuousScore';

describe('compareFallToNative', () => {
  it('returns null when the native clip has no fitted shape', () => {
    expect(
      compareFallToNative(['l', 'h', 'h'], 2.5, { fitShape: null, fitContrastSemitones: null }),
    ).toBeNull();
  });

  it('returns null when the learner take has no usable contrast', () => {
    expect(
      compareFallToNative(['l', 'h', 'h'], null, { fitShape: 'lhh', fitContrastSemitones: 3 }),
    ).toBeNull();
  });

  it('reports zero timing error and a full ratio for a matching, equal-strength take', () => {
    const result = compareFallToNative(['h', 'l', 'l'], 3, { fitShape: 'hll', fitContrastSemitones: 3 });
    expect(result).toEqual({
      fallTimingErrorMorae: 0,
      fallMagnitudeRatio: 1,
      nativeContrastSemitones: 3,
      learnerContrastSemitones: 3,
    });
  });

  it('measures the mora distance between a late learner drop and the native one', () => {
    // Native drops after mora 1 (atamadaka); learner's drop lands after mora 2.
    const result = compareFallToNative(['h', 'h', 'l'], 2, { fitShape: 'hll', fitContrastSemitones: 4 });
    expect(result?.fallTimingErrorMorae).toBe(1);
    expect(result?.fallMagnitudeRatio).toBe(0.5);
  });

  it('leaves the ratio null when the native clip itself has too weak a cue to divide by', () => {
    const result = compareFallToNative(['h', 'l'], 1, { fitShape: 'hl', fitContrastSemitones: 0.6 });
    expect(result?.fallMagnitudeRatio).toBeNull();
    expect(result?.fallTimingErrorMorae).toBe(0);
  });

  it('never overweights the ratio just because the learner over-produced the fall', () => {
    const result = compareFallToNative(['h', 'l', 'l'], 9, { fitShape: 'hll', fitContrastSemitones: 3 });
    expect(result?.fallMagnitudeRatio).toBe(3);
  });
});
