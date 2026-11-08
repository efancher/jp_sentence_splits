import type { Sentence, WordAlignment } from '../domain/types';
import { chunkSentenceIntoTileDetails } from './earTiles';
import {
  alignerRangeToRawIndices,
  hasSquashedNeighbour,
  verifiedTokenCharRange,
} from './isolatedWordRange';

/**
 * Chunk chain shadowing (docs/ROADMAP.md, "Phrase shadowing"): build a sentence from its end,
 * shadowing the last phrase, then the last two, and so on up to the whole sentence. Growing from the
 * end keeps the sentence's final intonation intact at every rung. This module only plans the rungs
 * (pure; callers fetch the alignment): rungs are sized by *duration*, not chunk count, because long
 * caption-style sentences yield 8+ chunks and one chunk per rung would be an endless chain.
 */

/** The shortest first rung: less than this is a mis-click-sized phrase, not something to shadow. */
export const MIN_FIRST_RUNG_MS = 1000;
/** Each rung must add at least this much new audio to the one before it. */
export const MIN_RUNG_STEP_MS = 1200;
/** A chain is never longer than this many rungs, the whole sentence included. */
export const MAX_RUNGS = 5;
/** A chain needs a rung below the whole sentence to build from; below this, shadow the sentence directly. */
export const MIN_RUNGS = 3;

export interface ChainRung {
  /** Clip time the rung starts at; every rung ends where the sentence's speech ends. */
  startMs: number;
  endMs: number;
  /** The sentence text the rung covers (the chunks from `chunkIndex` on, joined). */
  text: string;
  /** Index of the first chunk the rung includes. */
  chunkIndex: number;
  /** True for the last rung, which is the whole sentence. */
  whole: boolean;
}

export type ChainRejection =
  | 'no-chunks'
  | 'unreliable-alignment'
  | 'too-short'
  | null;

export interface ChainPlan {
  rungs: ChainRung[];
  rejection: ChainRejection;
}

/**
 * Start time of every chunk after the first, in clip milliseconds; null for a chunk whose start the
 * aligner can't be trusted to place (the token that starts it doesn't verify against the text, or a
 * squashed token sits beside it). A rung cut in the wrong place would play the wrong audio, so such a
 * cut is dropped and the other cuts still serve; trouble far from a cut doesn't matter.
 */
function chunkStartTimes(
  japanese: string,
  chunkStarts: readonly number[],
  alignment: readonly WordAlignment[],
): (number | null)[] {
  const usable = alignment.filter((word) => word.text && word.text !== '<eps>');
  const tokenRawStarts = usable.map((_, index) => {
    const range = verifiedTokenCharRange(usable, japanese, index);
    return range ? alignerRangeToRawIndices(japanese, range.start, range.end).start : null;
  });

  return chunkStarts.map((rawStart) => {
    const token = tokenRawStarts.findIndex((start) => start !== null && start >= rawStart);
    if (token < 0) return null;
    // The token before the cut must also verify, or the cut could land inside an unplaced blob.
    if (token > 0 && tokenRawStarts[token - 1] === null) return null;
    if (hasSquashedNeighbour(usable, Math.max(0, token - 1), token)) return null;
    return usable[token]!.start * 1000;
  });
}

/**
 * The rungs of a sentence's chunk chain, shortest first, ending with the whole sentence. Rejects (with
 * the reason) a sentence that can't be chunked, whose alignment can't place the chunks, or that is too
 * short to have two rungs below the whole sentence once rungs are sized by duration.
 */
export function planChunkChain(
  sentence: Pick<Sentence, 'japanese' | 'vocabularySuggestions'>,
  alignment: readonly WordAlignment[],
): ChainPlan {
  const chunks = chunkSentenceIntoTileDetails(sentence);
  if (!chunks || chunks.length < 2) return { rungs: [], rejection: 'no-chunks' };

  const usable = alignment.filter((word) => word.text && word.text !== '<eps>');
  if (usable.length === 0) return { rungs: [], rejection: 'unreliable-alignment' };
  const speechStartMs = usable[0]!.start * 1000;
  const endMs = usable[usable.length - 1]!.end * 1000;

  const cutTimes = chunkStartTimes(
    sentence.japanese,
    chunks.slice(1).map((chunk) => chunk.start),
    alignment,
  );
  if (cutTimes.every((time) => time === null)) return { rungs: [], rejection: 'unreliable-alignment' };

  // Sized by duration: each rung adds at least `step` of new audio, and `step` grows with the sentence
  // so the chain never exceeds MAX_RUNGS.
  const step = Math.max(MIN_RUNG_STEP_MS, (endMs - speechStartMs) / MAX_RUNGS);
  const rungs: ChainRung[] = [];
  let previousSpan = 0;
  for (let chunkIndex = chunks.length - 1; chunkIndex >= 1; chunkIndex -= 1) {
    const startMs = cutTimes[chunkIndex - 1];
    if (startMs === null || startMs === undefined) continue;
    const span = endMs - startMs;
    const required = rungs.length === 0 ? Math.max(MIN_FIRST_RUNG_MS, step) : step;
    // A cut too close to the sentence's own start would leave a whole-sentence rung barely longer than it.
    if (span - previousSpan < required || startMs - speechStartMs < step) continue;
    rungs.push({
      startMs,
      endMs,
      text: chunks
        .slice(chunkIndex)
        .map((chunk) => chunk.text)
        .join(''),
      chunkIndex,
      whole: false,
    });
    previousSpan = span;
  }
  rungs.push({
    startMs: speechStartMs,
    endMs,
    text: chunks.map((chunk) => chunk.text).join(''),
    chunkIndex: 0,
    whole: true,
  });
  if (rungs.length < MIN_RUNGS) {
    const unplaced = cutTimes.some((time) => time === null);
    return { rungs: [], rejection: unplaced ? 'unreliable-alignment' : 'too-short' };
  }
  return { rungs, rejection: null };
}
