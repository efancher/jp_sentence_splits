/**
 * Ported from
 * ~/projects/shadowing/web/src/{analysis/audio.ts,analysis/waveform.ts,services/media.ts,services/analysis.ts}.
 * Amplitude-only subset landed in Phase 8.3; the pitch-bucket functions
 * (pitchFramesToBucketSemitones, pitchBucketsToPolyline,
 * emptyLivePitchBuckets) landed in Phase 8.4a; the alignment helpers
 * (energyEnvelope, detectOnsetSeconds, crossCorrelateOffset,
 * analyzeAlignment — the last a simplified, uncached
 * AnalysisService.analyzeAlignment) landed in Phase 8.4b.
 */

import type { TimeRangeMs } from './recording';

export const ANALYSIS_SAMPLE_RATE = 16_000;
export const LIVE_WAVEFORM_BUCKETS = 240;
/** Below this live magnitude we treat the signal as noise and stop chasing gain. */
export const LIVE_AMP_NOISE_FLOOR = 0.02;
/** Ceiling on the adaptive live-waveform gain. */
export const LIVE_AMP_MAX_GAIN = 8;
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

/** Restricts canonical audio to a sub-range in milliseconds (Phase 8.2's practice-target isolation). */
export function sliceCanonicalAudio(
  audio: CanonicalAudio,
  range: { startMs: number; endMs: number },
): CanonicalAudio {
  const startIndex = Math.max(0, Math.round((range.startMs / 1000) * audio.sampleRate));
  const endIndex = Math.min(
    audio.samples.length,
    Math.round((range.endMs / 1000) * audio.sampleRate),
  );
  const samples = audio.samples.slice(startIndex, Math.max(startIndex, endIndex));
  return { sampleRate: audio.sampleRate, samples, durationSeconds: samples.length / audio.sampleRate };
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

export function emptyLivePeaks(buckets: number): WavePeak[] {
  return Array.from({ length: buckets }, () => ({ min: 0, max: 0 }));
}

/** Largest absolute excursion across a set of peak buckets. */
export function peakMagnitude(peaks: WavePeak[]): number {
  let magnitude = 0;
  for (const peak of peaks) {
    magnitude = Math.max(magnitude, Math.abs(peak.min), Math.abs(peak.max));
  }
  return magnitude;
}

/**
 * Gentle auto-gain for the live shadow waveform: pulls a quiet take toward
 * the reference clip's peak magnitude along a square-root curve, so a
 * much quieter recording is lifted but still reads visibly smaller (the
 * "you were quiet" cue is kept, just not punishing). Never attenuates
 * (min 1) and never exceeds LIVE_AMP_MAX_GAIN. Recompute as the running
 * live magnitude grows so earlier buckets stay consistent with later ones.
 */
export function gentleLiveGain(liveMagnitude: number, referenceMagnitude: number): number {
  if (referenceMagnitude <= 0) return 1;
  const ratio = referenceMagnitude / Math.max(liveMagnitude, LIVE_AMP_NOISE_FLOOR);
  return Math.min(LIVE_AMP_MAX_GAIN, Math.max(1, Math.sqrt(ratio)));
}

/** Render raw per-bucket live amplitudes as a symmetric peak envelope at the given gain. */
export function livePeaksFromAmplitudes(amplitudes: Array<number>, gain: number): WavePeak[] {
  return amplitudes.map((amplitude) => {
    const value = Math.min(1, Math.abs(amplitude) * gain);
    return { min: -value, max: value };
  });
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

export function energyEnvelope(samples: Float32Array, windowSize = 256): Float32Array {
  const envelope = new Float32Array(Math.ceil(samples.length / windowSize));
  for (let i = 0; i < envelope.length; i += 1) {
    let sum = 0;
    const start = i * windowSize;
    const end = Math.min(samples.length, start + windowSize);
    for (let j = start; j < end; j += 1) {
      const value = samples[j] ?? 0;
      sum += value * value;
    }
    envelope[i] = Math.sqrt(sum / Math.max(1, end - start));
  }
  return envelope;
}

export function detectOnsetSeconds(
  samples: Float32Array,
  sampleRate: number,
  thresholdRatio = 0.15,
): number {
  const envelope = energyEnvelope(samples);
  let peak = 0;
  for (const value of envelope) peak = Math.max(peak, value);
  const threshold = peak * thresholdRatio;
  const windowSize = 256;
  for (let i = 0; i < envelope.length; i += 1) {
    if ((envelope[i] ?? 0) >= threshold) return (i * windowSize) / sampleRate;
  }
  return 0;
}

export function crossCorrelateOffset(
  reference: Float32Array,
  learner: Float32Array,
  windowSize = 256,
): number {
  const refEnv = energyEnvelope(reference, windowSize);
  const learnEnv = energyEnvelope(learner, windowSize);
  const maxLag = Math.min(80, Math.floor(refEnv.length / 2));
  let bestLag = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    let score = 0;
    let count = 0;
    for (let i = 0; i < refEnv.length; i += 1) {
      const j = i + lag;
      if (j < 0 || j >= learnEnv.length) continue;
      score += (refEnv[i] ?? 0) * (learnEnv[j] ?? 0);
      count += 1;
    }
    if (count === 0) continue;
    const normalized = score / count;
    if (normalized > bestScore) {
      bestScore = normalized;
      bestLag = lag;
    }
  }
  return bestLag * windowSize;
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type AlignmentMode = 'original' | 'onset-aligned' | 'time-normalized';

export interface AlignmentResult {
  mode: AlignmentMode;
  offsetSeconds: number;
  durationRatio: number;
  confidence: ConfidenceLevel;
  referencePeaks: WavePeak[];
  learnerPeaks: WavePeak[];
}

/**
 * Compares a saved attempt against the reference clip: onset detection +
 * cross-correlation to estimate timing offset, plus duration ratio. No
 * caching layer (unlike the source's `AnalysisService`, which persisted
 * results to a `derivedAnalyses` table this app doesn't have) — clips are
 * short enough to just recompute on demand.
 */
export async function analyzeAlignment(
  referenceBlob: Blob,
  learnerBlob: Blob,
  mode: AlignmentMode,
  referenceRange?: TimeRangeMs,
  /** Rate the learner played the reference at while shadowing (e.g. 0.5). Scales the expected duration so a deliberately slowed practice pass doesn't read as "too slow". Defaults to 1 (native speed). */
  referencePlaybackRate = 1,
): Promise<AlignmentResult> {
  const [referenceBuffer, learnerBuffer] = await Promise.all([
    decodeAudioBuffer(referenceBlob),
    decodeAudioBuffer(learnerBlob),
  ]);
  const referenceFull = canonicalizeAudioBuffer(referenceBuffer);
  const reference = referenceRange ? sliceCanonicalAudio(referenceFull, referenceRange) : referenceFull;
  const learner = canonicalizeAudioBuffer(learnerBuffer);
  const referenceOnset = detectOnsetSeconds(reference.samples, reference.sampleRate);
  const learnerOnset = detectOnsetSeconds(learner.samples, learner.sampleRate);
  let offsetSeconds = 0;
  let confidence: ConfidenceLevel = 'medium';
  if (mode === 'onset-aligned') {
    offsetSeconds = referenceOnset - learnerOnset;
    confidence = 'medium';
  } else if (mode === 'time-normalized') {
    offsetSeconds = 0;
    confidence = 'low';
  } else {
    const sampleOffset = crossCorrelateOffset(reference.samples, learner.samples);
    offsetSeconds = sampleOffset / reference.sampleRate;
    confidence = 'medium';
  }
  const expectedDurationSeconds = reference.durationSeconds / referencePlaybackRate;
  return {
    mode,
    offsetSeconds,
    durationRatio:
      expectedDurationSeconds > 0 ? learner.durationSeconds / expectedDurationSeconds : 1,
    confidence,
    referencePeaks: computePeaks(reference.samples),
    learnerPeaks: computePeaks(learner.samples),
  };
}
