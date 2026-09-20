import type { WordAlignment } from '../domain/types';
import { alignerView } from './alignerText';
import {
  buildMoraMap,
  phonesToMoraIntervals,
  resolveMoraRange,
  type SentenceReading,
} from './moraTiming';
import type { TimeRangeMs } from './recording';

/**
 * Maps a sentence's target word to a time range in its reference recording,
 * using the forced aligner's word boundaries. The aligner tokenizes on its
 * own terms (dictionary-normalized spellings, re-segmentation) so its word
 * text can't be string-matched against `japanese` directly — position is
 * carried over by character-count proportion, the same approximation
 * `SyncedShadowText` uses for karaoke highlighting: the target's
 * [charIndex, charIndex+len) fraction of `japanese` is intersected with
 * each aligned word's own cumulative fraction of the (usable) transcript.
 * (The comparison is made on the aligner's view of the sentence — see `alignerView`: dates expanded, punctuation dropped.)
 *
 * The immediately-following aligned word is folded in when it's a particle
 * (`FOLDABLE_PARTICLES`, with no pause before it) so the learner hears
 * whether the pitch stays up after the word, which is the only audible
 * heiban/odaka cue. A small pad is added each side. Returns null when the word can't be located (no
 * alignment, surface form absent, degenerate range) — callers fall back to
 * whole-sentence playback.
 * Also null when the matched span is implausibly short (`MIN_MATCH_MS`).
 *
 * Also returns null when an out-of-vocabulary token (`<unk>` — a word the
 * aligner's lexicon didn't have, chiefly casual contractions like
 * 怖がってたり) sits at or before the matched range: its characters are
 * missing from the proportional basis while its airtime is not, so every
 * token after it is time-shifted against its character position and the
 * downstream mapping can't be trusted. Better a whole-sentence fallback
 * than a confidently-wrong span. (`<eps>` is ordinary inter-word silence
 * and doesn't trigger this.)
 */
interface WordMatch {
  startMs: number;
  matchEndMs: number;
  lastIndex: number;
  usable: WordAlignment[];
  /** The span starts/ends inside a token (cut at a mora boundary), not at a token edge. */
  innerStart: boolean;
  innerEnd: boolean;
  /** A squashed token sits next to the target — the aligner's timing here can't be trusted (`SQUASHED_MS_PER_MORA`). */
  unreliable: boolean;
}

/** Length of `text` in aligner characters (see `alignerView`). */
export function alignerCharCount(text: string): number {
  return alignerView(text).chars.length;
}

/**
 * Maps a [start, end) range counted in aligner characters back to indices into
 * the raw `japanese` string — for callers that slice the displayed sentence by
 * an aligner-token position. The end lands just after the last kept
 * character, so trailing punctuation isn't highlighted, and an expanded date
 * (じゅうろくにち) maps back to its whole raw form (16日).
 */
export function alignerRangeToRawIndices(
  japanese: string,
  start: number,
  end: number,
): { start: number; end: number } {
  const view = alignerView(japanese);
  if (view.chars.length === 0) return { start: 0, end: 0 };
  const first = Math.min(Math.max(start, 0), view.chars.length - 1);
  const last = Math.min(Math.max(end - 1, first), view.chars.length - 1);
  return { start: view.rawStart[first]!, end: view.rawEnd[last]! };
}

/**
 * How many leading tokens verifiably spell the sentence (punctuation aside),
 * counted from the start. Those tokens sit at exact character offsets; the
 * first mismatch (an <unk> blob, a numeral expansion, a normalized spelling)
 * means offsets from there on can't be trusted.
 */
export interface MatchOptions {
  /** Return the span even when a squashed token is nearby (the labelling tool needs to see those). */
  includeUnreliable?: boolean;
}

function verifiedPrefixTokenCount(tokens: { text: string }[], japanese: string): number {
  const stripped = alignerView(japanese).chars.join('').toLowerCase();
  let count = 0;
  for (let offset = 0; count < tokens.length; count++) {
    const text = tokens[count]!.text.toLowerCase();
    if (stripped.slice(offset, offset + text.length) !== text) break;
    offset += text.length;
  }
  return count;
}

/**
 * Exact aligner-character range of `tokens[index]` within the sentence, or
 * null when the tokens up to and including it don't verifiably spell the
 * sentence's start — callers then fall back to a proportional approximation.
 * `tokens` must already exclude `<eps>`.
 */
export function verifiedTokenCharRange(
  tokens: { text: string }[],
  japanese: string,
  index: number,
): { start: number; end: number } | null {
  if (index < 0 || index >= tokens.length) return null;
  if (verifiedPrefixTokenCount(tokens, japanese) <= index) return null;
  let start = 0;
  for (let i = 0; i < index; i++) start += tokens[i]!.text.length;
  return { start, end: start + tokens[index]!.text.length };
}

/**
 * Squashed-alignment guard. When the aligner mis-times a stretch of speech (a
 * drawled 「ちょっとねー」, a Latin `VIP` it can't pronounce) it crushes the
 * affected tokens into a few frames — 3 morae in 90 ms — and pushes every word
 * around them ~1–1.7 s off. From 52 hand labels (docs/STATUS.md 2026-09-20): a
 * target with such a token within two tokens of it was badly wrong in 4 of 4
 * cases, with **0 false alarms among the 45 good items**; 45 ms/mora was the
 * best threshold (40 missed one, ≥50 added a false alarm). A flagged target
 * returns null — the callers' whole-sentence fallback — rather than a
 * confidently wrong span. Tokens of one mora never count (です at 30 ms is
 * ordinary devoicing).
 */
export const SQUASHED_MS_PER_MORA = 45;
export const SQUASH_NEIGHBOURHOOD = 2;

/** Mora count of an aligned token: from its phones when they parse, else half its non-silent phones. */
function tokenMoraCount(word: WordAlignment): number {
  const parsed = phonesToMoraIntervals(word.phones);
  if (parsed) return parsed.length;
  return Math.max(1, Math.round(word.phones.filter((p) => !/^(sil|sp|spn)$/.test(p.text)).length / 2));
}

/** True when a squashed token lies within `SQUASH_NEIGHBOURHOOD` tokens of usable[first..last] (or is one of them). */
function hasSquashedNeighbour(usable: WordAlignment[], first: number, last: number): boolean {
  const from = Math.max(0, first - SQUASH_NEIGHBOURHOOD);
  const to = Math.min(usable.length - 1, last + SQUASH_NEIGHBOURHOOD);
  for (let k = from; k <= to; k += 1) {
    const token = usable[k]!;
    const morae = tokenMoraCount(token);
    if (morae >= 2 && ((token.end - token.start) * 1000) / morae < SQUASHED_MS_PER_MORA) return true;
  }
  return false;
}

/**
 * Cuts the matched span at mora boundaries where the target starts/ends inside
 * its first/last token. Each side is refined independently and only when
 * everything lines up: the reading covers the sentence, the target's edge falls
 * on a reading unit, and the token's phones parse into exactly as many morae as
 * its reading has. Any doubt leaves that side at the token edge.
 */
function refineToMorae(input: {
  usable: WordAlignment[];
  view: ReturnType<typeof alignerView>;
  japanese: string;
  reading: SentenceReading;
  first: number;
  last: number;
  rawStart: number;
  rawEnd: number;
}): { startMs?: number; endMs?: number } | null {
  const { usable, view, japanese, reading, first, last, rawStart, rawEnd } = input;
  const map = buildMoraMap(japanese, reading);
  if (!map) return null;
  const target = resolveMoraRange(map, rawStart, rawEnd);
  if (!target) return null;

  const charStart = (token: number) => usable.slice(0, token).reduce((n, w) => n + w.text.length, 0);
  const tokenMorae = (token: number) => {
    const from = charStart(token);
    const to = from + usable[token]!.text.length;
    if (to <= from || to > view.chars.length) return null;
    const range = resolveMoraRange(map, view.rawStart[from]!, view.rawEnd[to - 1]!);
    const intervals = phonesToMoraIntervals(usable[token]!.phones);
    if (!range || !intervals || intervals.length !== range.end - range.start) return null;
    return { range, intervals, rawStart: view.rawStart[from]!, rawEnd: view.rawEnd[to - 1]! };
  };

  const out: { startMs?: number; endMs?: number } = {};
  const firstToken = tokenMorae(first);
  if (firstToken && rawStart > firstToken.rawStart) {
    const interval = firstToken.intervals[target.start - firstToken.range.start];
    if (interval) out.startMs = interval.start * 1000;
  }
  const lastToken = tokenMorae(last);
  if (lastToken && rawEnd < lastToken.rawEnd) {
    const interval = lastToken.intervals[target.end - 1 - lastToken.range.start];
    if (interval) out.endMs = interval.end * 1000;
  }
  if (out.startMs === undefined && out.endMs === undefined) return null;

  const startMs = out.startMs ?? usable[first]!.start * 1000;
  const endMs = out.endMs ?? usable[last]!.end * 1000;
  return endMs - startMs >= MIN_MORA_CUT_MS ? out : null;
}

function matchWord(
  words: WordAlignment[],
  japanese: string,
  surfaceForm: string,
  reading?: SentenceReading,
  options: MatchOptions = {},
): WordMatch | null {
  const rawIndex = japanese.indexOf(surfaceForm);
  if (rawIndex === -1 || surfaceForm.length === 0) return null;
  const view = alignerView(japanese);
  const rawEnd = rawIndex + surfaceForm.length;
  // The aligner characters the surface form covers (an expanded date counts
  // whole, even when the surface form is only its 日/月).
  let charIndex = -1;
  let charEnd = -1;
  view.chars.forEach((_, i) => {
    if (view.rawEnd[i]! > rawIndex && view.rawStart[i]! < rawEnd) {
      if (charIndex === -1) charIndex = i;
      charEnd = i + 1;
    }
  });
  if (charIndex === -1) return null;
  const surfaceLength = charEnd - charIndex;
  const sentenceLength = view.chars.length;

  const usable = words.filter(
    (word) => word.text && word.text !== '<eps>' && word.text !== '<unk>',
  );
  const total = usable.reduce((sum, word) => sum + word.text.length, 0);
  if (total === 0) return null;

  // Tokens that verifiably spell the sentence (punctuation aside), counted
  // from the start, sit at exact character offsets — nothing after the target
  // (an <unk> blob, a numeral expansion) can move them. That's the common case
  // and the only trustworthy one: scaling by the token total instead let two
  // <unk> tokens *after* the target stretch every position and land 自分 on
  // the preceding そして.
  const verifiedTokens = verifiedPrefixTokenCount(usable, japanese);

  const locate = (
    startOf: (accBefore: number) => number,
    endOf: (accAfter: number) => number,
    rangeStart: number,
    rangeEnd: number,
  ) => {
    let acc = 0;
    let first: number | null = null;
    let last = -1;
    usable.forEach((word, index) => {
      const wordStart = startOf(acc);
      acc += word.text.length;
      const wordEnd = endOf(acc);
      if (wordEnd > rangeStart && wordStart < rangeEnd) {
        if (first === null) first = index;
        last = index;
      }
    });
    return first === null ? null : { first, last };
  };

  let found = locate((n) => n, (n) => n, charIndex, charIndex + surfaceLength);
  let exact = found !== null && found.last < verifiedTokens;
  if (!found || found.last >= verifiedTokens) {
    // Unverifiable prefix (numeral expansion, normalized spelling): fall back
    // to the character-proportion approximation.
    found = locate(
      (n) => n / total,
      (n) => n / total,
      charIndex / sentenceLength,
      (charIndex + surfaceLength) / sentenceLength,
    );
  }
  if (!found) return null;
  let startMs: number | null = usable[found.first]!.start * 1000;
  let endMs: number | null = usable[found.last]!.end * 1000;
  const lastIndex = found.last;

  // The target can end (or start) inside a token — 生まれ in 生まれた — in which
  // case the token's own edge would play the extra morae. Cut at the mora
  // boundary instead when the phones and the reading agree on where it is.
  let innerStart = false;
  let innerEnd = false;
  if (reading && exact) {
    const refined = refineToMorae({
      usable,
      view,
      japanese,
      reading,
      first: found.first,
      last: found.last,
      rawStart: rawIndex,
      rawEnd,
    });
    if (refined?.startMs !== undefined) {
      startMs = refined.startMs;
      innerStart = true;
    }
    if (refined?.endMs !== undefined) {
      endMs = refined.endMs;
      innerEnd = true;
    }
  }

  if (startMs === null || endMs === null || endMs <= startMs) return null;
  // The aligner sometimes crushes a word into a few frames (何 → 30 ms in
  // "え、何あやまってるの？") — no real word is that short, so the span is
  // garbage; whole-sentence playback beats an empty-sounding clip.
  if (endMs - startMs < MIN_MATCH_MS) return null;

  // An OOV token at/before the match makes the proportional map downstream
  // unreliable (see doc comment) — bail to whole-sentence playback.
  const matchEndMs = endMs;
  if (words.some((w) => w.text === '<unk>' && w.end > w.start && w.start * 1000 < matchEndMs)) {
    return null;
  }

  const unreliable = hasSquashedNeighbour(usable, found.first, found.last);
  if (unreliable && !options.includeUnreliable) return null;

  return { startMs, matchEndMs, lastIndex, usable, innerStart, innerEnd, unreliable };
}

/**
 * Tokens worth folding in after the target: case/binding/sentence-final
 * particles whose pitch (staying up vs dropping) is the audible heiban/odaka
 * cue. A bare length test (≤2 chars) is not enough — it also matched nouns
 * like 時, 場所 and 山, so the "word" clip for 小さい played 小さい場所.
 */
const FOLDABLE_PARTICLES = new Set([
  'は', 'が', 'を', 'に', 'へ', 'と', 'で', 'の', 'も', 'や', 'か', 'ね', 'よ',
  'から', 'まで', 'より',
]);

/** A particle with no audible pause between it and the word (a pause means a phrase boundary, not the word's particle). */
const MAX_PARTICLE_GAP_MS = 150;

function foldableParticle(match: WordMatch): WordAlignment | null {
  if (match.innerEnd) return null; // what follows is the rest of the same token, not a particle
  const next = match.usable[match.lastIndex + 1];
  if (!next || !FOLDABLE_PARTICLES.has(next.text)) return null;
  if (next.start * 1000 - match.matchEndMs > MAX_PARTICLE_GAP_MS) return null;
  return next;
}

/**
 * Padding around the aligner's boundaries, which tend to clip a word's onset
 * and its decaying final vowel. The nominal amounts are only a ceiling: the
 * pad never runs into a neighbouring word, since that plays the neighbour's
 * first mora ("chiisai-ba" for 小さい|場所). Room to grow is the silence
 * (`<eps>`) between this span and the nearest real token on that side, plus
 * `slackMs` for the aligner's own boundary error — so a word next to
 * a pause gets the full pad and a word butted against another gets almost none.
 */
export interface PadConfig {
  /** Ceiling on the pad before the span. */
  onsetMs: number;
  /** Ceiling on the pad after the span. */
  tailMs: number;
  /** Extra room past the silence to the neighbouring token, for boundary error. */
  slackMs: number;
}

const DEFAULT_PAD: PadConfig = { onsetMs: 30, tailMs: 60, slackMs: 0 };
const MIN_MATCH_MS = 60;
/**
 * A mora cut shorter than this keeps the token edge instead — only a sanity
 * limit. A 200 ms floor was tried (the CTC judge leaned against sub-250 ms
 * mora cuts) and **removed against the hand labels**: with 52 random labels, no
 * floor gave a 90th-percentile end miss of 99 ms vs 364 ms with it, because
 * genuinely short words (見, あり — one or two morae) were being given their whole
 * token (docs/STATUS.md 2026-09-20).
 */
const MIN_MORA_CUT_MS = MIN_MATCH_MS;
/** Timing tolerance when deciding which tokens sit before/after a span. */
const EDGE_EPS_MS = 1;

/** Exported so padding strategies can be compared (scripts/experiment-pad-comparison.ts). */
export function padSpan(
  words: WordAlignment[],
  startMs: number,
  endMs: number,
  config: PadConfig = DEFAULT_PAD,
  /** The edge cuts inside a token (a mora boundary): the rest of that token is the neighbour, butted right up. */
  inner: { start?: boolean; end?: boolean } = {},
): TimeRangeMs {
  let gapBefore = inner.start ? 0 : Infinity;
  let gapAfter = inner.end ? 0 : Infinity;
  for (const w of words) {
    if (!w.text || w.text === '<eps>') continue;
    const wordStart = w.start * 1000;
    const wordEnd = w.end * 1000;
    if (wordEnd <= startMs + EDGE_EPS_MS) gapBefore = Math.min(gapBefore, Math.max(0, startMs - wordEnd));
    if (wordStart >= endMs - EDGE_EPS_MS) gapAfter = Math.min(gapAfter, Math.max(0, wordStart - endMs));
  }
  return {
    startMs: Math.max(0, startMs - Math.min(config.onsetMs, gapBefore + config.slackMs)),
    endMs: endMs + Math.min(config.tailMs, gapAfter + config.slackMs),
  };
}

function pad(
  words: WordAlignment[],
  startMs: number,
  endMs: number,
  match: Pick<WordMatch, 'innerStart' | 'innerEnd'>,
): TimeRangeMs {
  return padSpan(words, startMs, endMs, DEFAULT_PAD, { start: match.innerStart, end: match.innerEnd });
}

/**
 * The matched word's own boundaries — no particle, no pad. For experiments that
 * compare padding strategies against the same underlying match.
 */
export function isolatedWordMatchRange(
  words: WordAlignment[],
  japanese: string,
  surfaceForm: string,
  reading?: SentenceReading,
  options?: MatchOptions,
): TimeRangeMs | null {
  const match = matchWord(words, japanese, surfaceForm, reading, options);
  return match ? { startMs: match.startMs, endMs: match.matchEndMs } : null;
}

/**
 * Whether the aligner's timing around the target looks unreliable (a squashed
 * token within two tokens — see `SQUASHED_MS_PER_MORA`). False when the word
 * can't be located at all.
 */
export function wordTimingUnreliable(
  words: WordAlignment[],
  japanese: string,
  surfaceForm: string,
): boolean {
  return matchWord(words, japanese, surfaceForm, undefined, { includeUnreliable: true })?.unreliable ?? false;
}

/** The particle-inclusive end for a match, or the match's own end. */
function rangeEnd(match: WordMatch): number {
  const particle = foldableParticle(match);
  return particle ? particle.end * 1000 : match.matchEndMs;
}

/**
 * Raw particle-inclusive match boundaries, before padding — exported
 * for boundary-precision experiments (see
 * scripts/experiment-word-boundary-verification.ts) that need to try
 * alternative padding against the same underlying match.
 */
export function isolatedWordRangeUnpadded(
  words: WordAlignment[],
  japanese: string,
  surfaceForm: string,
  reading?: SentenceReading,
): TimeRangeMs | null {
  const match = matchWord(words, japanese, surfaceForm, reading);
  return match ? { startMs: match.startMs, endMs: rangeEnd(match) } : null;
}

/**
 * Pass the sentence's `inlineReading` as `reading` to cut a target that ends
 * inside a token (生まれ within 生まれた) at its last mora rather than at the
 * token edge — see `refineToMorae`. Without it, spans are token-aligned.
 *
 * Pitch-accent consumers deliberately do NOT pass it: for a verb or adjective
 * the ending (た, る, ます) is what shows whether the pitch stays high or falls
 * — the same role a particle plays after a noun — so the whole token keeps the
 * cue the card teaches. Cards that need exactly the target's morae (listening
 * to "just the word", karaoke highlighting) do pass it.
 */
export function isolatedWordRange(
  words: WordAlignment[],
  japanese: string,
  surfaceForm: string,
  reading?: SentenceReading,
): TimeRangeMs | null {
  const match = matchWord(words, japanese, surfaceForm, reading);
  return match ? pad(words, match.startMs, rangeEnd(match), match) : null;
}

/**
 * Like `isolatedWordRange`, but returns the strict word-only span alongside
 * the particle-inclusive one instead of picking one — for callers that need
 * to play both and let the learner compare them (the heiban/odaka warm-up:
 * the word alone sounds identical either way, only the particle's pitch
 * differs). `withParticle` is null when there's no particle right after the word to
 * fold in, i.e. nothing to contrast against `wordOnly`.
 */
export interface IsolatedWordSpans {
  wordOnly: TimeRangeMs;
  withParticle: TimeRangeMs | null;
}

export function isolatedWordSpans(
  words: WordAlignment[],
  japanese: string,
  surfaceForm: string,
  reading?: SentenceReading,
): IsolatedWordSpans | null {
  const match = matchWord(words, japanese, surfaceForm, reading);
  if (!match) return null;
  const particle = foldableParticle(match);
  return {
    wordOnly: pad(words, match.startMs, match.matchEndMs, match),
    withParticle: particle ? pad(words, match.startMs, particle.end * 1000, match) : null,
  };
}
