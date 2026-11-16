// ---------------------------------------------------------------------------
// Context-diversity queries (maturity ladder inputs, Phase 7.5). Moved down
// out of the sentence-led section so the explainability module below it can
// share them (REPOSITORY_SPLIT_HANDOFF step: "explainability (after moving
// the two context-diversity helpers it needs)").
// ---------------------------------------------------------------------------

import { computeContextDiversity, type ContextDiversity } from '../../lib/maturity';
import { getDb } from '../database';

/**
 * Fetches the data `computeContextDiversity` (src/lib/maturity.ts) needs for
 * a set of sentence ids and calls it — the Dexie-querying half of maturity
 * computation, kept separate from the pure ladder logic itself (Phase 7.1).
 * A sentence's "source" is the sourceKey (or id, as a stand-in) of any Book
 * containing it via `book_sentences`, since Sentence has no direct link to
 * the `sources` table yet. Shared by computeVocabularyContextDiversity and
 * computeGrammarPatternContextDiversity — same diversity question, different
 * link table feeding it the sentence ids.
 */
async function contextDiversityFromSentenceIds(
  sentenceIds: string[],
): Promise<ContextDiversity> {
  if (sentenceIds.length === 0) return computeContextDiversity(new Map());
  const db = getDb();

  const memberships = await db.bookSentences
    .where('sentenceId')
    .anyOf(sentenceIds)
    .toArray();
  const bookIds = [...new Set(memberships.map((item) => item.bookId))];
  const books = await db.books.bulkGet(bookIds);
  const sourceKeyByBookId = new Map<string, string>();
  books.forEach((book, index) => {
    if (book) sourceKeyByBookId.set(bookIds[index]!, book.sourceKey ?? book.id);
  });

  const sourceKeysBySentenceId = new Map<string, string[]>();
  for (const sentenceId of sentenceIds) {
    const keys = memberships
      .filter((item) => item.sentenceId === sentenceId)
      .map((item) => sourceKeyByBookId.get(item.bookId))
      .filter((key): key is string => Boolean(key));
    sourceKeysBySentenceId.set(sentenceId, keys);
  }
  return computeContextDiversity(sourceKeysBySentenceId);
}

export async function computeVocabularyContextDiversity(
  vocabularyItemId: string,
): Promise<ContextDiversity> {
  const db = getDb();
  const links = await db.sentenceVocabulary
    .where('vocabularyItemId')
    .equals(vocabularyItemId)
    .toArray();
  const sentenceIds = [...new Set(links.map((link) => link.sentenceId))];
  return contextDiversityFromSentenceIds(sentenceIds);
}

/** Grammar-pattern counterpart of computeVocabularyContextDiversity, over sentenceGrammar instead of sentenceVocabulary. */
export async function computeGrammarPatternContextDiversity(
  grammarPatternId: string,
): Promise<ContextDiversity> {
  const db = getDb();
  const links = await db.sentenceGrammar
    .where('grammarPatternId')
    .equals(grammarPatternId)
    .toArray();
  const sentenceIds = [...new Set(links.map((link) => link.sentenceId))];
  return contextDiversityFromSentenceIds(sentenceIds);
}
