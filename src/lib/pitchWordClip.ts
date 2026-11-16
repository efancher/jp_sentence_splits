import { segmentIntoMorae } from './mora';
import { expectedPitchShape } from './pitchAccentShape';
import type { PitchAnalysisPayload } from './pitch';
import type { TimeRangeMs } from './recording';

/** Word-only pitch clips cut from reference recordings (`getPitchWordClips`), for the pitch drill and contrast examples. */

/**
 * Sanity bounds on an isolated (padded) word clip, in ms — outside them the alignment is
 * probably off. The aligner span carries ~180 ms of padding, so 300 ms means a word of
 * at least ~120 ms; real 2-mora words run longer than that.
 */
export const MIN_CLIP_MS = 300;
export const MAX_CLIP_MS = 3000;

export interface PitchWordClip {
  /** The `SentenceVocabulary` occurrence this clip is cut from — target for a boundary correction. */
  linkId: string;
  vocabularyItemId: string;
  expression: string;
  reading: string;
  meaning: string;
  /** Dictionary accent position (`pitchAccentPositions[0]`). */
  position: number;
  moraCount: number;
  /** In-word high/low string, one char per mora, e.g. `lhh`. */
  shape: string;
  bookId: string;
  /** The word's own span in its reference recording. */
  span: TimeRangeMs;
}

/** A clip's mora count and in-word shape, or null for words too short (<2 morae) to have a contrast. */
export function inWordShape(
  reading: string,
  position: number,
): { moraCount: number; shape: string } | null {
  const moraCount = segmentIntoMorae(reading).length;
  if (moraCount < 2) return null;
  return { moraCount, shape: expectedPitchShape(moraCount, position).join('') };
}

export function isPlausibleClipSpan(span: TimeRangeMs): boolean {
  const length = span.endMs - span.startMs;
  return length >= MIN_CLIP_MS && length <= MAX_CLIP_MS;
}

/** Plain-language description of an in-word shape (heiban and odaka share one — see module doc). */
export function shapeLabel(shape: string): string {
  if (shape.startsWith('h')) return 'starts high, drops after the 1st mora (atamadaka)';
  const lastHigh = shape.lastIndexOf('h');
  if (lastHigh === shape.length - 1) return 'starts low, then stays up (heiban / odaka)';
  return `starts low, rises, drops after mora ${lastHigh + 1} (nakadaka)`;
}


/** The pitch payload cropped to a word's span and re-based to t=0, for drawing just that word's contour. */
export function cropPitchPayload(
  payload: PitchAnalysisPayload,
  span: TimeRangeMs,
): PitchAnalysisPayload {
  const start = span.startMs / 1000;
  const end = span.endMs / 1000;
  return {
    frames: payload.frames
      .filter((frame) => frame.timeSeconds >= start && frame.timeSeconds <= end)
      .map((frame) => ({ ...frame, timeSeconds: frame.timeSeconds - start })),
    medianHz: payload.medianHz,
    voicedRatio: payload.voicedRatio,
    durationSeconds: end - start,
  };
}
