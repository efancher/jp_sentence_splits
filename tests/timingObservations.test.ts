import { describe, expect, it } from 'vitest';

import { buildTimingObservations, confidenceFromSignal } from '../src/lib/timingObservations';

describe('confidenceFromSignal', () => {
  it('is high for manual origin with a decent voiced ratio', () => {
    expect(
      confidenceFromSignal({ hasReading: true, voicedRatio: 0.5, origin: 'manual' }),
    ).toBe('high');
  });

  it('is low without a reading, regardless of voiced ratio', () => {
    expect(
      confidenceFromSignal({ hasReading: false, voicedRatio: 0.9, origin: 'heuristic' }),
    ).toBe('low');
  });

  it('is low when the voiced ratio is too small', () => {
    expect(
      confidenceFromSignal({ hasReading: true, voicedRatio: 0.1, origin: 'heuristic' }),
    ).toBe('low');
  });

  it('is low when alignment confidence is low, even with a good voiced ratio', () => {
    expect(
      confidenceFromSignal({
        hasReading: true,
        voicedRatio: 0.5,
        alignmentConfidence: 'low',
        origin: 'heuristic',
      }),
    ).toBe('low');
  });

  it('is medium for a healthy heuristic voiced ratio', () => {
    expect(
      confidenceFromSignal({ hasReading: true, voicedRatio: 0.5, origin: 'heuristic' }),
    ).toBe('medium');
  });
});

describe('buildTimingObservations', () => {
  it('flags a recording that is noticeably longer than the reference', () => {
    const observations = buildTimingObservations({
      referenceDuration: 2,
      learnerDuration: 3,
      confidence: 'medium',
    });
    const duration = observations.find((item) => item.id === 'duration-ratio');
    expect(duration?.message).toMatch(/longer/);
  });

  it('flags a recording that is noticeably shorter than the reference', () => {
    const observations = buildTimingObservations({
      referenceDuration: 3,
      learnerDuration: 2,
      confidence: 'medium',
    });
    const duration = observations.find((item) => item.id === 'duration-ratio');
    expect(duration?.message).toMatch(/shorter/);
  });

  it('reports close duration when within tolerance', () => {
    const observations = buildTimingObservations({
      referenceDuration: 2,
      learnerDuration: 2.1,
      confidence: 'medium',
    });
    expect(observations.find((item) => item.id === 'duration-close')).toBeTruthy();
    expect(observations.find((item) => item.id === 'duration-ratio')).toBeUndefined();
  });

  it('adds a pitch-register observation only when both medians are known', () => {
    const withBoth = buildTimingObservations({
      referenceDuration: 2,
      learnerDuration: 2,
      referencePitch: { frames: [], medianHz: 200, voicedRatio: 0.5, durationSeconds: 2 },
      learnerPitch: { frames: [], medianHz: 220, voicedRatio: 0.5, durationSeconds: 2 },
      confidence: 'medium',
    });
    expect(withBoth.find((item) => item.id === 'pitch-register')).toBeTruthy();

    const withoutLearner = buildTimingObservations({
      referenceDuration: 2,
      learnerDuration: 2,
      referencePitch: { frames: [], medianHz: 200, voicedRatio: 0.5, durationSeconds: 2 },
      confidence: 'medium',
    });
    expect(withoutLearner.find((item) => item.id === 'pitch-register')).toBeUndefined();
  });

  it('adds a low-confidence disclaimer only when confidence is low', () => {
    const low = buildTimingObservations({
      referenceDuration: 2,
      learnerDuration: 2,
      confidence: 'low',
    });
    expect(low.find((item) => item.id === 'low-confidence')).toBeTruthy();

    const medium = buildTimingObservations({
      referenceDuration: 2,
      learnerDuration: 2,
      confidence: 'medium',
    });
    expect(medium.find((item) => item.id === 'low-confidence')).toBeUndefined();
  });
});
