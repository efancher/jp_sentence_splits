import { describe, expect, it } from 'vitest';

import { estimateFramePitch, extractPitch, hzToRelativeSemitones } from '../src/lib/pitch';
import type { CanonicalAudio } from '../src/lib/waveform';

const SAMPLE_RATE = 16_000;

function sineWave(hz: number, samples: number, sampleRate = SAMPLE_RATE, amplitude = 0.5): Float32Array {
  const buffer = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    buffer[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  }
  return buffer;
}

describe('estimateFramePitch', () => {
  it('detects the frequency of a pure tone within the voiced range', () => {
    const frame = sineWave(220, 1024);
    const result = estimateFramePitch(frame, SAMPLE_RATE);
    expect(result.voiced).toBe(true);
    expect(result.hz).not.toBeNull();
    expect(result.hz!).toBeGreaterThan(215);
    expect(result.hz!).toBeLessThan(225);
  });

  it('detects a higher pure tone accurately too', () => {
    const frame = sineWave(400, 1024);
    const result = estimateFramePitch(frame, SAMPLE_RATE);
    expect(result.voiced).toBe(true);
    expect(result.hz!).toBeGreaterThan(392);
    expect(result.hz!).toBeLessThan(408);
  });

  it('reports silence as unvoiced with no pitch', () => {
    const result = estimateFramePitch(new Float32Array(1024), SAMPLE_RATE);
    expect(result.voiced).toBe(false);
    expect(result.hz).toBeNull();
  });

  it('reports pure noise as unvoiced (no stable periodicity)', () => {
    let seed = 42;
    const noise = new Float32Array(1024).map(() => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff) * 0.6 - 0.3;
    });
    const result = estimateFramePitch(noise, SAMPLE_RATE);
    expect(result.voiced).toBe(false);
  });
});

describe('hzToRelativeSemitones', () => {
  it('returns 0 when hz equals the median', () => {
    expect(hzToRelativeSemitones(200, 200)).toBe(0);
  });

  it('returns +12 for one octave up', () => {
    expect(hzToRelativeSemitones(400, 200)).toBeCloseTo(12, 5);
  });

  it('returns -12 for one octave down', () => {
    expect(hzToRelativeSemitones(100, 200)).toBeCloseTo(-12, 5);
  });
});

describe('extractPitch', () => {
  it('tracks a steady tone with a high voiced ratio and correct median', () => {
    const durationSeconds = 1;
    const samples = sineWave(220, SAMPLE_RATE * durationSeconds);
    const audio: CanonicalAudio = { sampleRate: SAMPLE_RATE, samples, durationSeconds };
    const result = extractPitch(audio);

    expect(result.durationSeconds).toBe(durationSeconds);
    expect(result.voicedRatio).toBeGreaterThan(0.8);
    expect(result.medianHz).not.toBeNull();
    expect(result.medianHz!).toBeGreaterThan(215);
    expect(result.medianHz!).toBeLessThan(225);

    const voicedFrames = result.frames.filter((frame) => frame.voiced);
    expect(voicedFrames.length).toBeGreaterThan(0);
    for (const frame of voicedFrames) {
      expect(frame.relativeSemitones).not.toBeNull();
      expect(Math.abs(frame.relativeSemitones!)).toBeLessThan(1); // steady tone stays near its own median
    }
  });

  it('returns null medianHz and zero voicedRatio for silence', () => {
    const audio: CanonicalAudio = {
      sampleRate: SAMPLE_RATE,
      samples: new Float32Array(SAMPLE_RATE),
      durationSeconds: 1,
    };
    const result = extractPitch(audio);
    expect(result.medianHz).toBeNull();
    expect(result.voicedRatio).toBe(0);
    expect(result.frames.every((frame) => !frame.voiced)).toBe(true);
  });

  it('detects an octave jump between two halves of the clip', () => {
    const half = SAMPLE_RATE * 0.5;
    const low = sineWave(150, half);
    const high = sineWave(300, half);
    const samples = new Float32Array(low.length + high.length);
    samples.set(low, 0);
    samples.set(high, low.length);
    const audio: CanonicalAudio = { sampleRate: SAMPLE_RATE, samples, durationSeconds: 1 };
    const result = extractPitch(audio);

    const firstHalfFrames = result.frames.filter(
      (frame) => frame.voiced && frame.timeSeconds < 0.4,
    );
    const secondHalfFrames = result.frames.filter(
      (frame) => frame.voiced && frame.timeSeconds > 0.6,
    );
    expect(firstHalfFrames.length).toBeGreaterThan(0);
    expect(secondHalfFrames.length).toBeGreaterThan(0);
    const avgFirst = firstHalfFrames.reduce((sum, f) => sum + f.hz!, 0) / firstHalfFrames.length;
    const avgSecond = secondHalfFrames.reduce((sum, f) => sum + f.hz!, 0) / secondHalfFrames.length;
    expect(avgSecond).toBeGreaterThan(avgFirst * 1.7); // ~2x, allow slack for frame straddling the boundary
  });
});
