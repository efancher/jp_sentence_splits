import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { findReusableChapter, getBookWithExtras, getDb, mergeBookIntoChapter } from '../src/db/repository';
import type { Book, BookChapter, BookSentence } from '../src/domain/types';
import { createId } from '../src/lib/ids';

const T = '2026-10-17T00:00:00.000Z';

function book(id: string, title: string, extra: Partial<Book> = {}): Book {
  return { id, title, archived: false, createdAt: T, updatedAt: T, chapters: [], collapsedChapterIds: [], ...extra };
}
function chapter(id: string, title: string, position: number, extra: Partial<BookChapter> = {}): BookChapter {
  return { id, title, position, ...extra };
}
function membership(id: string, bookId: string, sentenceId: string, position: number, chapterId?: string, status: BookSentence['status'] = 'unstarted'): BookSentence {
  return { id, bookId, sentenceId, position, status, addedAt: T, ...(chapterId ? { chapterId } : {}) };
}

describe('findReusableChapter', () => {
  const chapters = [chapter('c1', 'Episode 1', 0), chapter('c2', 'Episode 2', 1, { sourceId: 'src-2' }), chapter('c3', 'Episode 2', 2)];

  it('prefers an empty chapter with the same source id', () => {
    expect(findReusableChapter(chapters, [], { title: 'Episode 2', sourceId: 'src-2' })?.id).toBe('c2');
  });

  it('falls back to a unique exact-title match, and never guesses between several', () => {
    expect(findReusableChapter(chapters, [], { title: 'Episode 1' })?.id).toBe('c1');
    expect(findReusableChapter(chapters, [], { title: 'Episode 2' })).toBeUndefined();
    expect(findReusableChapter(chapters, [], { title: 'Episode 9' })).toBeUndefined();
  });

  it('ignores chapters that already hold sentences', () => {
    expect(findReusableChapter(chapters, [{ chapterId: 'c1' }], { title: 'Episode 1' })).toBeUndefined();
  });
});

describe('mergeBookIntoChapter', () => {
  beforeEach(() => {
    resetDbForTests(`merge-book-${createId('db')}`);
  });

  async function seed(targetChapters: BookChapter[]) {
    const db = getDb();
    await db.books.bulkPut([
      book('series', 'Series', { chapters: targetChapters }),
      book('standalone', 'Episode 45', { sourceKey: 'src-45' }),
    ]);
    await db.bookSentences.bulkPut([
      membership('t1', 'series', 'sA', 0, 'c-other'),
      membership('s1', 'standalone', 'sB', 0, undefined, 'in_progress'),
      membership('s2', 'standalone', 'sC', 1),
    ]);
  }

  it('fills a matching empty chapter instead of adding a duplicate', async () => {
    await seed([chapter('c-other', 'Episode 44', 0), chapter('c-45', 'Episode 45', 1)]);
    const result = await mergeBookIntoChapter({ sourceBookId: 'standalone', targetBookId: 'series' });
    expect(result).toMatchObject({ chapterId: 'c-45', movedCount: 2, collisionCount: 0, reusedChapter: true });

    const db = getDb();
    expect((await db.books.get('series'))!.chapters.map((c) => c.id)).toEqual(['c-other', 'c-45']);
    expect(await db.books.get('standalone')).toBeUndefined();
    const moved = await db.bookSentences.where('bookId').equals('series').toArray();
    expect(moved.filter((m) => m.chapterId === 'c-45').map((m) => m.sentenceId).sort()).toEqual(['sB', 'sC']);
    expect(moved.find((m) => m.sentenceId === 'sB')?.status).toBe('in_progress');
  });

  it('repoints the source book\'s AI extras so the target still sees chunks and walkthroughs', async () => {
    await seed([chapter('c-other', 'Episode 44', 0), chapter('c-45', 'Episode 45', 1)]);
    const db = getDb();
    const chunk = { japanese: 'あ', role: 'x', gloss: 'y' } as never;
    await db.sentenceExtras.bulkPut([
      { id: 'sB', bookId: 'standalone', chapterId: 'old-ch', structureDraft: [chunk], createdAt: T, updatedAt: T },
      { id: 'sC', bookId: 'standalone', chapterId: 'old-ch', structureDraft: [chunk], createdAt: T, updatedAt: T },
      { id: 'sA', bookId: 'series', chapterId: 'c-other', structureDraft: [chunk], createdAt: T, updatedAt: T },
    ]);
    await mergeBookIntoChapter({ sourceBookId: 'standalone', targetBookId: 'series' });

    const rows = await db.sentenceExtras.where('bookId').equals('series').toArray();
    expect(rows.map((r) => [r.id, r.chapterId]).sort()).toEqual([['sA', 'c-other'], ['sB', 'c-45'], ['sC', 'c-45']]);
    expect(await db.sentenceExtras.where('bookId').equals('standalone').count()).toBe(0);
    const overlaid = await getBookWithExtras('series');
    expect(Object.keys(overlaid!.chapters.find((c) => c.id === 'c-45')!.structureDrafts ?? {}).sort()).toEqual(['sB', 'sC']);
  });

  it('adds a new chapter when no empty chapter matches', async () => {
    await seed([chapter('c-other', 'Episode 44', 0)]);
    const result = await mergeBookIntoChapter({ sourceBookId: 'standalone', targetBookId: 'series' });
    expect(result.reusedChapter).toBe(false);
    expect((await getDb().books.get('series'))!.chapters).toHaveLength(2);
  });

  it('honours an explicit chapter and rejects an unknown one', async () => {
    await seed([chapter('c-other', 'Episode 44', 0), chapter('c-45', 'Episode 45', 1), chapter('c-x', 'Something else', 2)]);
    await expect(mergeBookIntoChapter({ sourceBookId: 'standalone', targetBookId: 'series', intoChapterId: 'nope' }))
      .rejects.toThrow('Chapter not found');
    const result = await mergeBookIntoChapter({ sourceBookId: 'standalone', targetBookId: 'series', intoChapterId: 'c-x' });
    expect(result).toMatchObject({ chapterId: 'c-x', reusedChapter: true });
  });
});
