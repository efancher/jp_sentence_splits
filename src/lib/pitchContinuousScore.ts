import { detectedDropPosition, type MoraPitchClass } from './pitchAccentShape';

/**
 * Continuous (not just correct/incorrect) comparison of a drill take's
 * measured pitch against a real native clip of the same word — the
 * "continuous scoring" item from ROADMAP.md's "Pitch-accent: analysis
 * tools" entry. `gradeLearnerMorae`'s categorical shape match (and the
 * `pitch_accent` card's pass/fail) collapses a near-miss and a wild swing
 * to the same "mismatch" — this keeps the distance, so a learner falling
 * one mora late, or with half the native's contrast, can see themselves
 * getting closer over time even before the categorical grade flips to a
 * match. Both semitone values are already relative-to-own-median (see
 * `pitch.ts#extractPitch`), so comparing a magnitude ratio across two
 * different speakers is meaningful without any extra normalization —
 * never compares absolute pitch/Hz.
 */
export interface ContinuousPitchComparison {
  /** |learner's fitted drop mora − native's fitted drop mora|, both 0 = no drop (heiban/odaka-in-word). */
  fallTimingErrorMorae: number;
  /**
   * learner contrast ÷ native contrast, e.g. 0.5 = half the native's high/low
   * separation. Null when the native clip's own contrast is too weak to
   * divide by (`MIN_NATIVE_CONTRAST_FOR_RATIO`) — a weak-cue native clip
   * (see `pitchCueSeparationSemitones`) can't anchor a ratio.
   */
  fallMagnitudeRatio: number | null;
  nativeContrastSemitones: number;
  learnerContrastSemitones: number;
}

/** Below this native contrast (semitones) the clip's own cue is too weak to divide a ratio against — same floor as `FLAT_CONTRAST_SEMITONES`, one decimal up for a stricter denominator. */
export const MIN_NATIVE_CONTRAST_FOR_RATIO = 1;

/**
 * `null` when either side has no usable fit — a flat/unmeasurable take, or
 * a native clip whose own shape fit failed (see `measureNativeWord`).
 * Degrades silently; callers should just omit the comparison rather than
 * show an error.
 */
export function compareFallToNative(
  learnerClasses: readonly MoraPitchClass[],
  learnerContrastSemitones: number | null,
  native: { fitShape: string | null; fitContrastSemitones: number | null },
): ContinuousPitchComparison | null {
  if (!native.fitShape || native.fitContrastSemitones === null) return null;
  if (learnerContrastSemitones === null || learnerClasses.length === 0) return null;
  const nativeClasses = native.fitShape.split('') as MoraPitchClass[];
  const fallTimingErrorMorae = Math.abs(
    detectedDropPosition([...learnerClasses]) - detectedDropPosition(nativeClasses),
  );
  const fallMagnitudeRatio =
    native.fitContrastSemitones >= MIN_NATIVE_CONTRAST_FOR_RATIO
      ? learnerContrastSemitones / native.fitContrastSemitones
      : null;
  return {
    fallTimingErrorMorae,
    fallMagnitudeRatio,
    nativeContrastSemitones: native.fitContrastSemitones,
    learnerContrastSemitones,
  };
}
