import type { Book, SentenceExtras } from '../domain/types';
import { getDb } from './database';

/**
 * Returns the book with each chapter's `structureDrafts` / `constructionDrafts` /
 * `contextWalkthroughs` filled from `sentence_extras` (which win over any legacy
 * inline copy still on the chapter). READ-ONLY view: never `put` the result back,
 * or the blobs would be re-inlined into the synced book row.
 */
/**
 * iOS Safari sometimes throws "Attempt to iterate a cursor that doesn't exist" when a large
 * index read is in flight. Retry once, then fall back to point reads in small batches.
 */
async function readBookExtras(bookId: string): Promise<SentenceExtras[]> {
  const db = getDb();
  const read = () => db.sentenceExtras.where('bookId').equals(bookId).toArray();
  try {
    return await read();
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      return await read();
    } catch {
      const memberships = await db.bookSentences.where('bookId').equals(bookId).toArray();
      const ids = [...new Set(memberships.map((m) => m.sentenceId))];
      const rows: SentenceExtras[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const batch = await db.sentenceExtras.bulkGet(ids.slice(i, i + 100));
        for (const row of batch) if (row) rows.push(row);
      }
      return rows;
    }
  }
}

export async function withChapterExtras(book: Book): Promise<Book> {
  const rows = await readBookExtras(book.id);
  if (rows.length === 0) return book;
  const chapterIds = new Set(book.chapters.map((chapter) => chapter.id));
  const firstChapterId = book.chapters[0]?.id;
  const byChapter = new Map<string, SentenceExtras[]>();
  for (const row of rows) {
    const target = row.chapterId && chapterIds.has(row.chapterId) ? row.chapterId : firstChapterId;
    if (!target) continue;
    const list = byChapter.get(target);
    if (list) list.push(row);
    else byChapter.set(target, [row]);
  }
  return {
    ...book,
    chapters: book.chapters.map((chapter) => {
      const extras = byChapter.get(chapter.id);
      if (!extras) return chapter;
      const structureDrafts = { ...chapter.structureDrafts };
      const constructionDrafts = { ...chapter.constructionDrafts };
      const contextWalkthroughs = { ...chapter.contextWalkthroughs };
      for (const row of extras) {
        if (row.structureDraft) structureDrafts[row.id] = row.structureDraft;
        if (row.constructionDraft) constructionDrafts[row.id] = row.constructionDraft;
        if (row.contextWalkthrough) contextWalkthroughs[row.id] = row.contextWalkthrough;
      }
      return { ...chapter, structureDrafts, constructionDrafts, contextWalkthroughs };
    }),
  };
}

/** `db.books.get` + the `sentence_extras` overlay; read-only (see withChapterExtras). */
export async function getBookWithExtras(bookId: string): Promise<Book | undefined> {
  const book = await getDb().books.get(bookId);
  return book ? withChapterExtras(book) : undefined;
}
