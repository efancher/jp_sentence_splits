import type { WordAlignment } from '../domain/types';

import type { MoraUnit } from './mora';
import { phonesToMoraIntervals } from './moraTiming';
import type { PitchAnalysisPayload } from './pitch';
import type { MoraPitchClass } from './pitchAccentShape';
import { fitAccentShape } from './pitchShapeFit';

/**
 * Phrase-level pitch: the native contour of each *phrase* (a content word plus
 * the particles and endings that ride on it) next to the learner's, mora by
 * mora. Japanese accent is realised over the phrase, not the bare word — flat
 * versus falling-at-the-end is only audible on the particle — so this is the
 * unit a learner actually hears and has to produce.
 *
 * No rule-predicted target: the native *recording* is the answer key. Its H/L
 * shape per phrase is fitted to the accent shapes Japanese allows
 * (`fitAccentShape`, ~56% dictionary agreement on native clips vs 40% for the
 * old per-mora rule). The learner's is fitted the same way for display, but with
 * an honest "flat" state — a learner contour that is not valid Japanese is the
 * mistake worth showing, and `levels` (each mora's height within the phrase) is
 * returned so the view can draw the raw contour beside the fitted H/L.
 *
 * Needs exact mora timing (every token's phones parse and add up to the
 * sentence's morae — `exactMoraIntervals`; ~73% of sentences). Anything less and
 * that speaker's side is reported unavailable, never guessed.
 */

const INAUDIBLE = new Set(['', '<eps>', '<unk>', '<sil>', '<pad>']);

/** A pause at least this long between two tokens is a phrase boundary. */
export const PHRASE_PAUSE_SECONDS = 0.15;

/**
 * Closed list of tokens that attach to the preceding phrase instead of starting one:
 * case/binding particles and the copula / polite endings. Deliberately small —
 * anything unknown starts its own phrase, which only ever splits a phrase too
 * finely and never merges two content words.
 */
const FUNCTION_TOKENS = new Set([
  'は', 'が', 'を', 'に', 'へ', 'と', 'で', 'の', 'も', 'や', 'か', 'ね', 'よ', 'わ', 'さ',
  'から', 'まで', 'より', 'って', 'ので', 'のに', 'けど', 'けれど', 'し', 'ば',
  'です', 'でした', 'ます', 'ました', 'ません', 'ましょう', 'だ', 'だった', 'じゃ', 'では',
]);

/** A learner contour below this contrast (semitones) is called flat. */
export const FLAT_CONTRAST_SEMITONES = 1;

export interface PhraseToken {
  text: string;
  start: number;
  end: number;
}

/**
 * Groups audible tokens into phrases as arrays of token indices: a token starts a
 * new phrase unless it is a function token (particle / ending) that follows
 * closely after the previous token.
 */
export function groupIntoPhrases(tokens: readonly PhraseToken[], pauseSeconds = PHRASE_PAUSE_SECONDS): number[][] {
  const phrases: number[][] = [];
  tokens.forEach((token, index) => {
    const previous = tokens[index - 1];
    const attaches =
      previous !== undefined &&
      FUNCTION_TOKENS.has(token.text) &&
      token.start - previous.end < pauseSeconds &&
      phrases.length > 0;
    if (attaches) phrases[phrases.length - 1]!.push(index);
    else phrases.push([index]);
  });
  return phrases;
}

export interface SpeakerInput {
  words: readonly WordAlignment[];
  pitch: PitchAnalysisPayload;
  /** Seconds to subtract from a word time to get its pitch-frame time (the reference pitch may be sliced to a practice range). */
  pitchOffsetSeconds?: number;
}

export type PhraseStatus =
  | 'match' // your fitted shape equals the native one
  | 'different' // a valid shape, but not the native one
  | 'flat' // your contour has no clear high/low contrast
  | 'weak-native' // the native contour itself has no clear contrast — nothing to judge against
  | 'no-learner'; // your recording could not be lined up mora by mora, or had no voiced pitch here

export interface PhraseRow {
  text: string;
  kana: string[];
  native: MoraPitchClass[];
  nativeContrast: number;
  /** Each mora's mean pitch as a 0..1 height within this phrase for that speaker (null = unvoiced). */
  nativeLevels: (number | null)[];
  learner: MoraPitchClass[] | null;
  learnerContrast: number | null;
  learnerLevels: (number | null)[] | null;
  status: PhraseStatus;
  /** One plain sentence about how the native phrase moves, e.g. "starts low, rises, then falls after ま". */
  nativeSummary: string;
  learnerSummary: string | null;
  /** How many of this phrase's morae had voiced pitch in your recording (null = not lined up). */
  learnerVoicedMorae: number | null;
}

export interface PhrasePitchResult {
  rows: PhraseRow[];
  /** Set when nothing could be shown, and why (for a one-line explanation). */
  unavailable?: 'no-reference-timing' | 'no-reading' | 'no-pitch';
  /** True when the learner side could not be lined up mora by mora at all. */
  learnerUnavailable: boolean;
  /** How many of your tokens were timed by an even split rather than from their sounds (0 = all exact). */
  learnerApproximateTokens: number;
  /** Why the learner side is unavailable (for the message): a different word count than the native, or a word with no timing. */
  learnerUnavailableReason?: 'token-count' | 'no-span';
}

interface TokenTiming {
  intervals: { start: number; end: number }[];
}

/**
 * The learner's per-token mora intervals, laid out on the *reference's* per-token mora counts.
 * A learner's phones are messier than a native's (dropped or extra vowels, `spn`), so a token whose
 * phones don't give exactly the expected morae is split evenly across its aligned span instead —
 * the token boundaries from the aligner are still trustworthy. Null only when a token has no
 * usable span at all. `approximate` counts the tokens that needed the even split.
 */
function learnerTokenTimings(
  tokens: readonly WordAlignment[],
  expected: readonly TokenTiming[],
): { timings: TokenTiming[]; approximate: number } | null {
  const timings: TokenTiming[] = [];
  let approximate = 0;
  for (let t = 0; t < tokens.length; t += 1) {
    const want = expected[t]!.intervals.length;
    const exact = phonesToMoraIntervals(tokens[t]!.phones);
    if (exact && exact.length === want) {
      timings.push({ intervals: exact });
      continue;
    }
    const { start, end } = tokens[t]!;
    if (!(end > start)) return null;
    const step = (end - start) / want;
    timings.push({ intervals: Array.from({ length: want }, (_, i) => ({ start: start + i * step, end: start + (i + 1) * step })) });
    approximate += 1;
  }
  return { timings, approximate };
}

/** Per-token mora intervals when every token parses and they sum to `moraCount`; else null. */
function tokenTimings(tokens: readonly WordAlignment[], moraCount: number): TokenTiming[] | null {
  const out: TokenTiming[] = [];
  let total = 0;
  for (const token of tokens) {
    const intervals = phonesToMoraIntervals(token.phones);
    if (!intervals || intervals.length === 0) return null;
    out.push({ intervals });
    total += intervals.length;
  }
  return total === moraCount ? out : null;
}

function meanSemitones(pitch: PitchAnalysisPayload, from: number, to: number): number | null {
  let sum = 0;
  let count = 0;
  for (const frame of pitch.frames) {
    if (!frame.voiced || frame.relativeSemitones === null) continue;
    if (frame.timeSeconds >= from && frame.timeSeconds < to) {
      sum += frame.relativeSemitones;
      count += 1;
    }
  }
  return count > 0 ? sum / count : null;
}

/** Heights 0..1 within the phrase (0 = its lowest voiced mora). All-equal → 0.5. */
function toLevels(means: readonly (number | null)[]): (number | null)[] {
  const voiced = means.filter((m): m is number => m !== null);
  if (voiced.length === 0) return means.map(() => null);
  const lo = Math.min(...voiced);
  const hi = Math.max(...voiced);
  return means.map((m) => (m === null ? null : hi - lo < 1e-9 ? 0.5 : (m - lo) / (hi - lo)));
}

/** Words like "rises, then falls after ま" — from a fitted shape and its kana. */
export function describeShape(shape: readonly MoraPitchClass[], kana: readonly string[]): string {
  if (shape.length === 0) return '';
  const lastHigh = shape.lastIndexOf('h');
  const startsHigh = shape[0] === 'h';
  const falls = lastHigh >= 0 && lastHigh < shape.length - 1;
  const at = (i: number) => kana[i] ?? '';
  if (startsHigh && falls) return `starts high, then falls after ${at(0)}`;
  if (startsHigh) return 'stays high';
  if (falls) return `starts low, rises, then falls after ${at(lastHigh)}`;
  return 'starts low, rises, and stays high';
}

/**
 * The phrase rows for one sentence. `moraUnits` is the sentence's mora list (from
 * its reading); `reference` is the native recording, `learner` optional.
 */
export function buildPhrasePitch({
  moraUnits,
  reference,
  learner,
}: {
  moraUnits: readonly MoraUnit[];
  reference: SpeakerInput;
  learner?: SpeakerInput;
}): PhrasePitchResult {
  if (moraUnits.length === 0) return { rows: [], unavailable: 'no-reading', learnerUnavailable: true, learnerApproximateTokens: 0 };

  // An `<unk>` the aligner couldn't place (often a sound effect or a word it doesn't know) hides an
  // unknown number of morae, so a token/mora total that happens to equal the reading proves nothing —
  // the kana would be laid on the wrong sounds. Refuse rather than mislabel.
  if (reference.words.some((w) => w.text === '<unk>')) {
    return { rows: [], unavailable: 'no-reference-timing', learnerUnavailable: true, learnerApproximateTokens: 0 };
  }
  const refTokens = reference.words.filter((w) => !INAUDIBLE.has(w.text));
  const refTimings = tokenTimings(refTokens, moraUnits.length);
  if (!refTimings) return { rows: [], unavailable: 'no-reference-timing', learnerUnavailable: true, learnerApproximateTokens: 0 };

  const learnerTokens = learner ? learner.words.filter((w) => !INAUDIBLE.has(w.text)) : [];
  // The learner aligns to the same transcript, so the token lists should match; if they don't, don't compare.
  const learnerLayout =
    learner && learnerTokens.length === refTokens.length ? learnerTokenTimings(learnerTokens, refTimings) : null;
  const learnerTimings = learnerLayout?.timings ?? null;

  const groups = groupIntoPhrases(refTokens);
  // First mora index of each token in the sentence's mora list (same for both speakers' phrase spans by token index).
  const firstMora: number[] = [];
  let running = 0;
  for (const timing of refTimings) {
    firstMora.push(running);
    running += timing.intervals.length;
  }

  const refOffset = reference.pitchOffsetSeconds ?? 0;
  const learnerOffset = learner?.pitchOffsetSeconds ?? 0;
  const rows: PhraseRow[] = [];

  for (const group of groups) {
    const startMora = firstMora[group[0]!]!;
    const endMora = firstMora[group[group.length - 1]!]! + refTimings[group[group.length - 1]!]!.intervals.length;
    const kana = moraUnits.slice(startMora, endMora).map((unit) => unit.text);
    if (kana.length < 2) continue; // one mora carries no shape

    const nativeMeans = group.flatMap((t) => refTimings[t]!.intervals).map((iv) => meanSemitones(reference.pitch, iv.start - refOffset, iv.end - refOffset));
    const nativeFit = fitAccentShape(nativeMeans);
    if (!nativeFit) continue; // not enough voiced native pitch to say anything

    let learnerFit: ReturnType<typeof fitAccentShape> = null;
    let learnerMeans: (number | null)[] | null = null;
    if (learner && learnerTimings) {
      const intervals = group.flatMap((t) => learnerTimings[t]!.intervals);
      if (intervals.length === kana.length) {
        learnerMeans = intervals.map((iv) => meanSemitones(learner.pitch, iv.start - learnerOffset, iv.end - learnerOffset));
        learnerFit = fitAccentShape(learnerMeans);
      }
    }

    let status: PhraseStatus;
    if (nativeFit.contrastSemitones < FLAT_CONTRAST_SEMITONES) status = 'weak-native';
    else if (!learnerFit) status = 'no-learner';
    else if (learnerFit.contrastSemitones < FLAT_CONTRAST_SEMITONES) status = 'flat';
    else status = learnerFit.shape.join('') === nativeFit.shape.join('') ? 'match' : 'different';

    rows.push({
      text: group.map((t) => refTokens[t]!.text).join(''),
      kana,
      native: nativeFit.shape,
      nativeContrast: nativeFit.contrastSemitones,
      nativeLevels: toLevels(nativeMeans),
      learner: learnerFit ? learnerFit.shape : null,
      learnerContrast: learnerFit ? learnerFit.contrastSemitones : null,
      learnerLevels: learnerMeans ? toLevels(learnerMeans) : null,
      status,
      nativeSummary: describeShape(nativeFit.shape, kana),
      learnerSummary: learnerFit ? describeShape(learnerFit.shape, kana) : null,
      learnerVoicedMorae: learnerMeans ? learnerMeans.filter((m) => m !== null).length : null,
    });
  }

  return {
    rows,
    unavailable: rows.length === 0 ? 'no-pitch' : undefined,
    learnerUnavailable: !learnerTimings,
    learnerApproximateTokens: learnerLayout?.approximate ?? 0,
    learnerUnavailableReason: !learner || learnerTimings ? undefined : learnerTokens.length !== refTokens.length ? 'token-count' : 'no-span',
  };
}

/** Plain-language line for a row: what to change (or that it matches). */
export function phraseFeedback(row: PhraseRow): string {
  switch (row.status) {
    case 'match':
      return `Matches the native phrase (${row.nativeSummary}).`;
    case 'flat':
      return `Your pitch is flat here. The native phrase ${row.nativeSummary}.`;
    case 'different':
      return `Native: ${row.nativeSummary}. You: ${row.learnerSummary}.`;
    case 'weak-native':
      return 'The native pitch is not clearly high/low here, so there is nothing firm to match.';
    case 'no-learner':
      return row.learnerVoicedMorae === null
        ? 'Could not line your recording up with this phrase.'
        : `Could not measure your pitch on this phrase — only ${row.learnerVoicedMorae} of ${row.kana.length} sounds had a clear pitch.`;
  }
}
