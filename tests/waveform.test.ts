import { describe, expect, it } from 'vitest';

import {
  computePeaks,
  emptyLivePeaks,
  emptyLivePitchBuckets,
  mergeLivePeak,
  peaksToPolyline,
  pitchBucketsToPolyline,
  pitchFramesToBucketSemitones,
} from '../src/lib/waveform';

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
