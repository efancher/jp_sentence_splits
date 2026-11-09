import type { Sentence, WordAlignment } from '../domain/types';
import { chunkSentenceIntoTileDetails } from './earTiles';
import { isParticleToken, phraseTextFromAlignment } from './phraseShadow';
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
export const MIN_RUNG_STEP_MS = 700;
/** A chain is never longer than this many rungs, the whole sentence included. */
export const MAX_RUNGS = 12;
/** No rung adds more than this much new audio to the one before it (a longer phrase is split at word boundaries). */
export const MAX_RUNG_STEP_MS = 3000;
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

  // One phrase (chunk) per rung: a chunk shorter than `step` is merged into the next, and `step` grows with
  // very long sentences so the chain never exceeds MAX_RUNGS.
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
  const whole: ChainRung = {
    startMs: speechStartMs,
    endMs,
    text: chunks.map((chunk) => chunk.text).join(''),
    chunkIndex: 0,
    whole: true,
  };
  const capped = capRungSteps([...rungs, whole], sentence.japanese, alignment);
  if (capped.length < MIN_RUNGS) {
    const unplaced = cutTimes.some((time) => time === null);
    return { rungs: [], rejection: unplaced ? 'unreliable-alignment' : 'too-short' };
  }
  return { rungs: capped, rejection: null };
}

/**
 * Chunk boundaries can be sparse (one long clause with no pause), which would make a rung many seconds
 * longer than the one before it. Where a step would add more than the cap, extra cuts go at aligned word
 * starts (never a particle) so no step asks the learner to take on a long new stretch at once.
 */
function capRungSteps(
  rungs: readonly ChainRung[],
  japanese: string,
  alignment: readonly WordAlignment[],
): ChainRung[] {
  const words = cuttableWords(alignment);
  const endMs = rungs[0]!.endMs;
  const speechStartMs = rungs[rungs.length - 1]!.startMs;
  const maxStep = Math.max(MAX_RUNG_STEP_MS, (endMs - speechStartMs) / MAX_RUNGS);
  const candidates = words.slice(1).filter((word) => !isParticleToken(word));
  const result: ChainRung[] = [];
  let previousSpan = 0;
  for (const rung of rungs) {
    const span = endMs - rung.startMs;
    const gap = span - previousSpan;
    if (gap > maxStep) {
      const pieces = Math.ceil(gap / maxStep);
      let lastStart = result.length > 0 ? result[result.length - 1]!.startMs : endMs;
      for (let piece = 1; piece < pieces; piece += 1) {
        const target = endMs - (previousSpan + (gap * piece) / pieces);
        let best: WordAlignment | undefined;
        for (const word of candidates) {
          const start = word.start * 1000;
          if (start <= rung.startMs + MIN_CUSTOM_STEP_MS || start >= lastStart - MIN_CUSTOM_STEP_MS) continue;
          if (!best || Math.abs(start - target) < Math.abs(best.start * 1000 - target)) best = word;
        }
        if (!best) continue;
        const startMs = best.start * 1000;
        result.push({
          startMs,
          endMs,
          text: phraseTextFromAlignment(words, { startMs, endMs }, japanese),
          chunkIndex: rung.chunkIndex,
          whole: false,
        });
        lastStart = startMs;
      }
    }
    result.push(rung);
    previousSpan = span;
  }
  return result;
}

/** The closest a hand-placed cut may sit to its neighbour (or the sentence's edges): a step shorter than this is not a phrase. */
export const MIN_CUSTOM_STEP_MS = 500;

/** Aligned words a learner can place a cut before: spoken, real tokens, in time order. */
export function cuttableWords(alignment: readonly WordAlignment[]): WordAlignment[] {
  return alignment.filter((word) => word.text && !word.text.startsWith('<') && word.end > word.start);
}

/**
 * Rungs from hand-placed cuts (clip ms). Each cut snaps to the nearest aligned word start, so a cut can
 * never fall inside a word; cuts that coincide, sit at the sentence's start, or leave a step shorter than
 * MIN_CUSTOM_STEP_MS are dropped. Returns null when fewer than two rungs (one cut plus the whole
 * sentence) remain. Unlike the planner this trusts the learner's choice, so it applies no duration rule.
 */
export function rungsFromCutTimes(
  japanese: string,
  alignment: readonly WordAlignment[],
  cutsMs: readonly number[],
): ChainRung[] | null {
  const words = cuttableWords(alignment);
  if (words.length < 2) return null;
  const speechStartMs = words[0]!.start * 1000;
  const endMs = words[words.length - 1]!.end * 1000;
  const snapped = new Set<number>();
  for (const cut of cutsMs) {
    let best = words[1]!;
    for (const word of words.slice(1)) {
      if (Math.abs(word.start * 1000 - cut) < Math.abs(best.start * 1000 - cut)) best = word;
    }
    snapped.add(best.start * 1000);
  }
  const kept: number[] = [];
  let previous = speechStartMs;
  for (const time of [...snapped].sort((a, b) => a - b)) {
    if (time - previous < MIN_CUSTOM_STEP_MS || endMs - time < MIN_CUSTOM_STEP_MS) continue;
    kept.push(time);
    previous = time;
  }
  if (kept.length === 0) return null;
  const textFor = (startMs: number) => phraseTextFromAlignment(words, { startMs, endMs }, japanese);
  const rungs: ChainRung[] = kept
    .slice()
    .reverse()
    .map((startMs, index) => ({ startMs, endMs, text: textFor(startMs), chunkIndex: kept.length - index, whole: false }));
  rungs.push({ startMs: speechStartMs, endMs, text: textFor(speechStartMs), chunkIndex: 0, whole: true });
  return rungs;
}
