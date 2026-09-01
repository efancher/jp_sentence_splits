import type { Book, BookSentence, Sentence } from '../domain/types';

/**
 * The sentences immediately before/after a target sentence in reading order,
 * used by the `reading_in_context` review card to differentiate it from
 * plain `comprehension` (docs/ROADMAP.md — "the two still share one
 * interaction"): the sentence under test is shown embedded in its passage
 * rather than in isolation, so the learner reads it the way it was actually
 * encountered.
 */
export interface ReadingContext {
  /** Preceding sentences, in reading order (closest last). */
  before: Sentence[];
  /** Following sentences, in reading order (closest first). */
  after: Sentence[];
  /** Title of the book the context was drawn from, for a caption. */
  bookTitle?: string;
}

const EMPTY_CONTEXT: ReadingContext = { before: [], after: [] };

/**
 * For each of `targetSentenceIds`, its `ReadingContext` within its "home"
 * book. A sentence can belong to several books; the home book is the most
 * recently opened one that contains it (`Book.lastOpenedAt` — the same
 * "continue where you left off" signal the session planner uses). Sentences
 * with no book membership, or whose home-book neighbours aren't in
 * `sentencesById` (e.g. a book-scoped queue only holding one book's rows),
 * get an empty context and the card falls back to the isolated layout.
 */
export function buildReadingContextMap({
  targetSentenceIds,
  bookSentences,
  books,
  sentencesById,
  before = 2,
  after = 1,
}: {
  targetSentenceIds: string[];
  bookSentences: BookSentence[];
  books: Book[];
  sentencesById: Map<string, Sentence>;
  before?: number;
  after?: number;
}): Map<string, ReadingContext> {
  const bookById = new Map(books.map((book) => [book.id, book]));

  const orderedByBook = new Map<string, BookSentence[]>();
  const membershipsBySentence = new Map<string, BookSentence[]>();
  for (const membership of bookSentences) {
    const bookRows = orderedByBook.get(membership.bookId) ?? [];
    bookRows.push(membership);
    orderedByBook.set(membership.bookId, bookRows);
    const sentenceRows = membershipsBySentence.get(membership.sentenceId) ?? [];
    sentenceRows.push(membership);
    membershipsBySentence.set(membership.sentenceId, sentenceRows);
  }
  for (const rows of orderedByBook.values()) {
    rows.sort((a, b) => a.position - b.position);
  }

  const openedAt = (bookId: string): number => {
    const value = bookById.get(bookId)?.lastOpenedAt;
    return value ? Date.parse(value) : 0;
  };

  const pick = (rows: BookSentence[]): Sentence[] =>
    rows
      .map((row) => sentencesById.get(row.sentenceId))
      .filter((sentence): sentence is Sentence => Boolean(sentence));

  const result = new Map<string, ReadingContext>();
  for (const sentenceId of targetSentenceIds) {
    const memberships = membershipsBySentence.get(sentenceId);
    if (!memberships || memberships.length === 0) {
      result.set(sentenceId, EMPTY_CONTEXT);
      continue;
    }
    const home = [...memberships].sort(
      (a, b) => openedAt(b.bookId) - openedAt(a.bookId),
    )[0]!;
    const ordered = orderedByBook.get(home.bookId) ?? [];
    const index = ordered.findIndex((row) => row.sentenceId === sentenceId);
    if (index === -1) {
      result.set(sentenceId, EMPTY_CONTEXT);
      continue;
    }
    result.set(sentenceId, {
      before: pick(ordered.slice(Math.max(0, index - before), index)),
      after: pick(ordered.slice(index + 1, index + 1 + after)),
      bookTitle: bookById.get(home.bookId)?.title,
    });
  }
  return result;
}
