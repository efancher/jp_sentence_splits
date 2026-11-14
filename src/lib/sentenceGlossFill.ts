import type { VocabularySuggestion } from '../domain/types';
import { updateSentenceVocabularySuggestions } from '../db/repository';
import { glossWordsViaAssist } from './assistGlosses';

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
    if (!item.selectedByDefault || item.english?.trim() || savedMeanings.get(item.expression)?.trim()) return false;
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

const attempted = new Set<string>();

/**
 * Gloss the sentence's unglossed content words in context via the box assistant and
 * persist them on the sentence. Tries each sentence once per page load; signed
 * out, offline or AI failure just leaves the words unglossed. Returns whether
 * any gloss was saved.
 */
export async function fillSentenceGlosses(sentence: {
  id: string;
  japanese: string;
  vocabularySuggestions: readonly VocabularySuggestion[];
}, savedMeanings: ReadonlyMap<string, string> = new Map()): Promise<boolean> {
  if (attempted.has(sentence.id)) return false;
  const needing = suggestionsNeedingGloss(sentence.vocabularySuggestions, savedMeanings);
  if (needing.length === 0) return false;
  attempted.add(sentence.id);
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
