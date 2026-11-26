import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { getDb, moveChapterToBook } from '../src/db/repository';
import type { Book, BookChapter, BookSentence } from '../src/domain/types';
import { createId } from '../src/lib/ids';

const T = '2026-11-26T00:00:00.000Z';

function book(id: string, title: string, chapters: BookChapter[] = []): Book {
  return { id, title, archived: false, createdAt: T, updatedAt: T, chapters, collapsedChapterIds: [] };
}
function membership(id: string, bookId: string, sentenceId: string, position: number, chapterId?: string): BookSentence {
  return { id, bookId, sentenceId, position, status: 'unstarted', addedAt: T, ...(chapterId ? { chapterId } : {}) };
}

describe('moveChapterToBook', () => {
  beforeEach(() => {
    resetDbForTests(`move-chapter-${createId('db')}`);
  });

  it('moves one episode with its sentences, keeping the others in place', async () => {
    const db = getDb();
    await db.books.bulkPut([
      book('wrong', 'Wrong podcast', [
        { id: 'e1', title: 'Ep 1', position: 0, sourceId: 'src-1' },
        { id: 'e2', title: 'Ep 2', position: 1, sourceId: 'src-2' },
      ]),
      book('right', 'Right podcast', [{ id: 'r1', title: 'Ep 9', position: 0 }]),
    ]);
    await db.bookSentences.bulkPut([
      membership('m1', 'wrong', 's1', 0, 'e1'),
      membership('m2', 'wrong', 's2', 1, 'e2'),
      membership('m3', 'wrong', 's3', 2, 'e2'),
      membership('m4', 'right', 's9', 0, 'r1'),
      membership('m5', 'right', 's3', 1, 'r1'),
    ]);
    await db.miningImports.put({
      id: 'mi1',
      sourceId: 'src-2',
      sourceType: 'podcast',
      title: 'Ep 2',
      status: 'committed',
      bookId: 'wrong',
      chapterId: 'e2',
      createdAt: T,
      updatedAt: T,
    });

    const result = await moveChapterToBook({ sourceBookId: 'wrong', chapterId: 'e2', targetBookId: 'right' });

    expect(result.movedCount).toBe(1);
    expect(result.collisionCount).toBe(1);
    const wrong = await db.books.get('wrong');
    expect(wrong?.chapters?.map((c) => c.id)).toEqual(['e1']);
    const right = await db.books.get('right');
    expect(right?.chapters?.map((c) => c.title)).toEqual(['Ep 9', 'Ep 2']);
    const moved = right!.chapters!.find((c) => c.title === 'Ep 2')!;
    expect(moved.sourceId).toBe('src-2');
    expect(moved.position).toBe(1);

    const wrongRows = await db.bookSentences.where('bookId').equals('wrong').toArray();
    expect(wrongRows.map((r) => r.sentenceId)).toEqual(['s1']);
    const rightRows = await db.bookSentences.where('bookId').equals('right').sortBy('position');
    expect(rightRows.map((r) => r.sentenceId)).toEqual(['s9', 's3', 's2']);
    expect(rightRows.find((r) => r.sentenceId === 's2')?.chapterId).toBe(moved.id);
    // The collided sentence keeps the target's copy and chapter.
    expect(rightRows.find((r) => r.sentenceId === 's3')?.chapterId).toBe('r1');

    const imp = await db.miningImports.get('mi1');
    expect(imp?.bookId).toBe('right');
    expect(imp?.chapterId).toBe(moved.id);
  });

  it('rejects the same book and unknown chapters', async () => {
    const db = getDb();
    await db.books.bulkPut([book('a', 'A', [{ id: 'c', title: 'C', position: 0 }]), book('b', 'B')]);
    await expect(moveChapterToBook({ sourceBookId: 'a', chapterId: 'c', targetBookId: 'a' })).rejects.toThrow();
    await expect(moveChapterToBook({ sourceBookId: 'a', chapterId: 'nope', targetBookId: 'b' })).rejects.toThrow();
  });
});
