import { describe, expect, it } from 'vitest';

import {
  applySplitToChapters,
  isCollapsedFrom,
  planChapterSplit,
  type PlanChapter,
  type PlanSourceBook,
} from '../scripts/lib/splitMergedChapters';

const created = '2026-10-29T03:51:32.889+00:00';
const source: PlanSourceBook = {
  id: 'book-src',
  title: 'The Podcast',
  createdAt: created,
  chapters: [
    { id: 'o2', title: 'No 28', position: 1, sourceId: 'u28' },
    { id: 'o1', title: 'No 24', position: 0, sourceId: 'u24' },
  ],
};
const collapsed: PlanChapter = { id: 'c', title: 'The Podcast', position: 1, sourceDate: '2026-10-29T03:51:32.889Z', suspendedAt: 'S' };
const members = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, sentenceId: `s${i}`, position: 10 + i, chapterId: 'c' }));
const imports = [
  { bookId: 'book-src', chapterId: 'o1', sentenceCount: 3 },
  { bookId: 'book-src', chapterId: 'o2', sentenceCount: 2 },
];

describe('planChapterSplit', () => {
  it('recognises the collapsed chapter by title and creation instant', () => {
    expect(isCollapsedFrom(collapsed, source)).toBe(true);
    expect(isCollapsedFrom({ ...collapsed, sourceDate: '2026-10-28T00:00:00Z' }, source)).toBe(false);
  });

  it('splits by position using import counts, keeping the first on the existing id', () => {
    const split = planChapterSplit({ collapsed, source, imports, memberships: members, newChapterId: () => 'new' });
    expect(split.chapters.map((c) => [c.id, c.title, c.position, c.suspendedAt])).toEqual([
      ['c', 'No 24', 1, 'S'],
      ['new', 'No 28', 2, 'S'],
    ]);
    expect([...split.reassignments]).toEqual([['m3', 'new'], ['m4', 'new']]);
  });

  it('refuses when counts do not add up', () => {
    expect(() => planChapterSplit({ collapsed, source, imports, memberships: members.slice(1), newChapterId: () => 'x' })).toThrow('refusing to guess');
  });

  it('renumbers the surrounding chapters', () => {
    const split = planChapterSplit({ collapsed, source, imports, memberships: members, newChapterId: () => 'new' });
    const all = applySplitToChapters([{ id: 'a', title: 'A', position: 0 }, collapsed, { id: 'z', title: 'Z', position: 2 }], split);
    expect(all.map((c) => [c.id, c.position])).toEqual([['a', 0], ['c', 1], ['new', 2], ['z', 3]]);
  });
});
