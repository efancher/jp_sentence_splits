import type { WordAlignment } from '../domain/types';
import type { PitchAnalysisPayload } from './pitch';
import { classifyLearnerMorae } from './pitchAccentObservations';
import { expectedPitchShape } from './pitchAccentShape';
import { fitAccentShape } from './pitchShapeFit';

/**
 * Audits whether a *native* clip actually realizes the dictionary accent it's
 * used to test — the fairness check behind the `pitch_accent` card and drill.
 * Reuses the learner scorer's own per-mora rule (`classifyLearnerMorae`: equal
 * buckets over the word's span, each high/low relative to the word's own
 * mean), so "the native clip disagrees" means the same thing the drill would
 * mean if it graded that clip. Word-internal only: heiban vs odaka needs the
 * following particle and is deliberately not measured here.
 */

export interface NativeWordMeasurement {
  moraCount: number;
  /** Dictionary in-word high/low string (`lhhl`), heiban/odaka folded together. */
  expectedShape: string;
  /** Measured high/low string under the learner-scoring rule; null when too little voiced signal. */
  measuredShape: string | null;
  /** Whether `measuredShape === expectedShape`; null when unmeasurable. */
  agrees: boolean | null;
  /** How many of the word's mora buckets had any voiced frame. */
  voicedBuckets: number;
  /** The best-fitting *valid* accent shape (`fitAccentShape`) — more robust than the per-mora rule on native audio; null when there is no clear contrast. */
  fitShape: string | null;
  /** Whether `fitShape === expectedShape`; null when the fit is unavailable. */
  fitAgrees: boolean | null;
  /** High − low contrast of the fitted shape, semitones. */
  fitContrastSemitones: number | null;
  /**
   * Mean(expected-high buckets) − mean(expected-low buckets), in semitones,
   * using only voiced buckets — how far apart the clip's highs and lows
   * really are. Small (≲1.5 st) or negative means the cue is weak or absent
   * in this clip. Null when either group has no voiced bucket.
   */
  separationSemitones: number | null;
}

export function measureNativeWord({
  pitch,
  span,
  surfaceForm,
  moraCount,
  position,
  moraIntervals,
}: {
  /** The word's measured mora intervals in seconds, when known — see `classifyLearnerMorae`. */
  moraIntervals?: readonly { start: number; end: number }[] | null;
  pitch: PitchAnalysisPayload;
  /** The word's own aligner boundaries (`isolatedWordMatchRange`) — unpadded, so the measurement stays inside the word. */
  span: { startMs: number; endMs: number };
  surfaceForm: string;
  moraCount: number;
  position: number;
}): NativeWordMeasurement | null {
  if (moraCount < 2) return null;
  const { startMs, endMs } = span;
  if (endMs <= startMs) return null;

  const expected = expectedPitchShape(moraCount, position);
  const expectedShape = expected.join('');
  const word: WordAlignment = { text: surfaceForm, start: startMs / 1000, end: endMs / 1000, phones: [] };
  const result = classifyLearnerMorae(word, moraCount, pitch, undefined, moraIntervals);
  if (!result) {
    return { moraCount, expectedShape, measuredShape: null, agrees: null, voicedBuckets: 0, fitShape: null, fitAgrees: null, fitContrastSemitones: null, separationSemitones: null };
  }

  const highs: number[] = [];
  const lows: number[] = [];
  result.bucketMeans.forEach((mean, index) => {
    if (mean === null) return;
    (expected[index] === 'h' ? highs : lows).push(mean);
  });
  const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const measuredShape = result.classes.slice(0, moraCount).join('');
  const fit = fitAccentShape(result.bucketMeans);
  const fitShape = fit ? fit.shape.join('') : null;
  return {
    fitShape,
    fitAgrees: fitShape === null ? null : fitShape === expectedShape,
    fitContrastSemitones: fit ? fit.contrastSemitones : null,
    moraCount,
    expectedShape,
    measuredShape,
    agrees: measuredShape === expectedShape,
    voicedBuckets: result.voicedBucketCount,
    separationSemitones: highs.length > 0 && lows.length > 0 ? avg(highs) - avg(lows) : null,
  };
}

export interface BinStat {
  label: string;
  n: number;
  correct: number;
  /** Sum of each observation's chance-level accuracy (only those that supplied `chance`); divide by `n` for the bin's expected accuracy from guessing. */
  chanceSum: number;
}

/** Buckets `(separation, correct)` observations by semitone separation, for "accuracy vs cue strength". */
export function accuracyBySeparation(
  observations: readonly {
    separationSemitones: number | null;
    correct: boolean;
    /** Probability of being right by guessing (1 / answer choices) — longer words have more choices, so bins need this to be comparable. */
    chance?: number;
  }[],
  edges: readonly number[] = [0, 1.5, 3],
): BinStat[] {
  const bins: BinStat[] = [
    { label: `< ${edges[0]} st (cue absent/inverted)`, n: 0, correct: 0, chanceSum: 0 },
    ...edges.slice(0, -1).map((low, index) => ({
      label: `${low}–${edges[index + 1]} st`,
      n: 0,
      correct: 0,
      chanceSum: 0,
    })),
    { label: `≥ ${edges[edges.length - 1]} st (clear)`, n: 0, correct: 0, chanceSum: 0 },
  ];
  for (const { separationSemitones, correct, chance } of observations) {
    if (separationSemitones === null) continue;
    let index = edges.findIndex((edge) => separationSemitones < edge);
    if (index === -1) index = edges.length;
    bins[index]!.n += 1;
    if (correct) bins[index]!.correct += 1;
    bins[index]!.chanceSum += chance ?? 0;
  }
  return bins;
}

/** Inverse normal CDF (Acklam's rational approximation), for d′. */
function inverseNormalCdf(p: number): number {
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - low) return -inverseNormalCdf(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

export interface SignalDetection {
  /** Trials where the target pattern (`signal`) was correct answer, and how many were answered `signal`. */
  signalTrials: number;
  hits: number;
  /** Trials where the *other* pattern was correct, and how many were wrongly answered `signal`. */
  noiseTrials: number;
  falseAlarms: number;
  /** Discrimination between the two patterns; 0 = chance, ~2+ = clear. Null with no trials on a side. */
  dPrime: number | null;
  /** Bias toward answering `signal`: c < 0 leans to `signal`, c > 0 leans away; ~0 = unbiased. */
  criterion: number | null;
}

/**
 * Signal-detection summary for a two-pattern discrimination (e.g. `hl` vs
 * `lh`) from `(expected, chosen)` pairs — separates "can't tell them apart"
 * (d′ ≈ 0) from "tells them apart but leans one way" (d′ > 0, c ≠ 0).
 * Rates of exactly 0/1 get the standard log-linear correction (+0.5/+1).
 */
export function signalDetection(
  pairs: readonly { expected: string; chosen: string }[],
  signal: string,
  noise: string,
): SignalDetection {
  let signalTrials = 0;
  let hits = 0;
  let noiseTrials = 0;
  let falseAlarms = 0;
  for (const { expected, chosen } of pairs) {
    if (expected === signal) {
      signalTrials += 1;
      if (chosen === signal) hits += 1;
    } else if (expected === noise) {
      noiseTrials += 1;
      if (chosen === signal) falseAlarms += 1;
    }
  }
  if (signalTrials === 0 || noiseTrials === 0) {
    return { signalTrials, hits, noiseTrials, falseAlarms, dPrime: null, criterion: null };
  }
  const hitRate = (hits + 0.5) / (signalTrials + 1);
  const falseAlarmRate = (falseAlarms + 0.5) / (noiseTrials + 1);
  const zHit = inverseNormalCdf(hitRate);
  const zFalseAlarm = inverseNormalCdf(falseAlarmRate);
  return {
    signalTrials,
    hits,
    noiseTrials,
    falseAlarms,
    dPrime: zHit - zFalseAlarm,
    criterion: -(zHit + zFalseAlarm) / 2,
  };
}
