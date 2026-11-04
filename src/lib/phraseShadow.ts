import type { SentenceLearningEvent, WordAlignment } from '../domain/types';

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

/**
 * The text of the aligned words that fall mostly (over half their length) inside the marked
 * span, joined in order. Alignment times are seconds from the start of the clip.
 */
export function phraseTextFromAlignment(
  words: readonly Pick<WordAlignment, 'start' | 'end' | 'text'>[],
  range: { startMs: number; endMs: number },
): string {
  const start = range.startMs / 1000;
  const end = range.endMs / 1000;
  return words
    .filter((word) => {
      const length = word.end - word.start;
      if (length <= 0) return false;
      const overlap = Math.min(word.end, end) - Math.max(word.start, start);
      return overlap > length / 2;
    })
    .map((word) => word.text)
    .join('');
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
  return { startMs: Math.round(startMs), endMs: Math.round(endMs) };
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
