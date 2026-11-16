// ---------------------------------------------------------------------------
// The suspended-book/chapter index behind the global review queue, the
// planner and every eligibility gate that must skip shelved books' exclusive
// cards (src/lib/suspendedBooks.ts holds the pure predicates). Its whole-table
// reads go through the planner pass cache, so it sits just above
// `passReads.ts` for the sections above to share.
// ---------------------------------------------------------------------------

import { type SuspendedBookIndex } from '../../lib/suspendedBooks';
import { getDb } from '../database';
import {
  plannerShared,
  readAllBookSentencesForPass,
  readAllSentenceVocabularyForPass,
} from './passReads';

/**
 * Builds the index the global review queue and the session planner use to hold
 * back a suspended book's or chapter's exclusive cards. Returns `null` when
 * nothing is suspended — the overwhelmingly common case — so callers pay
 * nothing. When something *is* suspended it reads the whole `bookSentences` +
 * `sentenceVocabulary` tables (a few times per review-init / plan); acceptable
 * at this scale.
 */
export function loadSuspendedBookIndex(): Promise<SuspendedBookIndex | null> {
  // A planning pass asks for this from five places; each ask re-reads two whole tables.
  return plannerShared('suspendedBookIndex', ['books', 'bookSentences', 'sentenceVocabulary'], loadSuspendedBookIndexUncached);
}

async function loadSuspendedBookIndexUncached(): Promise<SuspendedBookIndex | null> {
  const db = getDb();
  const books = await db.books.toArray();
  const suspendedBookIds = new Set(
    books.filter((book) => book.suspendedAt).map((book) => book.id),
  );
  const suspendedChapterIds = new Set(
    books.flatMap((book) =>
      (book.chapters ?? []).filter((chapter) => chapter.suspendedAt).map((chapter) => chapter.id),
    ),
  );
  if (suspendedBookIds.size === 0 && suspendedChapterIds.size === 0) return null;

  const [memberships, links] = await Promise.all([
    readAllBookSentencesForPass(),
    readAllSentenceVocabularyForPass(),
  ]);

  const membershipsBySentenceId = new Map<string, Array<{ bookId: string; chapterId?: string }>>();
  for (const membership of memberships) {
    const entry = { bookId: membership.bookId, chapterId: membership.chapterId };
    const list = membershipsBySentenceId.get(membership.sentenceId);
    if (list) list.push(entry);
    else membershipsBySentenceId.set(membership.sentenceId, [entry]);
  }

  const sentenceIdsByVocabularyItemId = new Map<string, string[]>();
  const sentenceIdByLinkId = new Map<string, string>();
  for (const link of links) {
    sentenceIdByLinkId.set(link.id, link.sentenceId);
    const list = sentenceIdsByVocabularyItemId.get(link.vocabularyItemId);
    if (list) list.push(link.sentenceId);
    else sentenceIdsByVocabularyItemId.set(link.vocabularyItemId, [link.sentenceId]);
  }

  return {
    suspendedBookIds,
    suspendedChapterIds,
    membershipsBySentenceId,
    sentenceIdsByVocabularyItemId,
    sentenceIdByLinkId,
  };
}
