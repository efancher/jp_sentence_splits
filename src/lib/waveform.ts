/**
 * Ported from
 * ~/projects/shadowing/web/src/{analysis/audio.ts,analysis/waveform.ts,services/media.ts}.
 * Amplitude-only subset landed in Phase 8.3; the pitch-bucket functions
 * (pitchFramesToBucketSemitones, pitchBucketsToPolyline,
 * emptyLivePitchBuckets) and alignment helpers (energyEnvelope,
 * detectOnsetSeconds, crossCorrelateOffset) were added in Phase 8.4a/8.4b.
 */

export const ANALYSIS_SAMPLE_RATE = 16_000;
export const LIVE_WAVEFORM_BUCKETS = 240;
/** Live mic envelopes tend to read quieter than decoded reference peaks. */
export const LIVE_MIC_AMPLITUDE_GAIN = 2;
/** YIN frame size for live pitch (matches offline extractPitch). */
export const LIVE_PITCH_FRAME_SAMPLES = 1024;
export const LIVE_PITCH_DISPLAY_MIN_SEMITONES = -8;
export const LIVE_PITCH_DISPLAY_MAX_SEMITONES = 8;
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

export function emptyLivePitchBuckets(buckets: number): Array<number | null> {
  return Array.from({ length: buckets }, () => null);
}

export function pitchFramesToBucketSemitones(
  frames: Array<{ timeSeconds: number; voiced: boolean; relativeSemitones: number | null }>,
  durationSeconds: number,
  buckets: number,
): Array<number | null> {
  const sums = new Float64Array(buckets);
  const counts = new Uint16Array(buckets);
  const safeDuration = Math.max(0.001, durationSeconds);
  for (const frame of frames) {
    if (!frame.voiced || frame.relativeSemitones === null) continue;
    const index = Math.min(
      buckets - 1,
      Math.max(0, Math.floor((frame.timeSeconds / safeDuration) * buckets)),
    );
    sums[index] += frame.relativeSemitones;
    counts[index] += 1;
  }
  return Array.from({ length: buckets }, (_, index) =>
    (counts[index] ?? 0) > 0 ? sums[index]! / counts[index]! : null,
  );
}

export function pitchBucketsToPolyline(
  values: Array<number | null>,
  width: number,
  height: number,
  min: number,
  max: number,
  upToIndex?: number,
): string {
  if (values.length === 0) return '';
  const span = Math.max(0.001, max - min);
  const last = Math.min(values.length - 1, upToIndex ?? values.length - 1);
  const points: string[] = [];
  for (let index = 0; index <= last; index += 1) {
    const value = values[index];
    if (value === null || value === undefined) continue;
    const x = (index / Math.max(1, values.length - 1)) * width;
    const y = height - ((value - min) / span) * (height - 12) - 6;
    points.push(`${x},${y}`);
  }
  return points.join(' ');
}
