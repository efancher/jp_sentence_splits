import type { WordAlignment } from '../domain/types';

import { phonesToMoraIntervals, phonesToSoundedMorae } from './moraTiming';
import type { PitchAnalysisPayload } from './pitch';
import { SET_EXPRESSIONS } from './setExpressions';

/**
 * Phrase-level pitch: the measured contour of each *phrase* (a content word plus
 * the particles and endings that ride on it) for the native and the learner, mora
 * by mora. Japanese accent is realised over the phrase, not the bare word, so this
 * is the unit a learner actually hears and has to produce.
 *
 * Deliberately no H/L labels and no accent-type (heiban, atamadaka, …) fitting: the
 * native *recording* is the answer key and its measured pitch is shown as it is.
 * `levels` is each mora's mean height within the phrase (0..1), drawn as a line, so a
 * contour that is not a textbook pattern — or a native that does not follow the
 * dictionary — reads honestly instead of being snapped to a shape (a fit once forced
 * について onto HLLL while she said LLLH).
 *
 * Morae and their kana come from the native token's own phones
 * (`phonesToSoundedMorae`), not from the written reading, so what is shown is what
 * was actually said (今日は → こんにちは) and an unplaced `<unk>` token or a
 * reading/speech mismatch cannot shift the kana onto the wrong sounds. A phrase
 * with a token whose phones don't parse is skipped, never guessed. The learner is
 * laid on the native's per-token mora counts (exact phones when they agree, an even
 * split of the token's span otherwise).
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

const SET_EXPRESSION_MAX_TOKENS = 6;

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
  // Set expressions (について, にとって, …) the aligner splits into pieces ride on the preceding word whole.
  const inExpression = new Set<number>();
  for (let i = 0; i < tokens.length; i += 1) {
    let text = '';
    let last = -1;
    for (let j = i; j < Math.min(tokens.length, i + SET_EXPRESSION_MAX_TOKENS); j += 1) {
      if (j > i && tokens[j]!.start - tokens[j - 1]!.end >= pauseSeconds) break;
      text += tokens[j]!.text;
      if (SET_EXPRESSIONS.has(text)) last = j;
    }
    if (last > i) {
      for (let j = i; j <= last; j += 1) inExpression.add(j);
      i = last;
    }
  }
  tokens.forEach((token, index) => {
    const previous = tokens[index - 1];
    const attaches =
      previous !== undefined &&
      (FUNCTION_TOKENS.has(token.text) || inExpression.has(index)) &&
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

export interface PhraseRow {
  text: string;
  kana: string[];
  /** Each mora's mean pitch as a 0..1 height within this phrase for that speaker (null = unvoiced). */
  nativeLevels: (number | null)[];
  learnerLevels: (number | null)[] | null;
  /** The measured contour across the phrase: `CONTOUR_POINTS_PER_MORA` samples per mora, speaker-normalized semitones (null = unvoiced). */
  nativeContour: (number | null)[];
  learnerContour: (number | null)[] | null;
  /** How many of this phrase's morae had voiced pitch in your recording (null = not lined up). */
  learnerVoicedMorae: number | null;
  /** Position in the sentence's full phrase list (rows skip phrases that could not be measured, so this can jump). */
  phraseIndex: number;
}

export type UnmeasuredReason = 'phones' | 'short' | 'unvoiced';

/** A phrase of the sentence that produced no row, and why — so the whole-sentence line can show a gap instead of silently dropping it. */
export interface UnmeasuredPhrase {
  phraseIndex: number;
  text: string;
  reason: UnmeasuredReason;
}

export interface PhrasePitchResult {
  rows: PhraseRow[];
  /** Phrases left out of `rows`, in sentence order. */
  unmeasured: UnmeasuredPhrase[];
  /** Set when nothing could be shown, and why (for a one-line explanation). */
  unavailable?: 'no-reference-timing' | 'no-pitch';
  /** True when the learner side could not be lined up mora by mora at all. */
  learnerUnavailable: boolean;
  /** How many of your tokens were timed by an even split rather than from their sounds (0 = all exact). */
  learnerApproximateTokens: number;
  /** Why the learner side is unavailable (for the message): a different word count than the native, or a word with no timing. */
  learnerUnavailableReason?: 'token-count' | 'no-span';
}

interface TokenTiming {
  intervals: { start: number; end: number }[];
  /** The kana each interval sounds like, read off the phones. */
  kana: string[];
}

/** Per-token mora timing and kana for the native side; null for a token whose phones don't parse (its phrase is skipped). */
function referenceTimings(tokens: readonly WordAlignment[]): (TokenTiming | null)[] {
  return tokens.map((token) => {
    const morae = phonesToSoundedMorae(token.phones);
    if (!morae || morae.length === 0) return null;
    return { intervals: morae.map(({ start, end }) => ({ start, end })), kana: morae.map((m) => m.kana) };
  });
}

/**
 * The learner's per-token mora intervals, laid out on the *reference's* per-token mora counts.
 * A learner's phones are messier than a native's (dropped or extra vowels, `spn`, a different word
 * pronounced), so a token whose phones don't give exactly the expected morae is split evenly across
 * its aligned span instead — the token boundaries from the aligner are still trustworthy. Null only
 * when a token has no usable span at all. `approximate` counts the tokens that needed the even split.
 */
function learnerTokenTimings(
  tokens: readonly WordAlignment[],
  expected: readonly (TokenTiming | null)[],
): { timings: ({ intervals: { start: number; end: number }[] } | null)[]; approximate: number } | null {
  const timings: ({ intervals: { start: number; end: number }[] } | null)[] = [];
  let approximate = 0;
  for (let t = 0; t < tokens.length; t += 1) {
    const reference = expected[t];
    if (!reference) {
      timings.push(null);
      continue;
    }
    const want = reference.intervals.length;
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

/** Samples per mora in a phrase's stored contour — enough to read a smooth line, small enough to keep per attempt. */
export const CONTOUR_POINTS_PER_MORA = 4;

/**
 * The measured pitch (speaker-normalized semitones) across a phrase's span, as `count` equal time bins:
 * each is the mean of the voiced frames inside it, null if none. A single empty bin between two voiced
 * ones is bridged so a momentary dropout doesn't tear the line.
 */
export function sampleContour(pitch: PitchAnalysisPayload, from: number, to: number, count: number): (number | null)[] {
  if (!(to > from) || count <= 0) return Array.from({ length: Math.max(0, count) }, () => null);
  const sums = new Array<number>(count).fill(0);
  const counts = new Array<number>(count).fill(0);
  const width = (to - from) / count;
  for (const frame of pitch.frames) {
    if (!frame.voiced || frame.relativeSemitones === null) continue;
    if (frame.timeSeconds < from || frame.timeSeconds >= to) continue;
    const bin = Math.min(count - 1, Math.floor((frame.timeSeconds - from) / width));
    sums[bin]! += frame.relativeSemitones;
    counts[bin]! += 1;
  }
  const out = sums.map((sum, i) => (counts[i]! > 0 ? sum / counts[i]! : null));
  for (let i = 1; i < count - 1; i += 1) {
    if (out[i] === null && out[i - 1] !== null && out[i + 1] !== null) out[i] = (out[i - 1]! + out[i + 1]!) / 2;
  }
  return out;
}

/** Heights 0..1 within the phrase (0 = its lowest voiced mora). All-equal → 0.5. */
function toLevels(means: readonly (number | null)[]): (number | null)[] {
  const voiced = means.filter((m): m is number => m !== null);
  if (voiced.length === 0) return means.map(() => null);
  const lo = Math.min(...voiced);
  const hi = Math.max(...voiced);
  return means.map((m) => (m === null ? null : hi - lo < 1e-9 ? 0.5 : (m - lo) / (hi - lo)));
}

/**
 * The phrase rows for one sentence. `moraUnits` is the sentence's mora list (from
 * its reading); `reference` is the native recording, `learner` optional.
 */
export function buildPhrasePitch({
  reference,
  learner,
}: {
  reference: SpeakerInput;
  learner?: SpeakerInput;
}): PhrasePitchResult {
  const unavailable = (reason: NonNullable<PhrasePitchResult['unavailable']>): PhrasePitchResult => ({
    rows: [],
    unmeasured: [],
    unavailable: reason,
    learnerUnavailable: true,
    learnerApproximateTokens: 0,
  });

  const refTokens = reference.words.filter((w) => !INAUDIBLE.has(w.text));
  const refTimings = referenceTimings(refTokens);
  if (refTimings.every((timing) => timing === null)) return unavailable('no-reference-timing');

  const learnerTokens = learner ? learner.words.filter((w) => !INAUDIBLE.has(w.text)) : [];
  // The learner aligns to the same transcript, so the token lists should match; if they don't, don't compare.
  const learnerLayout =
    learner && learnerTokens.length === refTokens.length ? learnerTokenTimings(learnerTokens, refTimings) : null;
  const learnerTimings = learnerLayout?.timings ?? null;

  const groups = groupIntoPhrases(refTokens);
  const refOffset = reference.pitchOffsetSeconds ?? 0;
  const learnerOffset = learner?.pitchOffsetSeconds ?? 0;
  const rows: PhraseRow[] = [];
  const unmeasured: UnmeasuredPhrase[] = [];

  for (const [phraseIndex, group] of groups.entries()) {
    const skip = (reason: UnmeasuredReason) =>
      unmeasured.push({ phraseIndex, text: group.map((t) => refTokens[t]!.text).join(''), reason });
    // A token whose phones don't parse hides its morae, so the whole phrase is skipped rather than guessed.
    const timings = group.map((t) => refTimings[t]);
    if (timings.some((timing) => timing === null)) {
      skip('phones');
      continue;
    }
    const kana = timings.flatMap((timing) => timing!.kana);
    if (kana.length < 2) {
      skip('short'); // one mora carries no shape
      continue;
    }

    const nativeMeans = timings.flatMap((timing) => timing!.intervals).map((iv) => meanSemitones(reference.pitch, iv.start - refOffset, iv.end - refOffset));
    if (nativeMeans.filter((m) => m !== null).length < 2) {
      skip('unvoiced'); // not enough voiced native pitch to draw a contour
      continue;
    }

    const nativeIntervals = timings.flatMap((timing) => timing!.intervals);
    const nativeContour = sampleContour(
      reference.pitch,
      nativeIntervals[0]!.start - refOffset,
      nativeIntervals[nativeIntervals.length - 1]!.end - refOffset,
      kana.length * CONTOUR_POINTS_PER_MORA,
    );
    let learnerMeans: (number | null)[] | null = null;
    let learnerContour: (number | null)[] | null = null;
    if (learner && learnerTimings) {
      const intervals = group.flatMap((t) => learnerTimings[t]?.intervals ?? []);
      if (intervals.length === kana.length) {
        learnerMeans = intervals.map((iv) => meanSemitones(learner.pitch, iv.start - learnerOffset, iv.end - learnerOffset));
        learnerContour = sampleContour(
          learner.pitch,
          intervals[0]!.start - learnerOffset,
          intervals[intervals.length - 1]!.end - learnerOffset,
          kana.length * CONTOUR_POINTS_PER_MORA,
        );
      }
    }

    rows.push({
      text: group.map((t) => refTokens[t]!.text).join(''),
      kana,
      nativeLevels: toLevels(nativeMeans),
      learnerLevels: learnerMeans ? toLevels(learnerMeans) : null,
      nativeContour,
      learnerContour,
      learnerVoicedMorae: learnerMeans ? learnerMeans.filter((m) => m !== null).length : null,
      phraseIndex,
    });
  }

  return {
    rows,
    unmeasured,
    unavailable: rows.length === 0 ? 'no-pitch' : undefined,
    learnerUnavailable: !learnerTimings,
    learnerApproximateTokens: learnerLayout?.approximate ?? 0,
    learnerUnavailableReason: !learner || learnerTimings ? undefined : learnerTokens.length !== refTokens.length ? 'token-count' : 'no-span',
  };
}
