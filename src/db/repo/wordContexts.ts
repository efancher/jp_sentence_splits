import { pickOtherContexts, type ContextCandidate, type WordContext } from '../../lib/wordContexts';
import { getDb } from '../database';
import { getIntroducedSentenceIds } from './reviewScheduling';

/**
 * For each word, other already-introduced sentences (any book) that carry it in a different context, so a word
 * seen only in one line can be met elsewhere. Read-only and on demand (one scan of the sentence table), so the
 * reader calls it when asked rather than on load. Nothing here records evidence or touches scheduling.
 */
export async function loadOtherWordContexts(
  sentenceId: string,
  expressions: readonly string[],
): Promise<Map<string, WordContext[]>> {
  const result = new Map<string, WordContext[]>();
  if (expressions.length === 0) return result;
  const db = getDb();
  const wanted = new Set(expressions);
  const rows = await db.sentences.toArray();
  const carrying = rows.filter((row) =>
    row.vocabularySuggestions.some((item) => item.selectedByDefault && wanted.has(item.expression)),
  );
  const introduced = await getIntroducedSentenceIds(carrying.map((row) => row.id));
  const candidates: ContextCandidate[] = carrying
    .filter((row) => introduced.has(row.id))
    .map((row) => ({
      sentenceId: row.id,
      japanese: row.japanese,
      translation: row.translation,
      suggestions: row.vocabularySuggestions,
    }));
  const current = rows.find((row) => row.id === sentenceId);
  if (!current) return result;
  const here: ContextCandidate = {
    sentenceId: current.id,
    japanese: current.japanese,
    translation: current.translation,
    suggestions: current.vocabularySuggestions,
  };
  for (const expression of expressions) result.set(expression, pickOtherContexts(expression, here, candidates));
  return result;
}
