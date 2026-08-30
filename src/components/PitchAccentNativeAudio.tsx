import type { SentenceAudio } from '../domain/types';

import { SegmentLoopPlayer } from './SegmentLoopPlayer';

/**
 * Pitch-accent review reveal (ReviewPage `pitch_accent` card): when the
 * sentence has a native recording, lets the learner loop just the target
 * word — a model of how a native actually realizes the accent, next to the
 * dictionary contour diagram. A thin wrapper over the shared
 * SegmentLoopPlayer (isolate a word's span via forced alignment and loop
 * it, pitch-preserving speed control, whole-sentence fallback).
 */
export function PitchAccentNativeAudio({
  audio,
  japanese,
  surfaceForm,
}: {
  audio: SentenceAudio;
  japanese: string;
  surfaceForm: string;
}) {
  return (
    <SegmentLoopPlayer
      audio={audio}
      japanese={japanese}
      surfaceForm={surfaceForm}
      fallbackHint="Couldn’t isolate just the word — play the whole sentence for the native model."
    />
  );
}
