import { describe, expect, it } from 'vitest';

import { planOrphanedExtrasRepair } from '../scripts/lib/orphanedExtras';

describe('planOrphanedExtrasRepair', () => {
  const live = new Set(['series', 'other']);
  it('repoints orphans to their single live book and skips healthy/ambiguous rows', () => {
    const plan = planOrphanedExtrasRepair(
      [
        { id: 's1', bookId: 'gone', chapterId: 'old' },
        { id: 's2', bookId: 'series', chapterId: 'c1' },
        { id: 's3', bookId: 'gone', chapterId: null },
        { id: 's4', bookId: null, chapterId: null },
        { id: 's5', bookId: 'gone', chapterId: null },
      ],
      live,
      [
        { sentenceId: 's1', bookId: 'series', chapterId: 'c-45' },
        { sentenceId: 's5', bookId: 'series', chapterId: 'c1' },
        { sentenceId: 's5', bookId: 'other', chapterId: 'c2' },
        { sentenceId: 's4', bookId: 'series', chapterId: null },
        { sentenceId: 's3', bookId: 'dead-book', chapterId: 'x' },
      ],
    );
    expect(plan.repoints).toEqual([
      { id: 's1', from: { bookId: 'gone', chapterId: 'old' }, to: { bookId: 'series', chapterId: 'c-45' } },
      { id: 's4', from: { bookId: null, chapterId: null }, to: { bookId: 'series', chapterId: null } },
    ]);
    expect(plan.unresolved).toEqual([
      { id: 's3', reason: 'no-live-membership' },
      { id: 's5', reason: 'multiple-memberships' },
    ]);
  });
});
