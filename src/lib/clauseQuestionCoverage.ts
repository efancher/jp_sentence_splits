import type { Book, Sentence } from '../domain/types';
import { isBookInStudyRotation } from './suspendedBooks';
import { clauseQuestionAvailability } from './clausePilot';

export type CoverageBook = Pick<Book, 'id' | 'title' | 'archived' | 'suspendedAt' | 'chapters'>;
export interface CoverageMembership { bookId: string; sentenceId: string; chapterId?: string; position: number }
export type CoverageSentence = Pick<Sentence, 'id' | 'japanese' | 'translation'>;

/** Include a shared sentence if ANY membership is active; count each source ID once. */
export function activeQuestionCoverage(books: CoverageBook[], memberships: CoverageMembership[], sentences: CoverageSentence[]) {
  const activeBooks = new Map(books.filter(isBookInStudyRotation).map((book) => [book.id, book]));
  const byId = new Map(sentences.map((sentence) => [sentence.id, sentence]));
  const result = new Map<string, CoverageSentence & {
    status: 'ready' | 'reviewed' | 'missing'; reason?: string; referenceId?: string;
    memberships: { bookId: string; bookTitle: string; chapterId?: string; chapterTitle?: string; position: number }[];
  }>();
  for (const membership of memberships) {
    const book = activeBooks.get(membership.bookId);
    const sentence = byId.get(membership.sentenceId);
    if (!book || !sentence) continue;
    const chapter = book.chapters?.find((item) => item.id === membership.chapterId);
    if (chapter?.suspendedAt) continue;
    let row = result.get(sentence.id);
    if (!row) {
      const availability = clauseQuestionAvailability(sentence.japanese);
      row = { ...sentence, status: availability.status, memberships: [],
        ...(availability.status === 'ready' ? { referenceId: availability.reference.id } : {}),
        ...(availability.status === 'reviewed' ? { reason: availability.reason } : {}),
      };
      result.set(sentence.id, row);
    }
    row.memberships.push({ bookId: book.id, bookTitle: book.title, chapterId: membership.chapterId,
      chapterTitle: chapter?.title, position: membership.position });
  }
  return [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
}
