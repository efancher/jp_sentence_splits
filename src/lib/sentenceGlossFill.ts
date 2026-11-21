import type { VocabularySuggestion } from '../domain/types';
import { getBookSentencesForGlossing, updateSentenceVocabularySuggestions } from '../db/repository';
import { runPool } from './assistChunks';
import { glossWordsViaAssist } from './assistGlosses';
import { isGlossOnlySuggestion } from './vocabularySuggestions';

/**
 * Just-in-time glosses for the Reader's word help. The tokenizer never gives a
 * suggestion an English meaning, so a sentence that never passed through the
 * vocabulary review page shows no definitions for words without a saved meaning.
 */

/** Content words with neither a stored gloss nor a saved vocabulary meaning (the words word help would drop). */
export function suggestionsNeedingGloss(
  suggestions: readonly VocabularySuggestion[],
  savedMeanings: ReadonlyMap<string, string> = new Map(),
): VocabularySuggestion[] {
  const seen = new Set<string>();
  return suggestions.filter((item) => {
    if (item.english?.trim() || savedMeanings.get(item.expression)?.trim()) return false;
    if (!item.selectedByDefault && !isGlossOnlySuggestion(item)) return false;
    if (seen.has(item.expression)) return false;
    seen.add(item.expression);
    return true;
  });
}

/** Merge AI glosses onto matching suggestions that still have none; every other suggestion is returned untouched. */
export function applyGlosses(
  suggestions: readonly VocabularySuggestion[],
  glosses: readonly { expression: string; meaning: string }[],
): VocabularySuggestion[] {
  const byExpression = new Map(glosses.filter((gloss) => gloss.meaning?.trim()).map((gloss) => [gloss.expression, gloss.meaning.trim()]));
  return suggestions.map((item) =>
    !item.english?.trim() && byExpression.has(item.expression) ? { ...item, english: byExpression.get(item.expression)! } : item,
  );
}

type GlossableSentence = {
  id: string;
  japanese: string;
  vocabularySuggestions: readonly VocabularySuggestion[];
};

/** Ask the assistant for the sentence's missing glosses and persist them; true when any were saved. */
async function glossSentence(sentence: GlossableSentence, savedMeanings: ReadonlyMap<string, string>): Promise<boolean> {
  const needing = suggestionsNeedingGloss(sentence.vocabularySuggestions, savedMeanings);
  if (needing.length === 0) return false;
  const glosses = await glossWordsViaAssist(
    sentence.japanese,
    needing.map((item) => ({ expression: item.expression, reading: item.reading, surface: item.surface })),
  );
  if (glosses.length === 0) return false;
  const next = applyGlosses(sentence.vocabularySuggestions, glosses);
  if (next.every((item, index) => item === sentence.vocabularySuggestions[index])) return false;
  await updateSentenceVocabularySuggestions(sentence.id, next);
  return true;
}

const attempted = new Set<string>();

/**
 * Gloss the sentence's unglossed content words in context via the box assistant and
 * persist them on the sentence. Tries each sentence once per page load; assistant
 * unreachable or failing just leaves the words unglossed. Returns whether any gloss
 * was saved.
 */
export async function fillSentenceGlosses(
  sentence: GlossableSentence,
  savedMeanings: ReadonlyMap<string, string> = new Map(),
): Promise<boolean> {
  if (attempted.has(sentence.id)) return false;
  if (suggestionsNeedingGloss(sentence.vocabularySuggestions, savedMeanings).length === 0) return false;
  attempted.add(sentence.id);
  return glossSentence(sentence, savedMeanings);
}

/** Sentences in the book that still have content words word help would drop. */
export async function countBookSentencesNeedingGloss(bookId: string): Promise<number> {
  const { sentences, savedMeanings } = await getBookSentencesForGlossing(bookId);
  return sentences.filter((sentence) => suggestionsNeedingGloss(sentence.vocabularySuggestions, savedMeanings).length > 0).length;
}

export interface BookGlossResult {
  /** Sentences that had missing glosses at the start. */
  total: number;
  /** Sentences that gained at least one gloss. */
  filled: number;
  /** Sentences the assistant returned nothing usable for (or that errored). */
  empty: number;
  cancelled: boolean;
}

/**
 * Gloss every sentence of a book that lacks glosses, one assistant call each, with
 * `concurrency` calls in flight. Each sentence is saved as it finishes, so a stop or
 * a failure keeps the work done and a rerun resumes with what is left.
 */
export async function fillBookGlosses(
  bookId: string,
  options: {
    concurrency?: number;
    isCancelled?: () => boolean;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<BookGlossResult> {
  const { sentences, savedMeanings } = await getBookSentencesForGlossing(bookId);
  const pending = sentences.filter((sentence) => suggestionsNeedingGloss(sentence.vocabularySuggestions, savedMeanings).length > 0);
  const result: BookGlossResult = { total: pending.length, filled: 0, empty: 0, cancelled: false };
  const isCancelled = options.isCancelled ?? (() => false);
  let done = 0;
  await runPool(
    pending,
    options.concurrency ?? 1,
    async (sentence) => {
      try {
        if (await glossSentence(sentence, savedMeanings)) result.filled += 1;
        else result.empty += 1;
      } catch {
        result.empty += 1;
      }
      done += 1;
      options.onProgress?.(done, pending.length);
    },
    isCancelled,
  );
  result.cancelled = isCancelled() && done < pending.length;
  return result;
}
