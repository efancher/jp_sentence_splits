import { describe, expect, it } from 'vitest';

import type { PitchAnalysisPayload } from '../src/lib/pitch';
import {
  accuracyBySeparation,
  measureNativeWord,
  signalDetection,
} from '../src/lib/nativeClipPitchAudit';

/** A track with one relative-semitone level per equal 100 ms mora starting at `startS`; null = unvoiced. */
function track(levels: Array<number | null>, startS = 0.5): PitchAnalysisPayload {
  const frames: PitchAnalysisPayload['frames'] = [];
  levels.forEach((level, moraIndex) => {
    for (let step = 0; step < 10; step += 1) {
      const timeSeconds = startS + moraIndex * 0.1 + step * 0.01;
      frames.push(
        level === null
          ? { timeSeconds, hz: null, voiced: false, confidence: 0, relativeSemitones: null }
          : { timeSeconds, hz: 120, voiced: true, confidence: 0.9, relativeSemitones: level },
      );
    }
  });
  return { frames, medianHz: 120, voicedRatio: 1, durationSeconds: 3 };
}

/** The word's own span for `moraCount` 100 ms morae starting at 0.5 s. */
function span(moraCount: number) {
  return { startMs: 500, endMs: 500 + moraCount * 100 };
}

const base = { surfaceForm: '語', span: span(2), moraCount: 2 };

describe('measureNativeWord', () => {
  it('agrees and reports the separation for a clear atamadaka (hl) clip', () => {
    const result = measureNativeWord({ ...base, pitch: track([3, -2]), position: 1 })!;
    expect(result.expectedShape).toBe('hl');
    expect(result.measuredShape).toBe('hl');
    expect(result.agrees).toBe(true);
    expect(result.separationSemitones).toBeCloseTo(5);
  });

  it('flags a clip whose native realization contradicts the dictionary shape', () => {
    const result = measureNativeWord({ ...base, pitch: track([-2, 3]), position: 1 })!;
    expect(result.agrees).toBe(false);
    expect(result.measuredShape).toBe('lh');
    expect(result.separationSemitones).toBeCloseTo(-5);
  });

  it('measures a flat-ish clip as a weak cue', () => {
    const result = measureNativeWord({ ...base, pitch: track([0.4, -0.3]), position: 1 })!;
    expect(result.separationSemitones).toBeCloseTo(0.7);
  });

  it('handles a nakadaka word (lhhl)', () => {
    const result = measureNativeWord({
      ...base,
      moraCount: 4,
      span: span(4),
      pitch: track([-3, 2, 2, -3]),
      position: 3,
    })!;
    expect(result.measuredShape).toBe('lhhl');
    expect(result.agrees).toBe(true);
  });

  it('returns an unmeasurable result when nothing is voiced, and null for 1-mora words', () => {
    const silent = measureNativeWord({ ...base, pitch: track([null, null]), position: 1 })!;
    expect(silent.agrees).toBeNull();
    expect(silent.separationSemitones).toBeNull();
    expect(measureNativeWord({ ...base, moraCount: 1, pitch: track([1]), position: 1 })).toBeNull();
  });

  it('has null separation when one expected level has no voiced bucket', () => {
    const result = measureNativeWord({ ...base, pitch: track([3, null]), position: 1 })!;
    expect(result.separationSemitones).toBeNull();
  });
});

describe('accuracyBySeparation', () => {
  it('bins observations and ignores unmeasurable ones', () => {
    const bins = accuracyBySeparation([
      { separationSemitones: -1, correct: false },
      { separationSemitones: 1, correct: false },
      { separationSemitones: 2, correct: true },
      { separationSemitones: 2, correct: false },
      { separationSemitones: 5, correct: true },
      { separationSemitones: null, correct: true },
    ]);
    expect(bins.map((bin) => [bin.n, bin.correct])).toEqual([
      [1, 0],
      [1, 0],
      [2, 1],
      [1, 1],
    ]);
  });

  it('accumulates each bin\'s chance level so word lengths stay comparable', () => {
    const bins = accuracyBySeparation([
      { separationSemitones: 5, correct: true, chance: 0.5 },
      { separationSemitones: 5, correct: false, chance: 0.25 },
    ]);
    expect(bins[3]!.chanceSum / bins[3]!.n).toBeCloseTo(0.375);
  });
});

describe('signalDetection', () => {
  it('is near zero d′ when the two patterns are answered equally often either way', () => {
    const pairs = [
      ...Array.from({ length: 18 }, () => ({ expected: 'hl', chosen: 'hl' })),
      ...Array.from({ length: 19 }, () => ({ expected: 'hl', chosen: 'lh' })),
      ...Array.from({ length: 13 }, () => ({ expected: 'lh', chosen: 'lh' })),
      ...Array.from({ length: 9 }, () => ({ expected: 'lh', chosen: 'hl' })),
    ];
    const result = signalDetection(pairs, 'hl', 'lh');
    expect(result.signalTrials).toBe(37);
    expect(result.falseAlarms).toBe(9);
    expect(result.dPrime!).toBeGreaterThan(0.1);
    expect(result.dPrime!).toBeLessThan(0.6);
  });

  it('is large for reliable discrimination and shows bias for a one-answer strategy', () => {
    const clear = signalDetection(
      [
        ...Array.from({ length: 20 }, () => ({ expected: 'hl', chosen: 'hl' })),
        ...Array.from({ length: 20 }, () => ({ expected: 'lh', chosen: 'lh' })),
      ],
      'hl',
      'lh',
    );
    expect(clear.dPrime!).toBeGreaterThan(3);
    expect(Math.abs(clear.criterion!)).toBeLessThan(0.1);

    const alwaysHl = signalDetection(
      [
        ...Array.from({ length: 20 }, () => ({ expected: 'hl', chosen: 'hl' })),
        ...Array.from({ length: 20 }, () => ({ expected: 'lh', chosen: 'hl' })),
      ],
      'hl',
      'lh',
    );
    expect(Math.abs(alwaysHl.dPrime!)).toBeLessThan(0.1);
    expect(alwaysHl.criterion!).toBeLessThan(-1);
  });

  it('is null when a side has no trials', () => {
    expect(signalDetection([{ expected: 'hl', chosen: 'hl' }], 'hl', 'lh').dPrime).toBeNull();
  });
});
