import { describe, expect, it } from 'vitest';

import {
  computePeaks,
  crossCorrelateOffset,
  detectOnsetSeconds,
  emptyLivePeaks,
  emptyLivePitchBuckets,
  energyEnvelope,
  mergeLivePeak,
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

describe('mergeLivePeak', () => {
  it('applies gain and clamps to 1, widening the existing bucket symmetrically', () => {
    const peaks = emptyLivePeaks(3);
    mergeLivePeak(peaks, 1, 0.3);
    expect(peaks[1]).toEqual({ min: -0.6, max: 0.6 });

    mergeLivePeak(peaks, 1, 0.9); // 0.9 * gain(2) = 1.8, clamped to 1
    expect(peaks[1]).toEqual({ min: -1, max: 1 });
  });

  it('ignores out-of-range indexes', () => {
    const peaks = emptyLivePeaks(2);
    mergeLivePeak(peaks, -1, 0.5);
    mergeLivePeak(peaks, 5, 0.5);
    expect(peaks).toEqual(emptyLivePeaks(2));
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
