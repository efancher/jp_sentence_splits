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
export const PITCH_TRACK_VERSION = 3;

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
  fallbackThreshold = 0,
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
  if (tauEstimate < 0 && fallbackThreshold > 0) {
    // No clean dip: take the deepest one in range if it's still convincing —
    // recovers weakly voiced stretches (soft vowels after consonants) that the strict first-dip rule drops.
    let best = fallbackThreshold;
    for (let tau = minPeriod; tau <= maxPeriod; tau += 1) {
      const value = yinBuffer[tau] ?? 1;
      if (value < best) {
        best = value;
        tauEstimate = tau;
      }
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

/** Frames further than this (semitones) from the running reference are treated as suspect. */
const OCTAVE_SUSPECT_ST = 6;
/** Voiced frames considered when forming the running reference. */
const REFERENCE_WINDOW = 9;
/** Consecutive unfoldable far-off frames that are accepted as a genuine pitch jump. */
const GENUINE_JUMP_FRAMES = 6;
/** Consecutive folded frames (~0.3s) after which an "octave error" is taken as a real octave move. */
const SUSTAINED_FOLD_FRAMES = 20;
/** A frame this far from its local median is replaced by it (short glitches). */
const SPIKE_ST = 3;
/** Voiced frames more than this far apart in time are not neighbours for spike removal. */
const NEIGHBOUR_GAP_SECONDS = 0.08;

const semitonesBetween = (hz: number, ref: number): number => 12 * Math.log2(hz / ref);

/**
 * Repairs YIN's classic octave errors in a raw track (mutates `frames`).
 *
 * 1. Octave folding — walk the voiced frames in time order against a running
 *    median of recently accepted readings; a frame more than
 *    `OCTAVE_SUSPECT_ST` away whose ×2 or ÷2 lands back near the reference
 *    is corrected to that octave. Far-off frames that can't be folded don't
 *    update the reference, unless `GENUINE_JUMP_FRAMES` in a row agree, in
 *    which case it is a real pitch jump and the reference follows it.
 * 2. Spike removal — a 5-frame median over contiguous voiced frames replaces
 *    a reading more than `SPIKE_ST` from it (short non-octave glitches).
 */
export function correctPitchOutliers(frames: PitchFrame[]): void {
  const voiced = frames.filter((frame) => frame.voiced && frame.hz !== null);
  if (voiced.length < 3) return;
  const globalMedian = medianHz(voiced.map((frame) => frame.hz as number)) as number;

  const accepted: number[] = [];
  let stray: PitchFrame[] = [];
  let foldedRun: Array<{ frame: PitchFrame; original: number }> = [];
  for (const frame of voiced) {
    const hz = frame.hz as number;
    const ref =
      accepted.length >= 3
        ? (medianHz(accepted.slice(-REFERENCE_WINDOW)) as number)
        : globalMedian;
    if (Math.abs(semitonesBetween(hz, ref)) <= OCTAVE_SUSPECT_ST) {
      accepted.push(hz);
      stray = [];
      foldedRun = [];
      continue;
    }
    const folded = [hz * 2, hz / 2].find(
      (candidate) => Math.abs(semitonesBetween(candidate, ref)) <= OCTAVE_SUSPECT_ST - 2,
    );
    if (folded !== undefined) {
      foldedRun.push({ frame, original: hz });
      frame.hz = folded;
      accepted.push(folded);
      stray = [];
      if (foldedRun.length >= SUSTAINED_FOLD_FRAMES) {
        // Too long to be a tracker glitch: the speaker really moved an octave.
        for (const entry of foldedRun) entry.frame.hz = entry.original;
        accepted.length = 0;
        for (const entry of foldedRun) accepted.push(entry.original);
        foldedRun = [];
      }
      continue;
    }
    stray.push(frame);
    if (stray.length >= GENUINE_JUMP_FRAMES) {
      for (const strayFrame of stray) accepted.push(strayFrame.hz as number);
      stray = [];
    }
  }

  const folded = voiced.map((frame) => frame.hz as number);
  voiced.forEach((frame, index) => {
    const neighbours: number[] = [folded[index]!];
    for (const direction of [-1, 1]) {
      let previous = voiced[index]!;
      for (let step = 1; step <= 2; step += 1) {
        const next = voiced[index + direction * step];
        if (!next || Math.abs(next.timeSeconds - previous.timeSeconds) > NEIGHBOUR_GAP_SECONDS) break;
        neighbours.push(folded[index + direction * step]!);
        previous = next;
      }
    }
    if (neighbours.length < 5) return;
    const local = medianHz(neighbours) as number;
    if (Math.abs(semitonesBetween(folded[index]!, local)) > SPIKE_ST) frame.hz = local;
  });
}

export function extractPitch(audio: CanonicalAudio): PitchAnalysisPayload {
  const frames: PitchFrame[] = [];
  let peakRms = 0;
  for (let start = 0; start + FRAME_SIZE <= audio.samples.length; start += HOP_SIZE) {
    peakRms = Math.max(peakRms, frameRms(audio.samples.subarray(start, start + FRAME_SIZE)));
  }
  // Relative to the clip's loudest frame so quiet recordings aren't dropped wholesale.
  const rmsGate = Math.min(RMS_THRESHOLD, Math.max(0.002, peakRms * 0.04));
  for (let start = 0; start + FRAME_SIZE <= audio.samples.length; start += HOP_SIZE) {
    const frame = audio.samples.subarray(start, start + FRAME_SIZE);
    const timeSeconds = start / audio.sampleRate;
    const rms = frameRms(frame);
    if (rms < rmsGate) {
      frames.push({ timeSeconds, hz: null, voiced: false, confidence: 0, relativeSemitones: null });
      continue;
    }
    const { hz, confidence } = yinPitch(frame, audio.sampleRate, 0.35);
    const voiced = hz !== null && confidence >= 0.4;
    frames.push({
      timeSeconds,
      hz: voiced ? hz : null,
      voiced,
      confidence,
      relativeSemitones: null,
    });
  }
  correctPitchOutliers(frames);
  const median = medianHz(frames.flatMap((frame) => (frame.hz !== null ? [frame.hz] : [])));
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

/**
 * First and last voiced-frame time (seconds), with a small margin, clamped
 * to the clip — a speech-anchored window for drawing the pitch contour.
 * Reference clips are often cut with leading/trailing room tone, so drawing
 * a contour over the whole clip squashes the actual speech into part of the
 * width; anchoring the x-axis to this window instead lets a reference and a
 * tightly-trimmed learner take line up. Returns undefined when there aren't
 * at least two voiced frames.
 */
export function voicedTimeSpan(
  pitch: Pick<PitchAnalysisPayload, 'frames' | 'durationSeconds'> | undefined,
): { start: number; end: number } | undefined {
  if (!pitch) return undefined;
  const voiced = pitch.frames.filter(
    (frame) => frame.voiced && frame.relativeSemitones !== null,
  );
  if (voiced.length < 2) return undefined;
  const rawStart = voiced[0]!.timeSeconds;
  const rawEnd = voiced[voiced.length - 1]!.timeSeconds;
  const pad = Math.max(0.05, (rawEnd - rawStart) * 0.06);
  return {
    start: Math.max(0, rawStart - pad),
    end: Math.min(pitch.durationSeconds, rawEnd + pad),
  };
}

/**
 * Voiced relative-semitone extent of a track — `MeasuredPitchContour`'s
 * vertical scale when a caller wants a *shared* scale across several charts
 * of the same underlying clip (e.g. a word cropped out of a sentence, next
 * to the sentence's own full contour). Compute this once from the
 * *uncropped* track and pass it to every chart derived from that track, so
 * they all render the same semitone movement at the same visual steepness —
 * without it, a component that recomputes min/max from just its own visible
 * window stretches a narrow crop's small pitch range to fill the same chart
 * height as a wide crop's large one, making the same real movement look
 * dramatically different depending only on how tightly it happened to be
 * cropped. Returns undefined when there aren't at least two voiced frames
 * (same threshold `MeasuredPitchContour` itself uses to decide whether to
 * render at all).
 */
export function pitchSemitoneRange(
  payload: Pick<PitchAnalysisPayload, 'frames'>,
): { min: number; max: number } | undefined {
  const values = payload.frames
    .filter((frame) => frame.voiced && frame.relativeSemitones !== null)
    .map((frame) => frame.relativeSemitones as number);
  if (values.length < 2) return undefined;
  return robustRange(values);
}

/**
 * Plot range of a set of semitone readings: the full extent for short
 * tracks, the 2nd–98th percentile for long ones so a residual glitch frame
 * can't stretch the vertical scale and flatten the real contour. Callers
 * should clamp drawn points into the range.
 */
export function robustRange(values: number[]): { min: number; max: number } {
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length < 30) return { min: sorted[0]!, max: sorted[sorted.length - 1]! };
  const at = (fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))))]!;
  return { min: at(0.02), max: at(0.98) };
}
