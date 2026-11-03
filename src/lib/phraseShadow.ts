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
