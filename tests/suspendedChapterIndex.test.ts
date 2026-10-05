import { describe, expect, it } from 'vitest';

import { getDb } from '../src/db/database';
import { loadSuspendedBookIndex, setChapterSuspended } from '../src/db/repository';
import { sentenceIsSuspendedOnly } from '../src/lib/suspendedBooks';

describe('chapter suspension index', () => {
  it('flags a sentence whose only membership is a suspended chapter', async () => {
    const db = getDb();
    const now = new Date().toISOString();
    await db.books.put({
      id: 'b1',
      title: 'Podcast',
      archived: false,
      createdAt: now,
      updatedAt: now,
      chapters: [
        { id: 'c1', title: 'ep1', position: 0 },
        { id: 'c2', title: 'ep2', position: 1 },
      ],
    } as never);
    await db.bookSentences.bulkPut([
      { id: 'bs1', bookId: 'b1', sentenceId: 's1', position: 0, status: 'unstarted', addedAt: now, chapterId: 'c1' },
      { id: 'bs2', bookId: 'b1', sentenceId: 's2', position: 1, status: 'unstarted', addedAt: now, chapterId: 'c2' },
    ]);
    expect(await loadSuspendedBookIndex()).toBeNull();
    await setChapterSuspended('b1', 'c1', true);
    const index = await loadSuspendedBookIndex();
    expect(index).not.toBeNull();
    expect(sentenceIsSuspendedOnly('s1', index!)).toBe(true);
    expect(sentenceIsSuspendedOnly('s2', index!)).toBe(false);
  });
});
