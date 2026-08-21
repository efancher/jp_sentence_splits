import type { WordAlignment } from '../domain/types';
import { segmentIntoMorae } from './mora';
import type { PitchAnalysisPayload, PitchFrame } from './pitch';
import {
  detectedDropPosition,
  expectedPitchShape,
  pitchPatternLabel,
  type MoraPitchClass,
} from './pitchAccentShape';
import type { TimingObservation } from './timingObservations';

/**
 * Ground-truth pitch-accent scoring: compares a learner's own recording
 * against a dictionary-predicted pitch shape (Kanjium, via
 * `scripts/backfill-pitch-accent.ts` -> `VocabularyItem.pitchAccentPositions`)
 * instead of a reference recording. Structurally different from
 * `pitchTimingObservations.ts`/`wordTimingObservations.ts`, which both
 * require a reference-clip alignment: this module only needs the
 * *learner's* alignment + pitch, so it works even for sentences with no
 * `SentenceAudio` at all (a step toward the not-yet-built audio-less
 * pronunciation drill mode).
 *
 * Because this is backed by real ground truth rather than another
 * recording's acoustic trend, it can make a more confident claim than
 * `pitchTimingObservations.ts` does — but it's still a rough,
 * mic/YIN-derived estimate over coarse equal-width mora buckets (not
 * true mora-duration-aware segmentation), so confidence still caps below
 * 'high' except for stark, well-covered mismatches. See
 * `pitchAccentShape.ts`'s module doc for the odaka/heiban ambiguity this
 * deliberately collapses rather than guesses at.
 */

export interface PitchAccentTarget {
  /** The exact inflected text as it appeared in the sentence (`SentenceVocabulary.surfaceForm`) — must exact-match a `WordAlignment.text`. */
  surfaceForm: string;
  reading: string;
  pitchAccentPositions: number[];
}

const MIN_VOICED_BUCKETS = 2;
const STARK_MORA_GAP = 2;

function isSilence(word: WordAlignment): boolean {
  return !word.text || word.text === '<eps>';
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function voicedSemitones(frames: PitchFrame[]): number[] {
  return frames
    .filter((frame): frame is PitchFrame & { relativeSemitones: number } =>
      frame.voiced && frame.relativeSemitones !== null,
    )
    .map((frame) => frame.relativeSemitones);
}

interface MoraeClassification {
  classes: MoraPitchClass[];
  voicedBucketCount: number;
}

/**
 * Slices `word`'s time span into `moraCount` equal-width buckets
 * (an approximation — real mora durations aren't isochronous, same class
 * of simplification the rest of this feedback system already accepts)
 * and classifies each bucket 'h'/'l' relative to the word's own overall
 * mean pitch — never sentence-wide register. A bucket with no voiced
 * frames carries forward the previous bucket's class (defaulting to 'l'
 * before any voiced bucket is seen — silence more often coincides with
 * an unvoiced/low stretch than a high one). Returns null when too few
 * buckets have any voiced signal to classify at all.
 */
function classifyLearnerMorae(
  word: WordAlignment,
  moraCount: number,
  pitch: PitchAnalysisPayload,
): MoraeClassification | null {
  if (moraCount <= 0) return null;
  const wordFrames = pitch.frames.filter(
    (frame) =>
      frame.voiced &&
      frame.relativeSemitones !== null &&
      frame.timeSeconds >= word.start &&
      frame.timeSeconds < word.end,
  );
  const overallMean = average(voicedSemitones(wordFrames));
  if (overallMean === null) return null;

  const bucketWidth = (word.end - word.start) / moraCount;
  const bucketMeans: Array<number | null> = [];
  for (let index = 0; index < moraCount; index += 1) {
    const bucketStart = word.start + index * bucketWidth;
    const bucketEnd = bucketStart + bucketWidth;
    const bucketFrames = wordFrames.filter(
      (frame) => frame.timeSeconds >= bucketStart && frame.timeSeconds < bucketEnd,
    );
    bucketMeans.push(average(voicedSemitones(bucketFrames)));
  }

  const voicedBucketCount = bucketMeans.filter((value) => value !== null).length;
  if (voicedBucketCount < Math.min(MIN_VOICED_BUCKETS, moraCount)) return null;

  let lastKnown: MoraPitchClass = 'l';
  const classes = bucketMeans.map((value) => {
    if (value !== null) lastKnown = value >= overallMean ? 'h' : 'l';
    return lastKnown;
  });

  return { classes, voicedBucketCount };
}

export function buildPitchAccentShapeObservations({
  learnerWords,
  learnerPitch,
  targets,
}: {
  learnerWords: WordAlignment[];
  learnerPitch: PitchAnalysisPayload;
  targets: PitchAccentTarget[];
}): TimingObservation[] {
  const observations: TimingObservation[] = [];
  const audibleWords = learnerWords.filter((word) => !isSilence(word));

  targets.forEach((target, targetIndex) => {
    if (!target.pitchAccentPositions.length) return;
    // MFA's word tier doesn't always line up with dictionary segmentation
    // (same caveat wordTimingObservations.ts documents) — no exact match
    // means silently skip, not an error.
    const word = audibleWords.find((candidate) => candidate.text === target.surfaceForm);
    if (!word) return;

    const morae = segmentIntoMorae(target.reading);
    if (morae.length === 0) return;

    const learnerResult = classifyLearnerMorae(word, morae.length, learnerPitch);
    if (!learnerResult) return;
    const { classes: learnerClasses, voicedBucketCount } = learnerResult;

    const detected = detectedDropPosition(learnerClasses);
    const expectedPosition = target.pitchAccentPositions[0]!;
    // Compare through the same shape->drop-position function on both
    // sides, not the raw dictionary position, so an odaka target is
    // never scored as a mismatch against a correctly-produced
    // heiban-shaped attempt (see pitchAccentShape.ts's module doc).
    const effectiveExpected = detectedDropPosition(expectedPitchShape(morae.length, expectedPosition));
    if (detected === effectiveExpected) return;

    const gap = Math.abs(effectiveExpected - detected);
    const isStark = gap >= STARK_MORA_GAP;
    const fullCoverage = voicedBucketCount === morae.length;
    const expectedLabel = pitchPatternLabel(expectedPosition, morae.length);
    const detectedLabel = pitchPatternLabel(detected, morae.length);
    const alternates = target.pitchAccentPositions.slice(1);

    observations.push({
      id: `pitch-accent-shape-${targetIndex}`,
      kind: 'pitch_accent_shape',
      confidence: isStark && fullCoverage ? 'high' : 'medium',
      severity: Math.min(1, gap / morae.length),
      segment: { startMs: word.start * 1000, endMs: word.end * 1000 },
      message: `Dictionaries mark 「${target.surfaceForm}」 as ${expectedLabel}; your pitch here sounds like ${detectedLabel} instead.`,
      detail:
        'Based on a rough per-mora pitch estimate from your recording — mic quality and natural speech variation can shift this.' +
        (alternates.length ? ` Also acceptable: position ${alternates.join(', ')}.` : ''),
    });
  });

  return observations;
}
