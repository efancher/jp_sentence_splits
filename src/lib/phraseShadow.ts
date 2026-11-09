import { alignerRangeToRawIndices, verifiedTokenCharRange } from './isolatedWordRange';
import type { ContextWalkthrough, SentenceLearningEvent, WordAlignment } from '../domain/types';

/**
 * Phrase shadowing: the learner marks a span of a sentence's reference clip (the Shadow
 * pane's Mark start / Mark end), shadows just that, and rates the pass themselves. The pass
 * is logged as a `phrase_shadow` learning event: evidence only, never a Review and never an
 * FSRS grade, and it does not count as shadowing the whole sentence. Pure helpers; callers
 * fetch the alignment and the sentence's vocabulary links.
 */

/** A span narrower than this is a mis-click, not a phrase. */
export const MIN_PHRASE_MS = 300;
/** A span covering at least this share of the clip is the whole sentence, not a phrase. */
export const WHOLE_CLIP_SHARE = 0.9;

export type PhraseShadowOutcome = 'got_it' | 'close' | 'needed_help';

export const PHRASE_SHADOW_OUTCOMES: readonly { outcome: PhraseShadowOutcome; label: string }[] = [
  { outcome: 'needed_help', label: 'Not yet' },
  { outcome: 'close', label: 'Close' },
  { outcome: 'got_it', label: 'Got it' },
];

/** `target.key` prefix of a phrase_shadow event; the rest is the credited vocabulary item ids, comma-joined. */
export const PHRASE_SHADOW_KEY_PREFIX = 'phrase-shadow:';

export function phraseShadowTargetKey(wordIds: readonly string[]): string {
  return `${PHRASE_SHADOW_KEY_PREFIX}${wordIds.join(',')}`;
}

export function phraseShadowWordIds(key: string | undefined): string[] {
  if (!key?.startsWith(PHRASE_SHADOW_KEY_PREFIX)) return [];
  return key.slice(PHRASE_SHADOW_KEY_PREFIX.length).split(',').filter(Boolean);
}

/** Whether a marked span is a usable phrase of a clip (long enough, and not essentially the whole sentence). */
export function isPhraseRange(range: { startMs: number; endMs: number } | null | undefined, clipDurationMs: number): boolean {
  if (!range) return false;
  const length = range.endMs - range.startMs;
  if (length < MIN_PHRASE_MS) return false;
  return clipDurationMs <= 0 || length < clipDurationMs * WHOLE_CLIP_SHARE;
}

/** A word the aligner could not place (numerals, rare words): spoken, but its text is unknown. */
const UNKNOWN_TOKEN = '<unk>';

/**
 * What an `<unk>` token stood for, read off the sentence: the aligned words either side are found in
 * order in `japanese`, and the text between them is the unknown word (a numeral such as 30回目, or a
 * rare word). Keyed by word index; only unknown words whose neighbours both locate are filled, so a
 * mismatch leaves the gap unfilled rather than guessing. A run of unknowns gives its text to the first.
 */
function unknownWordTexts(words: readonly Pick<WordAlignment, 'text'>[], japanese: string): Map<number, string> {
  const out = new Map<number, string>();
  const known = (text: string) => !!text && !text.startsWith('<');
  let cursor = 0;
  for (let i = 0; i < words.length; i += 1) {
    const { text } = words[i];
    if (known(text)) {
      const at = japanese.indexOf(text, cursor);
      if (at >= 0) cursor = at + text.length;
    } else if (text === UNKNOWN_TOKEN && !out.has(i)) {
      let next = i + 1;
      while (next < words.length && !known(words[next].text)) next += 1;
      const at = next < words.length ? japanese.indexOf(words[next].text, cursor) : japanese.length;
      if (at < cursor) continue;
      for (let j = i; j < next; j += 1) if (words[j].text === UNKNOWN_TOKEN) out.set(j, j === i ? japanese.slice(cursor, at) : '');
      cursor = at;
    }
  }
  return out;
}

/**
 * The text of the aligned words that fall mostly (over half their length) inside the marked
 * span, joined in order. Alignment times are seconds from the start of the clip. With the
 * sentence text, a word the aligner could not place is filled in from it; otherwise it shows as "…".
 */
export function phraseTextFromAlignment(
  words: readonly Pick<WordAlignment, 'start' | 'end' | 'text'>[],
  range: { startMs: number; endMs: number },
  japanese?: string,
): string {
  const start = range.startMs / 1000;
  const end = range.endMs / 1000;
  const unknowns = japanese ? unknownWordTexts(words, japanese) : new Map<number, string>();
  const text = words
    .map((word, index) => ({ word, index }))
    .filter(({ word }) => {
      const length = word.end - word.start;
      if (length <= 0 || !word.text || (word.text.startsWith('<') && word.text !== UNKNOWN_TOKEN)) return false;
      const overlap = Math.min(word.end, end) - Math.max(word.start, start);
      if (overlap > length / 2) return true;
      // A particle token stretched over trailing silence counts once its audible part (capped) is inside.
      return isParticleToken(word) && length * 1000 > PARTICLE_MAX_MS && overlap * 1000 >= PARTICLE_MAX_MS - 1;
    })
    .map(({ word, index }) => (word.text === UNKNOWN_TOKEN ? (unknowns.get(index) ?? '…') : word.text))
    .join('');
  // Filled text can open or close on the sentence's own punctuation, which is not part of the phrase.
  return text.replace(/^[\s、。，．,.!?！？]+|[\s、。，．,.!?！？]+$/g, '');
}

/**
 * Plain-English help for a marked phrase, as "word = meaning" pieces. It is not a translation of the
 * fragment: a phrase is usually mid-clause, so each word inside it is glossed on its own. Prefers the
 * sentence's contextual walkthrough (per-word glosses, particles included), then the linked
 * vocabulary's dictionary meaning. Null when the phrase can't be located in the sentence or nothing
 * in it has a gloss.
 */
export function phraseGloss(
  japanese: string,
  phrase: string,
  walkthrough: ContextWalkthrough | undefined,
  links: readonly { surfaceForm?: string; meaning?: string }[],
): string | null {
  const at = phrase ? japanese.indexOf(phrase) : -1;
  if (at < 0) return null;
  const end = at + phrase.length;
  const inside = (span: { start: number; end: number }) => span.start >= at && span.end <= end;
  const pieces: { start: number; text: string; gloss: string }[] = [];
  const fromWalkthrough = walkthrough?.words?.length ? walkthrough.words : walkthrough?.steps;
  for (const item of fromWalkthrough ?? []) {
    if (inside(item) && item.gloss?.trim()) pieces.push({ start: item.start, text: item.text, gloss: item.gloss.trim() });
  }
  if (pieces.length === 0) {
    for (const link of links) {
      const index = link.surfaceForm ? japanese.indexOf(link.surfaceForm) : -1;
      const meaning = link.meaning?.split(/[;；]/)[0]?.trim();
      if (link.surfaceForm && meaning && index >= at && index + link.surfaceForm.length <= end) {
        pieces.push({ start: index, text: link.surfaceForm, gloss: meaning });
      }
    }
  }
  if (pieces.length === 0) return null;
  return pieces
    .sort((a, b) => a.start - b.start)
    .map((piece) => `${piece.text} = ${piece.gloss}`)
    .join(' · ');
}

/** Vocabulary item ids whose occurrence in the sentence (its surface form) sits inside the phrase text. */
export function wordIdsInPhrase(
  phrase: string,
  links: readonly { vocabularyItemId: string; surfaceForm?: string }[],
): string[] {
  if (!phrase) return [];
  const ids = new Set<string>();
  for (const link of links) {
    if (link.surfaceForm && phrase.includes(link.surfaceForm)) ids.add(link.vocabularyItemId);
  }
  return [...ids];
}

/**
 * Per sentence, the phrase passes in the order logged: input for later planner use
 * ("a recent Not yet means a phrase pass before the whole sentence"). Not used by the
 * planner yet; the data is collected first.
 */
export function phraseShadowsBySentence(
  events: readonly Pick<SentenceLearningEvent, 'action' | 'sentenceId' | 'timestamp' | 'outcome' | 'rangeStartMs' | 'rangeEndMs'>[],
): Map<string, { timestamp: string; outcome: PhraseShadowOutcome; startMs: number; endMs: number }[]> {
  const out = new Map<string, { timestamp: string; outcome: PhraseShadowOutcome; startMs: number; endMs: number }[]>();
  for (const event of [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    if (event.action !== 'phrase_shadow' || !event.outcome) continue;
    if (event.rangeStartMs == null || event.rangeEndMs == null) continue;
    const list = out.get(event.sentenceId) ?? [];
    list.push({ timestamp: event.timestamp, outcome: event.outcome, startMs: event.rangeStartMs, endMs: event.rangeEndMs });
    out.set(event.sentenceId, list);
  }
  return out;
}

/**
 * Tokens that attach to the word before them and carry part of its pitch pattern (a particle's pitch
 * is what shows heiban vs odaka), so a suggested phrase must not end just before one or start on one.
 * Set phrases such as について/によって are not handled here: ending a phrase before them is fine.
 */
const ATTACHED_PARTICLES = new Set([
  'は', 'が', 'を', 'に', 'へ', 'と', 'で', 'の', 'も', 'や', 'か', 'ね', 'よ', 'ぞ', 'さ', 'わ',
  'から', 'まで', 'より', 'だけ', 'しか', 'でも', 'って', 'など', 'ばかり', 'ほど', 'くらい', 'ぐらい',
  'さえ', 'こそ', 'には', 'では', 'とは', 'へは', 'からは', 'までは', 'とも', 'にも',
]);

const PARTICLE_MAX_MS = 500;
/** A particle this close after its word still belongs to it (the aligner often leaves a small gap). */
const PARTICLE_ATTACH_GAP_MS = 400;

const isParticleToken =(word: Pick<WordAlignment, 'text'>) => ATTACHED_PARTICLES.has(word.text);

/** A suggested phrase is widened from one word's span to about this long, and never past the cap. */
export const SUGGESTED_PHRASE_MIN_MS = 1000;
export const SUGGESTED_PHRASE_MAX_MS = 3000;

/**
 * Widens a single word's span (ms) to a short phrase by taking in neighbouring aligned words,
 * following word first (the particle and what comes next), then the preceding one, until it is at
 * least `minMs` long. Never exceeds `maxMs` or the clip. Silence/empty tokens are skipped.
 */
export function expandToPhrase(
  words: readonly Pick<WordAlignment, 'start' | 'end' | 'text'>[],
  span: { startMs: number; endMs: number },
  clipDurationMs: number,
  minMs = SUGGESTED_PHRASE_MIN_MS,
  maxMs = SUGGESTED_PHRASE_MAX_MS,
): { startMs: number; endMs: number } {
  const spoken = words.filter((word) => word.text && !word.text.startsWith('<') && word.end > word.start);
  const clampEnd = (ms: number) => (clipDurationMs > 0 ? Math.min(clipDurationMs, ms) : ms);
  let startMs = Math.max(0, span.startMs);
  let endMs = clampEnd(span.endMs);
  for (let guard = 0; guard < 8 && endMs - startMs < minMs; guard += 1) {
    const next = spoken.find((word) => word.start * 1000 >= endMs - 1);
    const prev = [...spoken].reverse().find((word) => word.end * 1000 <= startMs + 1);
    if (next && next.end * 1000 - startMs <= maxMs) endMs = clampEnd(next.end * 1000);
    else if (prev && endMs - prev.start * 1000 <= maxMs) startMs = prev.start * 1000;
    else break;
  }
  // Never end just before a particle that belongs to the last word, nor start on one.
  const after = spoken.find((word) => word.start * 1000 >= endMs - 1);
  const last = [...spoken].reverse().find((word) => word.end * 1000 <= endMs + 1);
  if (after && last && isParticleToken(after) && after.start * 1000 - last.end * 1000 < PARTICLE_ATTACH_GAP_MS) {
    // A particle is a mora or two: a longer token is trailing silence the aligner stretched over it.
    endMs = clampEnd(Math.min(after.end * 1000, after.start * 1000 + PARTICLE_MAX_MS));
  }
  const first = spoken.find((word) => word.end * 1000 > startMs + 1);
  const before = [...spoken].reverse().find((word) => word.end * 1000 <= startMs + 1);
  if (first && before && isParticleToken(first) && first.start * 1000 - before.end * 1000 < PARTICLE_ATTACH_GAP_MS) {
    startMs = before.start * 1000;
  }
  return { startMs: Math.round(startMs), endMs: Math.round(endMs) };
}

/** A pause at least this long between aligned words is a clause/chunk boundary. */
export const CHUNK_PAUSE_MS = 150;

/**
 * Splits the spoken part of a clip into clause-sized chunks (each `minMs`..`maxMs` long where the
 * speech allows): a chunk closes at a pause once long enough, or before a word that would push it
 * past `maxMs`. A short trailing remainder joins the previous chunk.
 */
export function chunkRanges(
  words: readonly Pick<WordAlignment, 'start' | 'end' | 'text'>[],
  minMs = SUGGESTED_PHRASE_MIN_MS,
  maxMs = SUGGESTED_PHRASE_MAX_MS,
): { startMs: number; endMs: number }[] {
  const spoken = words.filter((word) => word.text && !word.text.startsWith('<') && word.end > word.start);
  const chunks: { startMs: number; endMs: number }[] = [];
  let current: { startMs: number; endMs: number } | null = null;
  for (let i = 0; i < spoken.length; i += 1) {
    const startMs = spoken[i].start * 1000;
    const endMs = spoken[i].end * 1000;
    // A particle stays with the word it follows even when that pushes the chunk past maxMs.
    const attached = i > 0 && isParticleToken(spoken[i]) && startMs - spoken[i - 1].end * 1000 < PARTICLE_ATTACH_GAP_MS;
    if (!attached && current && endMs - current.startMs > maxMs && current.endMs - current.startMs >= minMs) {
      chunks.push(current);
      current = null;
    }
    current = current ? { startMs: current.startMs, endMs } : { startMs, endMs };
    const next = spoken[i + 1];
    if (next && !(isParticleToken(next) && next.start * 1000 - endMs < PARTICLE_ATTACH_GAP_MS) && next.start * 1000 - endMs >= CHUNK_PAUSE_MS && endMs - current.startMs >= minMs) {
      chunks.push(current);
      current = null;
    }
  }
  if (current) {
    const last = chunks[chunks.length - 1];
    if (last && current.endMs - current.startMs < minMs) last.endMs = current.endMs;
    else chunks.push(current);
  }
  return chunks.map((chunk) => ({ startMs: Math.round(chunk.startMs), endMs: Math.round(chunk.endMs) }));
}

const NON_SPOKEN = /[\s、。，．,.!?！？「」『』（）()…・]/g;

/**
 * Fallback when a word's own aligned span can't be located: the clause-sized chunk where the weakest
 * word sits, found from its position in the sentence text (spoken characters before it, as a share of
 * the spoken span) instead of an aligner match. `surfaceForms` are weakest first; with none usable a
 * chunk chosen by a hash of the sentence is returned. Null when the clip is already phrase-sized (nothing to narrow).
 */
export function weakestChunkRange(
  words: readonly Pick<WordAlignment, 'start' | 'end' | 'text'>[],
  japanese: string,
  surfaceForms: readonly string[],
  clipDurationMs: number,
): { startMs: number; endMs: number } | null {
  const chunks = chunkRanges(words).filter((chunk) => isPhraseRange(chunk, clipDurationMs));
  if (chunks.length === 0) return null;
  const spokenText = japanese.replace(NON_SPOKEN, '');
  const spoken = words.filter((word) => word.text && !word.text.startsWith('<') && word.end > word.start);
  if (spokenText && spoken.length > 0) {
    const spanStart = spoken[0].start * 1000;
    const spanLength = spoken[spoken.length - 1].end * 1000 - spanStart;
    for (const surface of surfaceForms) {
      const index = japanese.indexOf(surface);
      const spokenSurface = surface.replace(NON_SPOKEN, '');
      if (index < 0 || !spokenSurface) continue;
      const before = japanese.slice(0, index).replace(NON_SPOKEN, '').length;
      const centre = spanStart + ((before + spokenSurface.length / 2) / spokenText.length) * spanLength;
      const hit = chunks.find((chunk) => centre >= chunk.startMs && centre <= chunk.endMs);
      if (hit) return hit;
    }
  }
  // Varies by sentence (always taking the opener, usually a bare subject like 私は, made every unplaced
  // suggestion the same trivial phrase) but stays stable for one sentence, so a redraw doesn't flip it.
  let hash = 0;
  for (const char of japanese) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return chunks[hash % chunks.length];
}

/**
 * Candidate target words for a sentence with no linked vocabulary: its content-word suggestions
 * (`selectedByDefault`, deduplicated), those not already inside an earlier phrase pass's text first,
 * then rotated by a hash of the sentence so different sentences start on different words but one
 * sentence is stable. `only` restricts to a word the learner tapped.
 */
export function orderSuggestedSurfaces(
  suggestions: readonly { surface: string; selectedByDefault: boolean }[],
  japanese: string,
  pastPhraseTexts: readonly string[],
  only?: string,
): string[] {
  if (only) return [only];
  const surfaces = [...new Set(suggestions.filter((item) => item.selectedByDefault && item.surface).map((item) => item.surface))];
  if (surfaces.length === 0) return [];
  let hash = 0;
  for (const char of japanese) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  const start = hash % surfaces.length;
  const rotated = [...surfaces.slice(start), ...surfaces.slice(0, start)];
  const drilled = (surface: string) => pastPhraseTexts.some((text) => text.includes(surface));
  return [...rotated.filter((surface) => !drilled(surface)), ...rotated.filter(drilled)];
}

/** Links ordered weakest word first (no evidence yet counts as the average), keeping sentence order on ties. */
export function orderLinksByWeakness<T extends { vocabularyItemId: string }>(
  links: readonly T[],
  strengthByWord: ReadonlyMap<string, number>,
): T[] {
  const strengths = [...strengthByWord.values()];
  const middle = strengths.length ? strengths.reduce((a, b) => a + b, 0) / strengths.length : 0;
  return links
    .map((link, index) => ({ link, index, strength: strengthByWord.get(link.vocabularyItemId) ?? middle }))
    .sort((a, b) => a.strength - b.strength || a.index - b.index)
    .map((entry) => entry.link);
}

function lastIndexWhere<T>(items: readonly T[], test: (item: T, index: number) => boolean): number {
  for (let i = items.length - 1; i >= 0; i -= 1) if (test(items[i], i)) return i;
  return -1;
}

/**
 * Moves a phrase's edges out to whole words. The aligner splits compounds into several tokens
 * (食べログ → 食べ + ログ), so a range cut at a token boundary can end or start mid-word. `wordSpans`
 * are the sentence's morphological words as raw [start, end) character ranges; an edge that falls
 * strictly inside one is widened to that word's far edge. Unchanged when the tokens don't verifiably
 * spell the sentence (no trustworthy character offsets) or no word spans are known.
 */
export function snapRangeToWordBoundaries(
  words: readonly Pick<WordAlignment, 'start' | 'end' | 'text'>[],
  japanese: string,
  wordSpans: readonly { start: number; end: number }[],
  range: { startMs: number; endMs: number },
): { startMs: number; endMs: number } {
  const spoken = words.filter((word) => word.text && !word.text.startsWith('<') && word.end > word.start);
  if (spoken.length === 0 || wordSpans.length === 0) return range;
  const rawOf = (index: number) => {
    const chars = verifiedTokenCharRange(spoken, japanese, index);
    return chars ? alignerRangeToRawIndices(japanese, chars.start, chars.end) : null;
  };
  let startMs = range.startMs;
  let endMs = range.endMs;
  const lastIndex = lastIndexWhere(spoken, (word) => word.start * 1000 < endMs - 1);
  const lastRaw = lastIndex >= 0 ? rawOf(lastIndex) : null;
  if (lastRaw) {
    const word = wordSpans.find((span) => span.start < lastRaw.end && lastRaw.end < span.end);
    if (word) {
      const closing = spoken.findIndex((_, i) => i > lastIndex && (rawOf(i)?.end ?? 0) >= word.end);
      if (closing >= 0) endMs = Math.max(endMs, spoken[closing].end * 1000);
    }
  }
  const firstIndex = spoken.findIndex((word) => word.end * 1000 > startMs + 1);
  const firstRaw = firstIndex >= 0 ? rawOf(firstIndex) : null;
  if (firstRaw) {
    const word = wordSpans.find((span) => span.start < firstRaw.start && firstRaw.start < span.end);
    if (word) {
      const opening = lastIndexWhere(spoken.slice(0, firstIndex), (_, i) => (rawOf(i)?.start ?? Infinity) <= word.start);
      if (opening >= 0) startMs = Math.min(startMs, spoken[opening].start * 1000);
    }
  }
  return { startMs: Math.round(startMs), endMs: Math.round(endMs) };
}

/** Aligner tokens that are a bare particle: attached to the word before them, never the start of a phrase. */
const LEADING_PARTICLE_TOKENS = new Set([
  'で', 'に', 'を', 'は', 'が', 'も', 'と', 'の', 'へ', 'や', 'か', 'ね', 'よ', 'って',
  'から', 'まで', 'より', 'ので', 'のに', 'けど', 'し', 'て',
]);

/**
 * A phrase must not open on a particle: its host word is outside the span, so the particle is split
 * away from it (…1|で私は). Moves the start past such leading tokens while enough phrase remains.
 * Works on token text alone, so it holds where the aligner couldn't place a neighbour (<unk>).
 */
export function dropLeadingParticles(
  words: readonly Pick<WordAlignment, 'start' | 'end' | 'text'>[],
  range: { startMs: number; endMs: number },
): { startMs: number; endMs: number } {
  const tokens = words.filter((word) => word.text && word.text !== '<eps>' && word.end > word.start);
  let { startMs } = range;
  for (let guard = 0; guard < 3; guard += 1) {
    const index = tokens.findIndex((word) => word.end * 1000 > startMs + 1);
    const first = tokens[index];
    const next = tokens[index + 1];
    if (!first || !next || !LEADING_PARTICLE_TOKENS.has(first.text)) break;
    if (range.endMs - next.start * 1000 < MIN_PHRASE_MS) break;
    startMs = next.start * 1000;
  }
  return { startMs: Math.round(startMs), endMs: range.endMs };
}
