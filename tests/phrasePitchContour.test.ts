import { describe, expect, it } from 'vitest';

import { sampleContour } from '../src/lib/phrasePitch';
import type { PitchAnalysisPayload } from '../src/lib/pitch';

const pitch = (frames: [number, number | null][]): PitchAnalysisPayload => ({
  frames: frames.map(([timeSeconds, st]) => ({
    timeSeconds,
    hz: st === null ? null : 100,
    voiced: st !== null,
    confidence: 1,
    relativeSemitones: st,
  })),
  medianHz: 100,
  voicedRatio: 1,
  durationSeconds: 1,
});

describe('sampleContour', () => {
  it('averages voiced frames into equal time bins', () => {
    const p = pitch([[0.0, 0], [0.1, 2], [0.2, 4], [0.3, 6]]);
    expect(sampleContour(p, 0, 0.4, 2)).toEqual([1, 5]);
  });

  it('bridges a single empty bin between voiced ones', () => {
    const p = pitch([[0.05, 0], [0.25, 2], [0.45, 4]]);
    expect(sampleContour(p, 0, 0.5, 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it('leaves a longer gap open', () => {
    const p = pitch([[0.05, 0], [0.45, 4]]);
    expect(sampleContour(p, 0, 0.5, 5)).toEqual([0, null, null, null, 4]);
  });

  it('is all null for an empty span', () => {
    expect(sampleContour(pitch([]), 1, 1, 3)).toEqual([null, null, null]);
  });
});
