import { describe, expect, it } from 'vitest';

import {
  LIVE_AMP_MAX_GAIN,
  computePeaks,
  crossCorrelateOffset,
  detectOnsetSeconds,
  detectSilences,
  emptyLivePeaks,
  emptyLivePitchBuckets,
  energyEnvelope,
  gentleLiveGain,
  livePeaksFromAmplitudes,
  peakMagnitude,
  peaksToPolyline,
  pitchBucketsToPolyline,
  pitchFramesToBucketSemitones,
} from '../src/lib/waveform';

function sineWave(hz: number, samples: number, sampleRate: number, amplitude = 0.5): Float32Array {
  const buffer = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    buffer[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  }
  return buffer;
}

describe('computePeaks', () => {
  it('buckets samples into min/max pairs', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0, 0, 0]);
    const peaks = computePeaks(samples, 2);
    expect(peaks).toHaveLength(2);
    // bucketSize = floor(8/2) = 4: bucket 0 = [0, 0.5, -0.5, 1], bucket 1 = [-1, 0, 0, 0]
    expect(peaks[0]).toEqual({ min: -0.5, max: 1 });
    expect(peaks[1]).toEqual({ min: -1, max: 0 });
  });

  it('returns zeroed buckets for silence', () => {
    const peaks = computePeaks(new Float32Array(100), 4);
    expect(peaks).toEqual([
      { min: 0, max: 0 },
      { min: 0, max: 0 },
      { min: 0, max: 0 },
      { min: 0, max: 0 },
    ]);
  });
});

describe('emptyLivePeaks', () => {
  it('creates zeroed buckets of the given length', () => {
    expect(emptyLivePeaks(3)).toEqual([
      { min: 0, max: 0 },
      { min: 0, max: 0 },
      { min: 0, max: 0 },
    ]);
  });
});

describe('peakMagnitude', () => {
  it('returns the largest absolute excursion across buckets', () => {
    expect(peakMagnitude([{ min: -0.2, max: 0.3 }, { min: -0.7, max: 0.1 }])).toBeCloseTo(0.7);
  });

  it('returns 0 for empty or silent input', () => {
    expect(peakMagnitude([])).toBe(0);
    expect(peakMagnitude(emptyLivePeaks(4))).toBe(0);
  });
});

describe('gentleLiveGain', () => {
  it('never attenuates a take that is already as loud as the reference', () => {
    expect(gentleLiveGain(0.5, 0.5)).toBe(1);
    expect(gentleLiveGain(0.9, 0.5)).toBe(1);
  });

  it('boosts a quiet take along a square-root curve, keeping it below full parity', () => {
    // ratio 4 -> sqrt -> 2x, so a quarter-volume take still reads at half height.
    expect(gentleLiveGain(0.125, 0.5)).toBeCloseTo(2);
  });

  it('treats sub-noise-floor input as the noise floor rather than dividing by ~0', () => {
    // ratio = 0.5 / 0.02 = 25, sqrt = 5 — same as if the take sat exactly at the floor.
    expect(gentleLiveGain(0, 0.5)).toBeCloseTo(5);
    expect(gentleLiveGain(0.0001, 0.5)).toBeCloseTo(5);
  });

  it('clamps very large boosts to LIVE_AMP_MAX_GAIN', () => {
    expect(gentleLiveGain(0.001, 5)).toBe(LIVE_AMP_MAX_GAIN);
  });

  it('returns 1 when there is no reference magnitude', () => {
    expect(gentleLiveGain(0.1, 0)).toBe(1);
  });
});

describe('livePeaksFromAmplitudes', () => {
  it('renders symmetric peaks at the given gain, clamped to 1', () => {
    expect(livePeaksFromAmplitudes([0.1, 0.8], 2)).toEqual([
      { min: -0.2, max: 0.2 },
      { min: -1, max: 1 },
    ]);
  });
});

describe('peaksToPolyline', () => {
  it('returns empty string for no peaks', () => {
    expect(peaksToPolyline([], 100, 50)).toBe('');
  });

  it('maps peak.max to a y-coordinate around the vertical midpoint', () => {
    const peaks = [
      { min: 0, max: 0 },
      { min: -1, max: 1 },
    ];
    const line = peaksToPolyline(peaks, 100, 50);
    expect(line).toBe('0,25 100,0');
  });

  it('truncates at upToIndex', () => {
    const peaks = [
      { min: 0, max: 1 },
      { min: 0, max: 1 },
      { min: 0, max: 1 },
    ];
    const line = peaksToPolyline(peaks, 100, 50, 0);
    expect(line).toBe('0,0');
  });
});

describe('emptyLivePitchBuckets', () => {
  it('creates null-filled buckets of the given length', () => {
    expect(emptyLivePitchBuckets(3)).toEqual([null, null, null]);
  });
});

describe('pitchFramesToBucketSemitones', () => {
  it('averages voiced frames into their time bucket', () => {
    const frames = [
      { timeSeconds: 0, voiced: true, relativeSemitones: 2 },
      { timeSeconds: 0.1, voiced: true, relativeSemitones: 4 },
      { timeSeconds: 0.9, voiced: true, relativeSemitones: -1 },
    ];
    const buckets = pitchFramesToBucketSemitones(frames, 1, 2);
    expect(buckets[0]).toBeCloseTo(3); // (2 + 4) / 2
    expect(buckets[1]).toBeCloseTo(-1);
  });

  it('ignores unvoiced or null-semitone frames', () => {
    const frames = [
      { timeSeconds: 0, voiced: false, relativeSemitones: 5 },
      { timeSeconds: 0.2, voiced: true, relativeSemitones: null },
    ];
    const buckets = pitchFramesToBucketSemitones(frames, 1, 2);
    expect(buckets).toEqual([null, null]);
  });
});

describe('pitchBucketsToPolyline', () => {
  it('maps values to y within [min, max], skipping nulls', () => {
    const line = pitchBucketsToPolyline([0, null, -8, 8], 100, 100, -8, 8);
    const points = line.split(' ');
    expect(points).toHaveLength(3); // the null bucket is skipped
  });

  it('returns empty string for no values', () => {
    expect(pitchBucketsToPolyline([], 100, 100, -8, 8)).toBe('');
  });
});

describe('energyEnvelope', () => {
  it('reports near-zero energy for silence and positive energy for a tone', () => {
    const silence = new Float32Array(2048);
    const tone = sineWave(220, 2048, 16_000);
    const silentEnvelope = energyEnvelope(silence);
    const toneEnvelope = energyEnvelope(tone);
    expect(Math.max(...silentEnvelope)).toBeCloseTo(0, 5);
    expect(Math.max(...toneEnvelope)).toBeGreaterThan(0.1);
  });
});

describe('detectOnsetSeconds', () => {
  it('finds the onset where silence transitions into a tone', () => {
    const sampleRate = 16_000;
    const silenceSeconds = 0.5;
    const silence = new Float32Array(sampleRate * silenceSeconds);
    const tone = sineWave(220, sampleRate * 0.5, sampleRate);
    const samples = new Float32Array(silence.length + tone.length);
    samples.set(silence, 0);
    samples.set(tone, silence.length);

    const onset = detectOnsetSeconds(samples, sampleRate);
    expect(onset).toBeGreaterThan(silenceSeconds - 0.1);
    expect(onset).toBeLessThan(silenceSeconds + 0.1);
  });

  it('returns 0 for a clip with no clear onset (energy from the start)', () => {
    const sampleRate = 16_000;
    const tone = sineWave(220, sampleRate, sampleRate);
    expect(detectOnsetSeconds(tone, sampleRate)).toBe(0);
  });
});

describe('detectSilences', () => {
  const sampleRate = 16_000;

  function toneGapTone(): Float32Array {
    const tone = sineWave(220, Math.round(sampleRate * 0.4), sampleRate);
    const gap = new Float32Array(Math.round(sampleRate * 0.3));
    const out = new Float32Array(tone.length + gap.length + tone.length);
    out.set(tone, 0);
    out.set(gap, tone.length);
    out.set(tone, tone.length + gap.length);
    return out;
  }

  it('finds the quiet gap between two tone bursts', () => {
    const spans = detectSilences(toneGapTone(), sampleRate);
    expect(spans).toHaveLength(1);
    // gap runs ~0.4s..0.7s → mid ~0.55s
    expect(spans[0]!.midSeconds).toBeGreaterThan(0.45);
    expect(spans[0]!.midSeconds).toBeLessThan(0.65);
  });

  it('ignores a gap shorter than minSilenceSeconds', () => {
    const tone = sineWave(220, Math.round(sampleRate * 0.4), sampleRate);
    const gap = new Float32Array(Math.round(sampleRate * 0.02));
    const out = new Float32Array(tone.length + gap.length + tone.length);
    out.set(tone, 0);
    out.set(tone, tone.length + gap.length);
    expect(detectSilences(out, sampleRate, { minSilenceSeconds: 0.1 })).toHaveLength(0);
  });

  it('treats an all-silent clip as one big pause', () => {
    const spans = detectSilences(new Float32Array(sampleRate), sampleRate);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.midSeconds).toBeCloseTo(0.5, 1);
  });
});

describe('crossCorrelateOffset', () => {
  // A pure constant-amplitude tone has an almost flat energy envelope
  // (this function correlates energy envelopes, not raw waveforms), so it
  // gives no distinctive feature to align against — use a silence/tone
  // burst/silence signal instead, which has real energy structure.
  function burstSignal(sampleRate: number, prePadSeconds: number): Float32Array {
    const pre = new Float32Array(Math.round(sampleRate * prePadSeconds));
    const tone = sineWave(220, Math.round(sampleRate * 0.4), sampleRate);
    const post = new Float32Array(Math.round(sampleRate * 0.3));
    const combined = new Float32Array(pre.length + tone.length + post.length);
    combined.set(pre, 0);
    combined.set(tone, pre.length);
    combined.set(post, pre.length + tone.length);
    return combined;
  }

  it('finds no offset between identical burst signals', () => {
    const signal = burstSignal(16_000, 0.3);
    expect(crossCorrelateOffset(signal, signal.slice())).toBe(0);
  });

  it('recovers roughly the known lag between a burst signal and a delayed copy', () => {
    const sampleRate = 16_000;
    const windowSize = 256;
    const reference = burstSignal(sampleRate, 0.2);
    const learner = burstSignal(sampleRate, 0.5); // burst starts 0.3s later
    const expectedLagSamples = 0.3 * sampleRate;

    const offset = crossCorrelateOffset(reference, learner, windowSize);
    expect(Math.abs(Math.abs(offset) - expectedLagSamples)).toBeLessThanOrEqual(windowSize * 2);
  });
});
