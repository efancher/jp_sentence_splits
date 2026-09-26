import type { Book, StudyItem } from '../domain/types';

/**
 * A book can be **suspended** (`Book.suspendedAt` set) — shelved because it's
 * too hard right now, to be resumed later. A single **chapter** within a book
 * can be suspended the same way (`BookChapter.suspendedAt`) — useful when
 * only part of a book is the problem (e.g. one noisy episode). Either form:
 *   - produces no session-planner work (the candidate finders filter it out,
 *     same as `archived`), and
 *   - has its **exclusive** review cards held back from the global `/review`
 *     queue: a word or sentence is only held back when *every* membership it
 *     has (book, or specific chapter within a book) is shelved. A word that
 *     also lives in an active book/chapter keeps being reviewed there.
 *
 * The book-scoped review path (`/books/:id/review`) ignores all of this —
 * opening a suspended book's own review is a deliberate act.
 *
 * This module is pure; `loadSuspendedBookIndex` in `src/db/repository.ts`
 * builds the index from Dexie (and short-circuits to `null` when nothing is
 * suspended, so the common case costs nothing).
 */
export interface SuspendedBookIndex {
  suspendedBookIds: Set<string>;
  /** Chapter ids (`BookChapter.id`, unique across books) that are individually suspended. */
  suspendedChapterIds: Set<string>;
  /** sentenceId → every (bookId, chapterId) membership row it has. */
  membershipsBySentenceId: Map<string, Array<{ bookId: string; chapterId?: string }>>;
  /** vocabularyItemId → every sentenceId it's linked to via sentence_vocabulary. */
  sentenceIdsByVocabularyItemId: Map<string, string[]>;
  /** sentence_vocabulary link id → its sentenceId (for `sentenceVocabulary` study-item subjects). */
  sentenceIdByLinkId: Map<string, string>;
}

/** A book counts for session-planner rotation only when neither shelved nor archived. */
export function isBookInStudyRotation(
  book: Pick<Book, 'archived' | 'suspendedAt'>,
): boolean {
  return !book.archived && !book.suspendedAt;
}

/** True when a membership row is shelved by its book's or its own chapter's suspension. */
export function membershipIsShelved(
  membership: { bookId: string; chapterId?: string },
  index: Pick<SuspendedBookIndex, 'suspendedBookIds' | 'suspendedChapterIds'>,
): boolean {
  if (index.suspendedBookIds.has(membership.bookId)) return true;
  return !!membership.chapterId && index.suspendedChapterIds.has(membership.chapterId);
}

/** True when the sentence has at least one book membership and every one is shelved. */
export function sentenceIsSuspendedOnly(
  sentenceId: string,
  index: SuspendedBookIndex,
): boolean {
  const memberships = index.membershipsBySentenceId.get(sentenceId);
  if (!memberships || memberships.length === 0) return false;
  return memberships.every((membership) => membershipIsShelved(membership, index));
}

/**
 * True when the word is linked to at least one sentence and every sentence it's
 * linked to is itself suspended-only — i.e. the learner only meets this word in
 * suspended books.
 */
export function vocabularyItemIsSuspendedOnly(
  vocabularyItemId: string,
  index: SuspendedBookIndex,
): boolean {
  const sentenceIds = index.sentenceIdsByVocabularyItemId.get(vocabularyItemId);
  if (!sentenceIds || sentenceIds.length === 0) return false;
  return sentenceIds.every((sentenceId) => sentenceIsSuspendedOnly(sentenceId, index));
}

/**
 * Whether a due study item should be withheld from the global review queue
 * because every book its subject belongs to is suspended. `grammarPattern`
 * subjects are never held back *here* — a tracked pattern isn't scoped to one
 * book (same reasoning as ReviewPage's book-scoped grammar exclusion) — but
 * `pickContextSentenceForGrammarPattern` skips encounters that live only in
 * suspended books, so a pattern whose every encounter is shelved drops out
 * of the queue via that path instead.
 */
export function studyItemIsHeldBackBySuspension(
  item: Pick<StudyItem, 'subjectType' | 'subjectId'>,
  index: SuspendedBookIndex,
): boolean {
  switch (item.subjectType) {
    case 'sentence':
      return sentenceIsSuspendedOnly(item.subjectId, index);
    case 'vocabularyItem':
      return vocabularyItemIsSuspendedOnly(item.subjectId, index);
    case 'sentenceVocabulary': {
      const sentenceId = index.sentenceIdByLinkId.get(item.subjectId);
      return sentenceId ? sentenceIsSuspendedOnly(sentenceId, index) : false;
    }
    default:
      // chunk / vocabularyConfusion / grammarPattern: not held back here.
      // (Confusion pairs are filtered separately in ReviewPage from their
      // member words; grammar patterns are book-agnostic, and are held back
      // by pickContextSentenceForGrammarPattern's suspendedIndex arg instead.)
      return false;
  }
}
