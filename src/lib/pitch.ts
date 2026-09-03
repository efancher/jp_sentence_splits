import type { CanonicalAudio } from './waveform';

/**
 * Ported from ~/projects/shadowing/web/src/analysis/pitch.ts for Phase
 * 8.4a. Real DSP (YIN pitch detection) — the source repo has no test
 * fixtures for this module, so correctness here is validated against
 * synthetic pure-tone signals of known frequency instead (see
 * tests/pitch.test.ts), not by matching a pre-existing fixture set.
 */

const FRAME_SIZE = 1024;
const HOP_SIZE = 256;
const MIN_HZ = 60;
const MAX_HZ = 500;
const RMS_THRESHOLD = 0.01;

export interface PitchFrame {
  timeSeconds: number;
  hz: number | null;
  voiced: boolean;
  confidence: number;
  relativeSemitones: number | null;
}

export interface PitchAnalysisPayload {
  frames: PitchFrame[];
  medianHz: number | null;
  voicedRatio: number;
  durationSeconds: number;
}

/** Bump when `extractPitch`'s DSP would meaningfully change its output. */
export const PITCH_TRACK_VERSION = 1;

/**
 * Cached YIN pitch track of a sentence's reference clip — the *measured*
 * contour (not a predicted one), backing the sentence-level pitch overlay on
 * the listening / word_listening review reveals and the shadowing surfaces.
 * Reference audio doesn't change, so this is kept indefinitely unless
 * `pitchVersion` goes stale. Local-only (Dexie `referencePitchTracks`), same
 * precedent as `ReferenceAlignment` — derived/recomputable, not synced.
 */
export interface ReferencePitchTrack {
  /** = SentenceAudio.id */
  id: string;
  pitchVersion: number;
  payload: PitchAnalysisPayload;
  computedAt: string;
}

function yinPitch(
  frame: Float32Array,
  sampleRate: number,
): { hz: number | null; confidence: number } {
  const threshold = 0.15;
  const yinBuffer = new Float32Array(Math.floor(frame.length / 2));
  for (let tau = 1; tau < yinBuffer.length; tau += 1) {
    let sum = 0;
    for (let i = 0; i < yinBuffer.length; i += 1) {
      const delta = (frame[i] ?? 0) - (frame[i + tau] ?? 0);
      sum += delta * delta;
    }
    yinBuffer[tau] = sum;
  }
  yinBuffer[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < yinBuffer.length; tau += 1) {
    runningSum += yinBuffer[tau] ?? 0;
    yinBuffer[tau] = runningSum === 0 ? 1 : ((yinBuffer[tau] ?? 0) * tau) / runningSum;
  }
  const minPeriod = Math.floor(sampleRate / MAX_HZ);
  const maxPeriod = Math.min(yinBuffer.length - 1, Math.floor(sampleRate / MIN_HZ));
  let tauEstimate = -1;
  for (let tau = minPeriod; tau <= maxPeriod; tau += 1) {
    if ((yinBuffer[tau] ?? 1) < threshold) {
      while (tau + 1 <= maxPeriod && (yinBuffer[tau + 1] ?? 1) < (yinBuffer[tau] ?? 1)) tau += 1;
      tauEstimate = tau;
      break;
    }
  }
  if (tauEstimate < 0) return { hz: null, confidence: 0 };
  const better =
    tauEstimate > 0 && tauEstimate < yinBuffer.length - 1
      ? parabolicInterpolation(yinBuffer, tauEstimate)
      : tauEstimate;
  const hz = sampleRate / better;
  const confidence = 1 - (yinBuffer[tauEstimate] ?? 1);
  if (hz < MIN_HZ || hz > MAX_HZ) return { hz: null, confidence: 0 };
  return { hz, confidence: Math.max(0, Math.min(1, confidence)) };
}

function parabolicInterpolation(buffer: Float32Array, tau: number): number {
  const s0 = buffer[tau - 1] ?? 0;
  const s1 = buffer[tau] ?? 0;
  const s2 = buffer[tau + 1] ?? 0;
  const adjustment = (s2 - s0) / (2 * (2 * s1 - s2 - s0) || 1);
  return tau + adjustment;
}

function frameRms(frame: Float32Array): number {
  let sum = 0;
  for (const sample of frame) sum += sample * sample;
  return Math.sqrt(sum / frame.length);
}

export function estimateFramePitch(
  frame: Float32Array,
  sampleRate: number,
): { hz: number | null; voiced: boolean; confidence: number } {
  const rms = frameRms(frame);
  if (rms < RMS_THRESHOLD) return { hz: null, voiced: false, confidence: 0 };
  const { hz, confidence } = yinPitch(frame, sampleRate);
  const voiced = hz !== null && confidence >= 0.4;
  return { hz: voiced ? hz : null, voiced, confidence };
}

export function hzToRelativeSemitones(hz: number, medianHz: number): number {
  return 12 * Math.log2(hz / medianHz);
}

/**
 * Median of a list of Hz readings. Used both offline (extractPitch) and
 * live (LiveShadowWaveform, over a growing buffer) so a speaker's contour
 * is always normalized to their *own* centre — a baritone and a reference
 * an octave up then overlay on the same 0 line instead of the learner
 * being shoved off the bottom of the display.
 */
export function medianHz(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

export function extractPitch(audio: CanonicalAudio): PitchAnalysisPayload {
  const frames: PitchFrame[] = [];
  const voicedHz: number[] = [];
  for (let start = 0; start + FRAME_SIZE <= audio.samples.length; start += HOP_SIZE) {
    const frame = audio.samples.subarray(start, start + FRAME_SIZE);
    const timeSeconds = start / audio.sampleRate;
    const rms = frameRms(frame);
    if (rms < RMS_THRESHOLD) {
      frames.push({ timeSeconds, hz: null, voiced: false, confidence: 0, relativeSemitones: null });
      continue;
    }
    const { hz, confidence } = yinPitch(frame, audio.sampleRate);
    const voiced = hz !== null && confidence >= 0.4;
    if (voiced && hz !== null) voicedHz.push(hz);
    frames.push({
      timeSeconds,
      hz: voiced ? hz : null,
      voiced,
      confidence,
      relativeSemitones: null,
    });
  }
  const median = medianHz(voicedHz);
  for (const frame of frames) {
    if (frame.hz !== null && median) {
      frame.relativeSemitones = 12 * Math.log2(frame.hz / median);
    }
  }
  const voicedCount = frames.filter((frame) => frame.voiced).length;
  return {
    frames,
    medianHz: median,
    voicedRatio: frames.length ? voicedCount / frames.length : 0,
    durationSeconds: audio.durationSeconds,
  };
}
