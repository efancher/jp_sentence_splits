// ---------------------------------------------------------------------------
// Context-sentence picking: the passage around a sentence and the
// most-recently-linked encounter for a grammar pattern. Bottom layer so the
// FSRS defer pass and the grammar section above can both call it.
// ---------------------------------------------------------------------------

import type { Book, Sentence, SentenceGrammar } from '../../domain/types';
import { isUnreviewedAiLink } from '../../lib/grammarLinkVisibility';
import { type ReadingContext } from '../../lib/readingContext';
import { sentenceIsSuspendedOnly, type SuspendedBookIndex } from '../../lib/suspendedBooks';
import { getDb } from '../database';

export async function getReadingContextForSentence(sentenceId: string): Promise<ReadingContext> {
  const db = getDb();
  const memberships = await db.bookSentences.where('sentenceId').equals(sentenceId).toArray();
  if (memberships.length === 0) return { before: [], after: [] };
  const bookIds = [...new Set(memberships.map((m) => m.bookId))];
  const books = await db.books.bulkGet(bookIds);
  const bookById = new Map<string, Book>();
  books.forEach((book, index) => {
    if (book) bookById.set(bookIds[index]!, book);
  });
  const home = [...memberships].sort((a, b) => {
    const openedA = bookById.get(a.bookId)?.lastOpenedAt;
    const openedB = bookById.get(b.bookId)?.lastOpenedAt;
    return (openedB ? Date.parse(openedB) : 0) - (openedA ? Date.parse(openedA) : 0);
  })[0]!;
  const orderedRows = await db.bookSentences.where('bookId').equals(home.bookId).sortBy('position');
  const index = orderedRows.findIndex((row) => row.sentenceId === sentenceId);
  if (index === -1) return { before: [], after: [] };
  const beforeRows = orderedRows.slice(Math.max(0, index - 2), index);
  const afterRows = orderedRows.slice(index + 1, index + 2);
  const neighbourIds = [...beforeRows, ...afterRows].map((row) => row.sentenceId);
  const neighbourSentences = neighbourIds.length ? await db.sentences.bulkGet(neighbourIds) : [];
  const sentenceById = new Map<string, Sentence>();
  neighbourSentences.forEach((sentence, i) => {
    if (sentence) sentenceById.set(neighbourIds[i]!, sentence);
  });
  return {
    before: beforeRows
      .map((row) => sentenceById.get(row.sentenceId))
      .filter((s): s is Sentence => Boolean(s)),
    after: afterRows
      .map((row) => sentenceById.get(row.sentenceId))
      .filter((s): s is Sentence => Boolean(s)),
    bookTitle: bookById.get(home.bookId)?.title,
    bookId: home.bookId,
  };
}

/**
 * Most-recently-linked sentence for a grammar pattern — mirrors
 * pickContextSentenceForVocabularyItem's shape exactly, including its lack
 * of any "rest of the sentence must be proficient" gate (2026-09-15, user
 * request: grammar review should be gated the same as vocabulary review,
 * not more strictly — the earlier stricter gate, mirroring
 * getSentenceFullReviewReadiness, made the pattern almost never eligible
 * at all, see docs/ROADMAP.md). Used by ReviewPage to pick which of a
 * tracked pattern's encounters to show for its `grammar_completion` card,
 * along with the encounter's reading-order passage context.
 *
 * Pass `suspendedIndex` (from `loadSuspendedBookIndex`, loaded once by the
 * caller) to skip encounters that live only in suspended books — the pattern
 * itself isn't book-scoped, but drilling it on a sentence from a shelved book
 * is the same "keeps showing a book I suspended" problem (user report
 * 2026-09-20). A pattern whose every encounter is suspended-only yields
 * `undefined`. The persistent defer pass deliberately omits it: a temporary
 * suspension shouldn't push stored due dates out.
 */
export async function pickContextSentenceForGrammarPattern(
  grammarPatternId: string,
  suspendedIndex?: SuspendedBookIndex | null,
): Promise<
  { sentence: Sentence; sentenceGrammar: SentenceGrammar; readingContext: ReadingContext } | undefined
> {
  const db = getDb();
  const links = await db.sentenceGrammar
    .where('grammarPatternId')
    .equals(grammarPatternId)
    .toArray();
  if (links.length === 0) return undefined;
  // An assistant link the learner never acted on is not a sentence to build a card from.
  const sorted = links.filter((link) => !isUnreviewedAiLink(link)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const link of sorted) {
    if (suspendedIndex && sentenceIsSuspendedOnly(link.sentenceId, suspendedIndex)) continue;
    const sentence = await db.sentences.get(link.sentenceId);
    if (!sentence) continue;
    const readingContext = await getReadingContextForSentence(sentence.id);
    return { sentence, sentenceGrammar: link, readingContext };
  }
  return undefined;
}
