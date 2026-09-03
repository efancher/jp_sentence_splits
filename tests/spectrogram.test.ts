import { describe, expect, it } from 'vitest';

import { computeSpectrogram, fftRadix2 } from '../src/lib/spectrogram';

describe('fftRadix2', () => {
  it('puts a DC signal entirely in bin 0', () => {
    const re = new Float32Array(8).fill(1);
    const im = new Float32Array(8);
    fftRadix2(re, im);
    expect(re[0]).toBeCloseTo(8, 5);
    for (let b = 1; b < 8; b += 1) expect(Math.hypot(re[b]!, im[b]!)).toBeCloseTo(0, 4);
  });

  it('resolves a single cycle to bin 1', () => {
    const n = 16;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i += 1) re[i] = Math.cos((2 * Math.PI * i) / n);
    fftRadix2(re, im);
    const mags = Array.from({ length: n / 2 }, (_, b) => Math.hypot(re[b]!, im[b]!));
    expect(mags.indexOf(Math.max(...mags))).toBe(1);
  });

  it('rejects a non-power-of-two length', () => {
    expect(() => fftRadix2(new Float32Array(6), new Float32Array(6))).toThrow(/power of two/);
  });
});

describe('computeSpectrogram', () => {
  const sr = 16000;
  const tone = (hz: number, seconds: number) => {
    const s = new Float32Array(Math.round(sr * seconds));
    for (let i = 0; i < s.length; i += 1) s[i] = Math.sin((2 * Math.PI * hz * i) / sr);
    return s;
  };

  it('reports geometry and lands a 1 kHz tone in the right bin', () => {
    const spec = computeSpectrogram(tone(1000, 0.5), sr, { fftSize: 512, hopSize: 128 });
    expect(spec.binHz).toBeCloseTo(sr / 512, 5);
    expect(spec.bins).toBe(256);
    expect(spec.frameSeconds).toBeCloseTo(128 / sr, 6);
    // (8000 - 512) / 128 + 1 frames.
    expect(spec.frames.length).toBe(Math.floor((8000 - 512) / 128) + 1);

    const mid = spec.frames[Math.floor(spec.frames.length / 2)]!;
    const peakBin = mid.indexOf(Math.max(...mid));
    expect(peakBin * spec.binHz).toBeGreaterThan(900);
    expect(peakBin * spec.binHz).toBeLessThan(1100);
    // dB scale: loudest bin ~0, floored at -70.
    expect(Math.max(...mid)).toBeLessThanOrEqual(0.01);
    expect(Math.min(...mid)).toBeGreaterThanOrEqual(-70.01);
  });

  it('returns no frames when the clip is shorter than one window', () => {
    expect(computeSpectrogram(new Float32Array(200), sr, { fftSize: 512 }).frames).toEqual([]);
  });
});
