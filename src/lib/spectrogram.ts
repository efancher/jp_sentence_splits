/**
 * A tiny STFT for the reference-vs-attempt spectrogram in `AnalysisPanel`
 * (ROADMAP "Segmental pronunciation feedback" — the spectrogram slice).
 * Pure, no dependency: a radix-2 Cooley–Tukey FFT + a Hann-windowed
 * short-time transform over canonicalized 16 kHz mono samples. Log
 * magnitude, so formant bands read at a glance. Not a general DSP kit —
 * just enough to draw the picture.
 */

/** In-place iterative radix-2 FFT. `re`/`im` length must be a power of two. */
export function fftRadix2(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n <= 1) return;
  if ((n & (n - 1)) !== 0) throw new Error('fftRadix2: length must be a power of two');

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const aRe = re[i + k]!;
        const aIm = im[i + k]!;
        const bRe = re[i + k + len / 2]!;
        const bIm = im[i + k + len / 2]!;
        const tRe = bRe * curRe - bIm * curIm;
        const tIm = bRe * curIm + bIm * curRe;
        re[i + k] = aRe + tRe;
        im[i + k] = aIm + tIm;
        re[i + k + len / 2] = aRe - tRe;
        im[i + k + len / 2] = aIm - tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

export interface Spectrogram {
  /** One row per time frame; each row is `fftSize / 2` log-magnitude bins (dB, ≤ 0). */
  frames: Float32Array[];
  /** Hz per bin. */
  binHz: number;
  /** Seconds between frame starts. */
  frameSeconds: number;
  /** `fftSize / 2`. */
  bins: number;
}

const hannCache = new Map<number, Float32Array>();
function hannWindow(size: number): Float32Array {
  const cached = hannCache.get(size);
  if (cached) return cached;
  const w = new Float32Array(size);
  for (let i = 0; i < size; i += 1) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  hannCache.set(size, w);
  return w;
}

/**
 * Short-time log-magnitude spectrogram. `fftSize` and `hopSize` in samples
 * (fftSize a power of two). Magnitudes are normalized to the loudest bin in
 * the whole clip and expressed in dB (0 = loudest), floored at `floorDb`.
 */
export function computeSpectrogram(
  samples: Float32Array,
  sampleRate: number,
  {
    fftSize = 512,
    hopSize = 128,
    floorDb = -70,
  }: { fftSize?: number; hopSize?: number; floorDb?: number } = {},
): Spectrogram {
  const bins = fftSize / 2;
  const window = hannWindow(fftSize);
  const frames: Float32Array[] = [];
  let peak = 1e-9;

  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  for (let start = 0; start + fftSize <= samples.length; start += hopSize) {
    for (let i = 0; i < fftSize; i += 1) {
      re[i] = (samples[start + i] ?? 0) * window[i]!;
      im[i] = 0;
    }
    fftRadix2(re, im);
    const mag = new Float32Array(bins);
    for (let b = 0; b < bins; b += 1) {
      const m = Math.hypot(re[b]!, im[b]!);
      mag[b] = m;
      if (m > peak) peak = m;
    }
    frames.push(mag);
  }

  for (const frame of frames) {
    for (let b = 0; b < frame.length; b += 1) {
      const db = 20 * Math.log10((frame[b] ?? 0) / peak + 1e-12);
      frame[b] = db < floorDb ? floorDb : db;
    }
  }

  return {
    frames,
    binHz: sampleRate / fftSize,
    frameSeconds: hopSize / sampleRate,
    bins,
  };
}
