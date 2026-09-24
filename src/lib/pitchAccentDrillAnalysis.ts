import type { WordAlignment } from '../domain/types';
import { alignAudioDetailed, type AlignAudioFailureReason } from './analysisApi';
import { extractPitch, type PitchAnalysisPayload } from './pitch';
import {
  buildLearnerPitchAccentShapes,
  buildPitchAccentShapeObservations,
  type PitchAccentTarget,
} from './pitchAccentObservations';
import type { MoraPitchClass } from './pitchAccentShape';
import type { TimingObservation } from './timingObservations';
import { canonicalizeAudioBuffer, decodeAudioBuffer } from './waveform';

/**
 * Shared recording→pitch-accent-scoring pipeline: originally
 * `PitchAccentDrillPage`'s free-practice loop, extracted so the
 * `pitch_accent_production` SRS review card (`ReviewPage.tsx`) can run the
 * identical analysis (docs/ROADMAP.md "Pull the pitch-accent production
 * drill into a review card…") — same scoring, same "alignment failed"
 * outcome, no drift between the two surfaces.
 */
export type PitchAccentDrillAnalysisState =
  | { status: 'idle' }
  | { status: 'analyzing' }
  | {
      status: 'unavailable';
      learnerPitch?: PitchAnalysisPayload;
      reason?: AlignAudioFailureReason;
    }
  | {
      status: 'done';
      observations: TimingObservation[];
      /** The learner's measured YIN pitch track for the whole take. */
      learnerPitch?: PitchAnalysisPayload;
      /** The take's forced-alignment words — feeds the kana ruler under the contour. */
      learnerWords: WordAlignment[];
      /** Words whose take was flat (`FLAT_CONTRAST_SEMITONES`) — no accent could be read. */
      flatSurfaces: Set<string>;
      /** Learner's own measured per-mora H/L, keyed by surface form — the second line under the dictionary row. */
      learnerClassesBySurface: Map<string, MoraPitchClass[]>;
      /** High − low contrast of the learner's fitted shape (`gradeLearnerMorae`), keyed by surface form — feeds the native-clip continuous comparison. */
      learnerContrastBySurface: Map<string, number | null>;
      /** Learner's measured level on each word's attached particle, keyed by surface form (odaka/heiban cue). */
      learnerFollowingBySurface: Map<string, MoraPitchClass>;
      /** `observations`, keyed back to the target word they were scored against — usage-log attribution (`logPitchDrillAttempt`). */
      observationBySurfaceForm: Map<string, TimingObservation>;
      /** Accent-bearing target words in the take — the denominator for "measured N of M". */
      scorableCount: number;
    };

export async function analyzePitchAccentDrillRecording(
  blob: Blob,
  transcript: string,
  targets: PitchAccentTarget[],
): Promise<PitchAccentDrillAnalysisState> {
  // The measured pitch track is independent of the alignment service — keep it
  // even when alignment is down so the contour still renders.
  let pitch: PitchAnalysisPayload | undefined;
  try {
    const buffer = await decodeAudioBuffer(blob);
    pitch = extractPitch(canonicalizeAudioBuffer(buffer));
  } catch {
    pitch = undefined;
  }
  try {
    const { result: alignment, reason } = await alignAudioDetailed(blob, transcript);
    if (!alignment || !pitch) return { status: 'unavailable', learnerPitch: pitch, reason };
    const scorableTargets = targets
      .filter((target) => target.pitchAccentPositions?.length)
      .map((target) => ({
        surfaceForm: target.surfaceForm,
        reading: target.reading,
        pitchAccentPositions: target.pitchAccentPositions,
        followingMora: target.followingMora,
      }));
    const observations = buildPitchAccentShapeObservations({
      learnerWords: alignment.words,
      learnerPitch: pitch,
      targets: scorableTargets,
    });
    const learnerClassesBySurface = new Map<string, MoraPitchClass[]>();
    const learnerContrastBySurface = new Map<string, number | null>();
    const learnerFollowingBySurface = new Map<string, MoraPitchClass>();
    const flatSurfaces = new Set<string>();
    for (const shape of buildLearnerPitchAccentShapes({
      learnerWords: alignment.words,
      learnerPitch: pitch,
      targets: scorableTargets,
    })) {
      learnerClassesBySurface.set(shape.surfaceForm, shape.classes);
      learnerContrastBySurface.set(shape.surfaceForm, shape.contrastSemitones);
      if (shape.flat) flatSurfaces.add(shape.surfaceForm);
      if (shape.followingClass) learnerFollowingBySurface.set(shape.surfaceForm, shape.followingClass);
    }
    // `buildPitchAccentShapeObservations` ids each observation
    // `pitch-accent-shape-${targetIndex}`, indexed into the same
    // `scorableTargets` array passed in above — recover the surface form so
    // usage logging can attribute a mismatch to the right word.
    const observationBySurfaceForm = new Map<string, TimingObservation>();
    for (const observation of observations) {
      const match = /^pitch-accent-shape-(\d+)$/.exec(observation.id);
      const target = match ? scorableTargets[Number(match[1])] : undefined;
      if (target) observationBySurfaceForm.set(target.surfaceForm, observation);
    }
    return {
      status: 'done',
      observations,
      learnerPitch: pitch,
      learnerWords: alignment.words,
      flatSurfaces,
      learnerClassesBySurface,
      learnerContrastBySurface,
      learnerFollowingBySurface,
      observationBySurfaceForm,
      scorableCount: scorableTargets.length,
    };
  } catch {
    return { status: 'unavailable', learnerPitch: pitch };
  }
}
