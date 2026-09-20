import type { WordAlignment } from '../domain/types';
import { alignerView } from './alignerText';
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

function matchWord(
  words: WordAlignment[],
  japanese: string,
  surfaceForm: string,
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
  const startMs: number | null = usable[found.first]!.start * 1000;
  const endMs: number | null = usable[found.last]!.end * 1000;
  const lastIndex = found.last;

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

  return { startMs, matchEndMs, lastIndex, usable };
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
 * `BOUNDARY_SLACK_MS` for the aligner's own boundary error — so a word next to
 * a pause gets the full pad and a word butted against another gets almost none.
 */
const ONSET_PAD_MS = 60;
const TAIL_PAD_MS = 120;
const BOUNDARY_SLACK_MS = 30;
const MIN_MATCH_MS = 60;
/** Timing tolerance when deciding which tokens sit before/after a span. */
const EDGE_EPS_MS = 1;

function pad(words: WordAlignment[], startMs: number, endMs: number): TimeRangeMs {
  let gapBefore = Infinity;
  let gapAfter = Infinity;
  for (const w of words) {
    if (!w.text || w.text === '<eps>') continue;
    const wordStart = w.start * 1000;
    const wordEnd = w.end * 1000;
    if (wordEnd <= startMs + EDGE_EPS_MS) gapBefore = Math.min(gapBefore, Math.max(0, startMs - wordEnd));
    if (wordStart >= endMs - EDGE_EPS_MS) gapAfter = Math.min(gapAfter, Math.max(0, wordStart - endMs));
  }
  return {
    startMs: Math.max(0, startMs - Math.min(ONSET_PAD_MS, gapBefore + BOUNDARY_SLACK_MS)),
    endMs: endMs + Math.min(TAIL_PAD_MS, gapAfter + BOUNDARY_SLACK_MS),
  };
}

/**
 * The matched word's own boundaries — no particle, no pad. For experiments that
 * compare padding strategies against the same underlying match.
 */
export function isolatedWordMatchRange(
  words: WordAlignment[],
  japanese: string,
  surfaceForm: string,
): TimeRangeMs | null {
  const match = matchWord(words, japanese, surfaceForm);
  return match ? { startMs: match.startMs, endMs: match.matchEndMs } : null;
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
): TimeRangeMs | null {
  const match = matchWord(words, japanese, surfaceForm);
  if (!match) return null;
  const particle = foldableParticle(match);
  return { startMs: match.startMs, endMs: particle ? particle.end * 1000 : match.matchEndMs };
}

export function isolatedWordRange(
  words: WordAlignment[],
  japanese: string,
  surfaceForm: string,
): TimeRangeMs | null {
  const raw = isolatedWordRangeUnpadded(words, japanese, surfaceForm);
  if (!raw) return null;
  return pad(words, raw.startMs, raw.endMs);
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
): IsolatedWordSpans | null {
  const match = matchWord(words, japanese, surfaceForm);
  if (!match) return null;
  const { startMs, matchEndMs } = match;
  const particle = foldableParticle(match);
  return {
    wordOnly: pad(words, startMs, matchEndMs),
    withParticle: particle ? pad(words, startMs, particle.end * 1000) : null,
  };
}
