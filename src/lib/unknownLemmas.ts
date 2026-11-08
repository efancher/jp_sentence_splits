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
export type LemmaSource = Pick<VocabularySuggestion, 'expression' | 'reading' | 'selectedByDefault'> &
  Partial<Pick<VocabularySuggestion, 'pos'>>;

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
 * (e.g. confirmed vocabulary items). With `minExposures` above 1 a lemma met in fewer introduced sentences stays
 * unknown unless it is an extra key.
 */
export function buildKnownLemmaSet(
  introducedSentences: Iterable<readonly LemmaSource[] | undefined>,
  extraKnownKeys: Iterable<string> = [],
  minExposures: number = 1,
): Set<string> {
  const known = new Set<string>(extraKnownKeys);
  const sightings = new Map<string, number>();
  for (const suggestions of introducedSentences) {
    for (const key of sentenceContentLemmas(suggestions)) sightings.set(key, (sightings.get(key) ?? 0) + 1);
  }
  for (const [key, count] of sightings) if (count >= minExposures) known.add(key);
  return known;
}

/**
 * Introduced sentences a lemma must appear in before i+1 counts it as met (the planner passes this; extra keys such
 * as reviewed-card words are trusted regardless). Mirrors `GRAMMAR_MIN_EXPOSURES`.
 */
export const WORD_MIN_EXPOSURES = 2;

/** Content lemmas of a sentence the learner has not met yet. */
export function unknownLemmasForSentence(
  suggestions: readonly LemmaSource[] | undefined,
  known: ReadonlySet<string>,
): string[] {
  return sentenceContentLemmas(suggestions).filter((key) => !known.has(key));
}

/**
 * Pure discourse markers that UniDic tags as ordinary adverbs/demonstratives
 * (or as fillers only some of the time), so POS alone misses them. Deliberately
 * short and limited to words that carry no meaning of their own; real words
 * that merely happen to be frequent (ちょっと, やる, わかる) are not listed.
 */
const DISCOURSE_MARKERS = new Set(['まあ', 'あの', 'えっと', 'えーと', 'ええ', 'ねえ', 'さあ', 'ほら']);

/**
 * Verbs that UniDic splits out of a fixed grammar pattern and that are only ever
 * met inside it (しれる from かもしれない), so learning the pattern, not the
 * word, is what they stand for. Short on purpose: only lemmas with no life
 * outside the pattern.
 */
const GRAMMAR_BOUND_LEMMAS = new Set(['しれる', 'いける', 'ござる', 'なさる']);

/**
 * Lemmas that are only bound under one POS tag, because the same text is a real word under another
 * (つく/動詞/一般 is the につい-て of について, 175 of 175 audited; 気がつく and 嘘をつく are 動詞/非自立可能).
 */
const GRAMMAR_BOUND_BY_POS = new Map([['つく', '動詞/一般']]);

/** How much a lemma is worth introducing a whole sentence for, 0..1 (see `unlockValueByLemma`). */
export const LEMMA_WEIGHT = { filler: 0.2, grammarBound: 0.3, properNoun: 0.5, normal: 1 } as const;

/**
 * Ranking weight for introducing a lemma: interjections/fillers (感動詞) and
 * discourse markers rarely repay a lesson, a name is learnt on sight, and a
 * grammar-bound verb is really a pattern, not a word.
 * Applies to which new word to teach next only — such a word still counts as
 * unknown when deciding whether a sentence is i+1.
 */
export function lemmaWeight(expression: string, pos: string | undefined): number {
  if (pos?.startsWith('感動詞') || DISCOURSE_MARKERS.has(expression)) return LEMMA_WEIGHT.filler;
  if (GRAMMAR_BOUND_LEMMAS.has(expression) || (pos && GRAMMAR_BOUND_BY_POS.get(expression) === pos)) return LEMMA_WEIGHT.grammarBound;
  if (pos?.startsWith('名詞/固有名詞')) return LEMMA_WEIGHT.properNoun;
  return LEMMA_WEIGHT.normal;
}

export type SentenceScore =
  | { scorable: true; unknown: string[]; total: number }
  | { scorable: false; reason: 'no-tokens' | 'no-content-words' };

/**
 * Scores one sentence for i+1 ranking. An empty suggestion list means the
 * sentence was never tokenized (CSV/Anki imports write `[]` until
 * `backfill:vocabulary-suggestions` runs), which is "not scorable", never
 * "zero unknowns" — otherwise untokenized imports would look perfectly easy
 * and jump the queue. A tokenized sentence with no default-checked content
 * word (interjections, names only) is also unscorable, for a different reason.
 */
export function scoreSentence(
  suggestions: readonly LemmaSource[] | undefined,
  known: ReadonlySet<string>,
): SentenceScore {
  if (!suggestions || suggestions.length === 0) return { scorable: false, reason: 'no-tokens' };
  const lemmas = sentenceContentLemmas(suggestions);
  if (lemmas.length === 0) return { scorable: false, reason: 'no-content-words' };
  return { scorable: true, unknown: lemmas.filter((key) => !known.has(key)), total: lemmas.length };
}

/**
 * How many not-yet-ready sentences each unknown lemma would bring within
 * reach: a sentence with `n` unknowns (1..maxUnknown) gives each of its
 * unknowns `1 / n`, so learning the lone unknown of an i+1 sentence outweighs
 * one of five. Used to rank which new word to introduce next. `weightOf`
 * scales each lemma's share (see `lemmaWeight`); the default counts all equally.
 */
export function unlockValueByLemma(
  unknownLemmasBySentence: Iterable<readonly string[]>,
  maxUnknown = 2,
  weightOf: (key: string) => number = () => 1,
): Map<string, number> {
  const value = new Map<string, number>();
  for (const unknown of unknownLemmasBySentence) {
    if (unknown.length === 0 || unknown.length > maxUnknown) continue;
    for (const key of unknown) value.set(key, (value.get(key) ?? 0) + weightOf(key) / unknown.length);
  }
  return value;
}

/** Counts of sentences by unknown-lemma count, with `capAt` and above pooled in the last bucket. */
export function unknownCountHistogram(unknownCounts: Iterable<number>, capAt = 8): number[] {
  const buckets = new Array<number>(capAt + 1).fill(0);
  for (const count of unknownCounts) buckets[Math.min(count, capAt)] += 1;
  return buckets;
}
