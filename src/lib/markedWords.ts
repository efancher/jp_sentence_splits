import type { SentenceLearningEvent } from '../domain/types';

/**
 * Marked words (2026-11-22): in a chunk chain the learner can mark a word or phrase they struggled on so
 * phrase shadowing brings it back, in any sentence containing it. A mark is an append-only `phrase_shadow`
 * event keyed `marked-word:<surface>` (`needed_help` = marked, `got_it` = the learner unmarked it), so it
 * needs no table or sync change. It is scheduling input only: the key has no `phrase-shadow:` prefix, so
 * it credits no word and is not a pronunciation attempt. A mark clears itself after a Got it phrase pass
 * over the surface on two different days; marking again starts over.
 */
export const MARKED_WORD_KEY_PREFIX = 'marked-word:';
/** Distinct days of Got it passes that retire a mark. */
export const MARK_CLEAR_DAYS = 2;

export const markedWordKey = (surface: string) => `${MARKED_WORD_KEY_PREFIX}${surface}`;

export function markedWordSurface(key: string | undefined): string | null {
  if (!key?.startsWith(MARKED_WORD_KEY_PREFIX)) return null;
  return key.slice(MARKED_WORD_KEY_PREFIX.length) || null;
}

export interface MarkedWord {
  surface: string;
  /** When the live mark was last placed. */
  markedAt: string;
}

type MarkEvent = Pick<SentenceLearningEvent, 'action' | 'timestamp' | 'outcome' | 'target'>;

const localDay = (timestamp: string) => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

/** Marked words still waiting for their two Got it days, most recently marked first. */
export function activeMarkedWords(events: readonly MarkEvent[]): MarkedWord[] {
  const phrase = events.filter((event) => event.action === 'phrase_shadow' && event.outcome);
  const latest = new Map<string, { at: string; marked: boolean }>();
  for (const event of phrase) {
    const surface = markedWordSurface(event.target?.key);
    if (!surface) continue;
    const seen = latest.get(surface);
    if (!seen || event.timestamp >= seen.at) latest.set(surface, { at: event.timestamp, marked: event.outcome === 'needed_help' });
  }
  const passes = phrase.filter(
    (event) =>
      event.outcome === 'got_it' &&
      !markedWordSurface(event.target?.key) &&
      event.target?.key !== 'chain-cold:0' &&
      !!event.target?.label,
  );
  const out: MarkedWord[] = [];
  for (const [surface, { at, marked }] of latest) {
    if (!marked) continue;
    const days = new Set(passes.filter((pass) => pass.timestamp > at && pass.target!.label!.includes(surface)).map((pass) => localDay(pass.timestamp)));
    if (days.size < MARK_CLEAR_DAYS) out.push({ surface, markedAt: at });
  }
  return out.sort((a, b) => b.markedAt.localeCompare(a.markedAt));
}

/** The marked surfaces that occur in a sentence's text, longest first so a compound beats its part. */
export function markedSurfacesIn(japanese: string, marked: readonly MarkedWord[]): string[] {
  return marked
    .map((word) => word.surface)
    .filter((surface) => japanese.includes(surface))
    .sort((a, b) => b.length - a.length);
}

/** Words/phrases of a sentence the learner can mark inside a stretch of its text (deduplicated, sentence order). */
export function markableSurfaces(suggestions: readonly { surface: string; pos?: string }[] | undefined, text: string): string[] {
  // Particles and punctuation are never what the learner is stuck on, and would crowd the buttons.
  const skip = (pos?: string) => !!pos && (pos.startsWith('助詞') || pos.startsWith('補助記号'));
  return [
    ...new Set(
      (suggestions ?? []).filter((item) => item.surface && !skip(item.pos) && text.includes(item.surface)).map((item) => item.surface),
    ),
  ];
}
