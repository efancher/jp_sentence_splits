/**
 * Ported (amplitude-only subset) from
 * ~/projects/shadowing/web/src/{analysis/audio.ts,analysis/waveform.ts,services/media.ts}
 * for Phase 8.3's live shadow waveform. The pitch-contour half of the
 * original `analysis/waveform.ts` (pitchFramesToBucketSemitones,
 * pitchBucketsToPolyline, emptyLivePitchBuckets) and all of
 * `analysis/pitch.ts` are deliberately not ported yet — that's Phase 8.4's
 * DSP port (pitch/waveform comparison analysis), sequenced after this.
 */

export const ANALYSIS_SAMPLE_RATE = 16_000;
export const LIVE_WAVEFORM_BUCKETS = 240;
/** Live mic envelopes tend to read quieter than decoded reference peaks. */
export const LIVE_MIC_AMPLITUDE_GAIN = 2;
/**
 * Approximate headphone/AirPods output delay so the live pen tracks what
 * you hear, not the earlier media clock.
 */
export const SHADOW_OUTPUT_LATENCY_SECONDS = 0.18;

export interface CanonicalAudio {
  sampleRate: number;
  samples: Float32Array;
  durationSeconds: number;
}

export interface WavePeak {
  min: number;
  max: number;
}

export async function decodeAudioBuffer(blob: Blob): Promise<AudioBuffer> {
  const context = new AudioContext();
  try {
    const data = await blob.arrayBuffer();
    return await context.decodeAudioData(data.slice(0));
  } finally {
    await context.close().catch(() => undefined);
  }
}

export function canonicalizeAudioBuffer(
  buffer: AudioBuffer,
  targetRate = ANALYSIS_SAMPLE_RATE,
): CanonicalAudio {
  const mono = new Float32Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    let sum = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      sum += buffer.getChannelData(channel)[i] ?? 0;
    }
    mono[i] = sum / buffer.numberOfChannels;
  }
  if (buffer.sampleRate === targetRate) {
    return { sampleRate: targetRate, samples: mono, durationSeconds: mono.length / targetRate };
  }
  const ratio = targetRate / buffer.sampleRate;
  const length = Math.max(1, Math.round(mono.length * ratio));
  const resampled = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const sourceIndex = i / ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(mono.length - 1, left + 1);
    const frac = sourceIndex - left;
    resampled[i] = (mono[left] ?? 0) * (1 - frac) + (mono[right] ?? 0) * frac;
  }
  return { sampleRate: targetRate, samples: resampled, durationSeconds: length / targetRate };
}

export function computePeaks(samples: Float32Array, buckets = 400): WavePeak[] {
  const peaks: WavePeak[] = [];
  const bucketSize = Math.max(1, Math.floor(samples.length / buckets));
  for (let i = 0; i < buckets; i += 1) {
    const start = i * bucketSize;
    const end = Math.min(samples.length, start + bucketSize);
    let min = 0;
    let max = 0;
    for (let j = start; j < end; j += 1) {
      const value = samples[j] ?? 0;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    peaks.push({ min, max });
  }
  return peaks;
}

export async function peaksFromBlob(
  blob: Blob,
  buckets = LIVE_WAVEFORM_BUCKETS,
): Promise<{ peaks: WavePeak[]; durationSeconds: number }> {
  const buffer = await decodeAudioBuffer(blob);
  const canonical = canonicalizeAudioBuffer(buffer);
  return {
    peaks: computePeaks(canonical.samples, buckets),
    durationSeconds: canonical.durationSeconds,
  };
}

/** Merge a live amplitude sample into a peak bucket (symmetric envelope). */
export function mergeLivePeak(
  peaks: WavePeak[],
  index: number,
  amplitude: number,
  gain = LIVE_MIC_AMPLITUDE_GAIN,
): void {
  if (index < 0 || index >= peaks.length) return;
  const value = Math.min(1, Math.abs(amplitude) * gain);
  const current = peaks[index] ?? { min: 0, max: 0 };
  peaks[index] = {
    min: Math.min(current.min, -value),
    max: Math.max(current.max, value),
  };
}

export function emptyLivePeaks(buckets: number): WavePeak[] {
  return Array.from({ length: buckets }, () => ({ min: 0, max: 0 }));
}

export function peaksToPolyline(
  peaks: WavePeak[],
  width: number,
  height: number,
  upToIndex?: number,
): string {
  if (peaks.length === 0) return '';
  const mid = height / 2;
  const last = Math.min(peaks.length - 1, upToIndex ?? peaks.length - 1);
  if (last < 0) return '';
  const points: string[] = [];
  for (let index = 0; index <= last; index += 1) {
    const peak = peaks[index];
    if (!peak) continue;
    const x = (index / Math.max(1, peaks.length - 1)) * width;
    const yMax = mid - peak.max * mid;
    points.push(`${x},${yMax}`);
  }
  return points.join(' ');
}
