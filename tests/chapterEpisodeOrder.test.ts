import { beforeEach, describe, expect, it } from 'vitest';

import { resetDbForTests } from '../src/db/database';
import { createBook, createBookChapter, getDb, sortBookChaptersByEpisodeNumber } from '../src/db/repository';
import { chapterIdsByEpisodeNumber, episodeNumberFromTitle } from '../src/lib/chapterEpisodeOrder';

describe('episodeNumberFromTitle', () => {
  it('reads common episode markers', () => {
    expect(episodeNumberFromTitle('Slow Japanese Episode #24: Cats')).toBe(24);
    expect(episodeNumberFromTitle('Ep. 7')).toBe(7);
    expect(episodeNumberFromTitle('第１２回 旅行')).toBe(12);
    expect(episodeNumberFromTitle('Intro')).toBeUndefined();
  });
});

describe('chapterIdsByEpisodeNumber', () => {
  it('sorts numerically, keeping unnumbered chapters last in current order', () => {
    const ids = chapterIdsByEpisodeNumber([
      { id: 'a', title: 'Bonus', position: 0 },
      { id: 'b', title: 'Episode 10', position: 1 },
      { id: 'c', title: 'Episode 2', position: 2 },
      { id: 'd', title: 'Extra', position: 3 },
    ]);
    expect(ids).toEqual(['c', 'b', 'a', 'd']);
  });
});

describe('sortBookChaptersByEpisodeNumber', () => {
  beforeEach(async () => {
    await resetDbForTests();
  });

  it('rewrites chapter positions', async () => {
    const book = await createBook({ title: 'Slow' } as never);
    await createBookChapter(book.id, 'Episode 3');
    await createBookChapter(book.id, 'Episode 1');
    await createBookChapter(book.id, 'Episode 2');
    expect(await sortBookChaptersByEpisodeNumber(book.id)).toBeGreaterThan(0);
    const stored = await getDb().books.get(book.id);
    const titles = [...stored!.chapters].sort((a, b) => a.position - b.position).map((c) => c.title);
    expect(titles).toEqual(['Episode 1', 'Episode 2', 'Episode 3']);
    expect(await sortBookChaptersByEpisodeNumber(book.id)).toBe(0);
  });
});
