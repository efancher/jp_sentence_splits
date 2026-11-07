import type { VocabularySuggestion } from '../domain/types';

/**
 * Building blocks for i+1 sequencing (docs/ROADMAP.md, "organic vocabulary/
 * grammar growth"): which content words in a sentence has the learner not met
 * yet? Pure functions over fetched inputs — no database access — so the
 * `diagnose:i-plus-one` script and a future scheduler share one definition.
 *
 * Content words come from the sentence's morphology suggestions that start
 * checked in the vocab picker (`selectedByDefault`: the content-vs-function
 * rule, so particles, bound auxiliaries and the like never count). Lemmas are
 * keyed by expression + reading so homographs stay distinct. This deliberately
 * does not use `sentence_vocabulary` links (only sentences that went through
 * the picker have them) or card history (cards are paused under the
 * sentence-led flow).
 */
export type LemmaSource = Pick<VocabularySuggestion, 'expression' | 'reading' | 'selectedByDefault'>;

export function lemmaKey(expression: string, reading: string): string {
  return `${expression}|${reading}`;
}

/** Distinct content-word lemma keys of one sentence, in first-seen order. */
export function sentenceContentLemmas(suggestions: readonly LemmaSource[] | undefined): string[] {
  const seen = new Set<string>();
  for (const suggestion of suggestions ?? []) {
    if (!suggestion.selectedByDefault) continue;
    seen.add(lemmaKey(suggestion.expression, suggestion.reading));
  }
  return [...seen];
}

/**
 * Lemmas the learner has met: the content words of every introduced sentence
 * (`getIntroducedSentenceIds`), plus any extra keys the caller already trusts
 * (e.g. confirmed vocabulary items).
 */
export function buildKnownLemmaSet(
  introducedSentences: Iterable<readonly LemmaSource[] | undefined>,
  extraKnownKeys: Iterable<string> = [],
): Set<string> {
  const known = new Set<string>(extraKnownKeys);
  for (const suggestions of introducedSentences) {
    for (const key of sentenceContentLemmas(suggestions)) known.add(key);
  }
  return known;
}

/** Content lemmas of a sentence the learner has not met yet. */
export function unknownLemmasForSentence(
  suggestions: readonly LemmaSource[] | undefined,
  known: ReadonlySet<string>,
): string[] {
  return sentenceContentLemmas(suggestions).filter((key) => !known.has(key));
}

/**
 * How many not-yet-ready sentences each unknown lemma would bring within
 * reach: a sentence with `n` unknowns (1..maxUnknown) gives each of its
 * unknowns `1 / n`, so learning the lone unknown of an i+1 sentence outweighs
 * one of five. Used to rank which new word to introduce next.
 */
export function unlockValueByLemma(
  unknownLemmasBySentence: Iterable<readonly string[]>,
  maxUnknown = 2,
): Map<string, number> {
  const value = new Map<string, number>();
  for (const unknown of unknownLemmasBySentence) {
    if (unknown.length === 0 || unknown.length > maxUnknown) continue;
    for (const key of unknown) value.set(key, (value.get(key) ?? 0) + 1 / unknown.length);
  }
  return value;
}

/** Counts of sentences by unknown-lemma count, with `capAt` and above pooled in the last bucket. */
export function unknownCountHistogram(unknownCounts: Iterable<number>, capAt = 8): number[] {
  const buckets = new Array<number>(capAt + 1).fill(0);
  for (const count of unknownCounts) buckets[Math.min(count, capAt)] += 1;
  return buckets;
}
