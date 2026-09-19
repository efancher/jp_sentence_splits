import type { SentenceAudio, SentenceVocabulary } from '../domain/types';
import type { TimeRangeMs } from '../lib/recording';

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
  link,
  onRangeChange,
  onLoopStart,
}: {
  audio: SentenceAudio;
  japanese: string;
  surfaceForm: string;
  link?: SentenceVocabulary;
  /** Forwarded to SegmentLoopPlayer — the span the loop plays, for drawing that span's measured pitch. */
  onRangeChange?: (range: TimeRangeMs | null) => void;
  /** Forwarded to SegmentLoopPlayer — fires when the learner starts the loop (usage tracking). */
  onLoopStart?: () => void;
}) {
  return (
    <SegmentLoopPlayer
      audio={audio}
      japanese={japanese}
      surfaceForm={surfaceForm}
      link={link}
      onRangeChange={onRangeChange}
      onLoopStart={onLoopStart}
      fallbackHint="Couldn’t isolate just the word — play the whole sentence for the native model."
    />
  );
}
